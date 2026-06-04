<?php

namespace App\Services;

use App\Models\Client;
use App\Models\Lead;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * IndiaMart CRM lead sync.
 *
 * Triggered by POST /sales/leads/sync (manual button on My Workplace) or
 * later by a scheduled job. CRM keys come from `config/lead_sync.php` which
 * is driven by .env — one deployment is intentionally scoped to one tenant
 * via LEAD_SYNC_CLIENT_ID / LEAD_SYNC_BRANCH_ID. The controller is
 * responsible for tenant-gating; this service trusts the caller and just
 * fans out the configured keys.
 *
 * Each key's `label` becomes the `platform` value on the resulting leads,
 * so the My Workplace "Lead Source" column reflects which CRM account the
 * row came from.
 *
 * The country whitelist is the deduped/uppercased copy of IDIMS_6.0's
 * `isLeadQualified` list — India intentionally absent (export-buyer CRM).
 */
class IndiaMartLeadSyncService
{
    private const INDIAMART_BASE_URL = 'https://mapi.indiamart.com/wservce/crm/crmListing/v2/';
    private const HTTP_TIMEOUT_SEC = 30;

    /** How far back to ask IndiaMart for leads on each sync. Without an
     *  explicit window IndiaMart's v2 endpoint returns 204 / "no leads
     *  in the given time duration" — so we default to 7 days and let
     *  the caller override if they want a wider/narrower sweep. */
    private const DEFAULT_LOOKBACK_DAYS = 7;

    /**
     * Run sync for every CRM key configured on this client.
     *
     * @return array{fetched:int,created:int,updated:int,disqualified:int,errors:array<int,string>}
     */
    public function syncForClient(Client $client, ?User $triggeredBy = null): array
    {
        $totals = ['fetched' => 0, 'created' => 0, 'updated' => 0, 'disqualified' => 0, 'errors' => []];

        $keys = (array) config('lead_sync.indiamart.keys', []);
        if (empty($keys)) {
            $totals['errors'][] = 'No IndiaMart CRM keys configured. '
                                . 'Set INDIAMART_AGROTECH_KEY (and/or _PURVEE_KEY / _VORTEX_KEY) in .env.';
            return $totals;
        }

        foreach ($keys as $row) {
            $platform = isset($row['label']) && $row['label'] !== '' ? (string) $row['label'] : 'IndiaMart';
            $crmKey   = (string) ($row['crm_key'] ?? '');
            if ($crmKey === '') {
                $totals['errors'][] = "{$platform}: empty crm_key — skipped";
                continue;
            }

            try {
                $partial = $this->fetchAndStore($crmKey, $platform, $client, $triggeredBy);
                foreach ($partial as $k => $v) {
                    if ($k === 'errors') {
                        $totals['errors'] = array_merge($totals['errors'], $v);
                    } else {
                        $totals[$k] += $v;
                    }
                }
            } catch (\Throwable $e) {
                $totals['errors'][] = "{$platform}: " . $e->getMessage();
                Log::error('IndiaMart sync failed', [
                    'client_id' => $client->id, 'platform' => $platform, 'e' => $e,
                ]);
            }
        }

        return $totals;
    }

    /**
     * Fetch one CRM key's leads and upsert.
     *
     * @return array{fetched:int,created:int,updated:int,disqualified:int,errors:array<int,string>}
     */
    private function fetchAndStore(string $crmKey, string $platform, Client $client, ?User $triggeredBy): array
    {
        $stats = ['fetched' => 0, 'created' => 0, 'updated' => 0, 'disqualified' => 0, 'errors' => []];

        // IndiaMart's date params expect "DD-Mon-YYYY" (e.g. 21-May-2025).
        // Build a [now - lookback_days, now] window so each sync grabs the
        // most-recent leads. The exact format is required — without it the
        // endpoint either rate-limits or returns 204.
        $endTime   = now()->format('d-M-Y');
        $startTime = now()->subDays(self::DEFAULT_LOOKBACK_DAYS)->format('d-M-Y');
        $url = self::INDIAMART_BASE_URL
            . '?glusr_crm_key=' . urlencode($crmKey)
            . '&start_time='    . urlencode($startTime)
            . '&end_time='      . urlencode($endTime);

        $response = Http::timeout(self::HTTP_TIMEOUT_SEC)->get($url);
        if (!$response->successful()) {
            $stats['errors'][] = "{$platform}: HTTP " . $response->status();
            return $stats;
        }

        // IndiaMart returns 200 OK even when the call failed at their end —
        // the real status is in the body's `CODE` / `STATUS` / `MESSAGE`.
        // Most common failures: 401 (expired CRM key) and 429 (5-minute
        // rate limit). Surfacing the message lets the user know to either
        // regenerate the key or wait, instead of guessing why fetched=0.
        $body = $response->json();
        $apiCode    = (int)    ($body['CODE']    ?? 200);
        $apiStatus  = (string) ($body['STATUS']  ?? 'SUCCESS');
        $apiMessage = (string) ($body['MESSAGE'] ?? '');
        if ($apiCode !== 200 || strtoupper($apiStatus) === 'FAILURE') {
            $stats['errors'][] = "{$platform}: [{$apiCode}] " . ($apiMessage ?: $apiStatus);
            return $stats;
        }

        $leads = $body['RESPONSE'] ?? [];
        $stats['fetched'] = is_array($leads) ? count($leads) : 0;
        if ($stats['fetched'] === 0) return $stats;

        foreach ($leads as $lead) {
            try {
                $iso = strtoupper(trim((string) ($lead['SENDER_COUNTRY_ISO'] ?? '')));
                $qualified = self::isQualified($iso);

                $uniqueQueryId = isset($lead['UNIQUE_QUERY_ID']) ? (string) $lead['UNIQUE_QUERY_ID'] : null;
                if (!$uniqueQueryId) {
                    $stats['errors'][] = "{$platform}: lead missing UNIQUE_QUERY_ID — skipped";
                    continue;
                }

                $existing = Lead::where('client_id', $client->id)
                    ->where('platform', $platform)
                    ->where('unique_query_id', $uniqueQueryId)
                    ->first();

                $payload = [
                    'client_id'           => $client->id,
                    'platform'            => $platform,
                    'query_type'          => $lead['QUERY_TYPE']         ?? 'Direct Enquiries',
                    'query_time'          => $lead['QUERY_TIME']         ?? null,
                    'unique_query_id'     => $uniqueQueryId,
                    'sender_name'         => $lead['SENDER_NAME']        ?? '(unknown)',
                    'sender_mobile'       => $lead['SENDER_MOBILE']      ?? null,
                    'sender_email'        => $lead['SENDER_EMAIL']       ?? null,
                    'sender_company'      => $lead['SENDER_COMPANY']     ?? null,
                    // ↓ FIXED: old project used un-prefixed keys (address/city/state/pincode/country_iso)
                    //   and the LeadCustomer model silently dropped them because $fillable expected
                    //   sender_* names. We hit `leads` directly here, no fillable-mismatch risk.
                    'sender_address'      => $lead['SENDER_ADDRESS']     ?? null,
                    'sender_city'         => $lead['SENDER_CITY']        ?? null,
                    'sender_state'        => $lead['SENDER_STATE']       ?? null,
                    'sender_pincode'      => $lead['SENDER_PINCODE']     ?? null,
                    'sender_country_iso'  => $iso !== '' ? $iso : null,
                    'sender_mobile_alt'   => $lead['SENDER_MOBILE_ALT']  ?? null,
                    'sender_email_alt'    => $lead['SENDER_EMAIL_ALT']   ?? null,
                    'query_product_name'  => $lead['QUERY_PRODUCT_NAME'] ?? null,
                    'query_message'       => $lead['QUERY_MESSAGE']      ?? null,
                    'product_quantity'    => $lead['QUERY_PROD_QTY']     ?? null,
                    'query_mcat_name'     => $lead['QUERY_MCAT_NAME']    ?? null,
                    'qualified'           => $qualified,
                    'disqualified'        => !$qualified,
                    'lead_stage_id'       => 1,
                ];

                if ($existing) {
                    // Backfill branch on rows synced before branch attribution
                    // existed, but never clobber a branch already set (e.g. a
                    // manual reassignment).
                    if (!$existing->branch_id) {
                        $payload['branch_id'] = $this->resolveSyncBranchId($triggeredBy);
                    }
                    $existing->update($payload);
                    $stats['updated']++;
                } else {
                    $payload['opp_code']   = $this->nextOppCode($client->id);
                    $payload['created_by'] = $triggeredBy?->id;
                    $payload['branch_id']  = $this->resolveSyncBranchId($triggeredBy);
                    Lead::create($payload);
                    $stats['created']++;
                }
                if (!$qualified) $stats['disqualified']++;
            } catch (\Throwable $e) {
                $stats['errors'][] = "{$platform} "
                    . ($lead['UNIQUE_QUERY_ID'] ?? '?')
                    . ': ' . $e->getMessage();
                // ↓ FIXED: old project logged $data (undefined), now logs the actual lead row
                Log::warning('IndiaMart lead row failed', [
                    'platform' => $platform,
                    'lead'     => $lead,
                    'message'  => $e->getMessage(),
                ]);
            }
        }

        return $stats;
    }

    /**
     * Branch to stamp on synced leads. Mirrors the manual-create path, which
     * uses the acting user's branch_id — so a lead synced by a branch user is
     * attributed to that branch. Super-admins have no branch, so fall back to
     * the env-pinned branch (config('lead_sync.branch')) only when it names a
     * single id; for 'all' / a list / disabled it stays null (client-level).
     */
    private function resolveSyncBranchId(?User $triggeredBy): ?int
    {
        if ($triggeredBy?->branch_id) {
            return (int) $triggeredBy->branch_id;
        }

        $configured = config('lead_sync.branch');
        return is_int($configured) ? $configured : null;
    }

    /**
     * Allocate the next opp_code for a client. The loop inside fetchAndStore
     * runs sequentially in a single process, so we just count + format; the
     * composite UNIQUE (client_id, opp_code) catches any cross-request race.
     */
    private function nextOppCode(int $clientId): string
    {
        $count = Lead::where('client_id', $clientId)->count();
        return sprintf('OPP-%04d', $count + 1);
    }

    /** Country qualification — export-buyer CRM, so India (IN) is intentionally NOT in the list. */
    public static function isQualified(string $iso): bool
    {
        return in_array(strtoupper(trim($iso)), self::QUALIFIED_ISO_CODES, true);
    }

    /**
     * Deduped, uppercased copy of IDIMS_6.0's isLeadQualified list. Fixed
     * three quirks from the old version:
     *   - removed lowercase 'uk' duplicate (we compare uppercase)
     *   - removed stray 'Canada' full-name entry (only 'CA' remains)
     *   - moved comparison to strict uppercase so 'in' / 'In' fail correctly
     */
    public const QUALIFIED_ISO_CODES = [
        'AL','DZ','AD','AO','AG','AR','AM','AU','AT','AZ',
        'BS','BH','BB','BY','BE','BZ','BJ','BO','BA','BW',
        'BR','BN','BG','BF','BI','CV','KH','CM','CA','CF',
        'TD','CL','CN','CO','KM','CG','CR','HR','CU','CY',
        'CZ','CD','DK','DJ','DM','DO','EC','SV','GQ','ER',
        'EE','SZ','ET','FJ','FI','FR','GA','GM','GE','DE',
        'GH','GR','GD','GT','GN','GW','GY','HT','HN','HU',
        'IS','ID','IR','IQ','IE','IL','IT','CI','JM','JP',
        'JO','KZ','KE','KI','KP','KR','XK','KW','KG','LA',
        'LV','LB','LS','LR','LY','LI','LT','LU','MG','MW',
        'ML','MT','MH','MR','MX','FM','MD','MC','MN','ME',
        'MA','MZ','MM','NA','NR','NL','NZ','NI','NE','NG',
        'MK','NO','OM','PW','PA','PG','PY','PE','PH','PL',
        'PT','QA','RO','RU','RW','KN','LC','VC','WS','SM',
        'ST','SA','SN','RS','SC','SL','SG','SK','SI','SB',
        'SO','ZA','SS','ES','SD','SR','SE','CH','SY','TW',
        'TJ','TZ','TH','TL','TG','TO','TT','TN','TR','TM',
        'TV','UG','UA','AE','GB','UK','US','UY','UZ','VU',
        'VA','VE','VN','YE','ZM','ZW',
    ];
}
