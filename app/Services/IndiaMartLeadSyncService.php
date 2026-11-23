<?php

namespace App\Services;

use App\Models\Client;
use App\Models\Lead;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class IndiaMartLeadSyncService
{
    private const INDIAMART_BASE_URL = 'https://mapi.indiamart.com/wservce/crm/crmListing/v2/';
    private const HTTP_TIMEOUT_SEC = 30;

    private const DEFAULT_LOOKBACK_DAYS = 7;

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

    private function fetchAndStore(string $crmKey, string $platform, Client $client, ?User $triggeredBy): array
    {
        $stats = ['fetched' => 0, 'created' => 0, 'updated' => 0, 'disqualified' => 0, 'errors' => []];

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
                    if (!$existing->branch_id) {
                        $payload['branch_id'] = $this->resolveSyncBranchId($triggeredBy);
                    }
                    unset($payload['lead_stage_id'], $payload['qualified'], $payload['disqualified']);
                    $existing->update($payload);
                    $stats['updated']++;
                } else {
                    $payload['branch_id']  = $this->resolveSyncBranchId($triggeredBy);
                    $payload['opp_code']   = $this->nextOppCode($client->id, $payload['branch_id']);
                    $payload['created_by'] = $triggeredBy?->id;
                    Lead::create($payload);
                    $stats['created']++;
                }
                if (!$qualified) $stats['disqualified']++;
            } catch (\Throwable $e) {
                $stats['errors'][] = "{$platform} "
                    . ($lead['UNIQUE_QUERY_ID'] ?? '?')
                    . ': ' . $e->getMessage();
                Log::warning('IndiaMart lead row failed', [
                    'platform' => $platform,
                    'lead'     => $lead,
                    'message'  => $e->getMessage(),
                ]);
            }
        }

        return $stats;
    }

    private function resolveSyncBranchId(?User $triggeredBy): ?int
    {
        if ($triggeredBy?->branch_id) {
            return (int) $triggeredBy->branch_id;
        }

        $configured = config('lead_sync.branch');
        return is_int($configured) ? $configured : null;
    }

    private function nextOppCode(int $clientId, ?int $branchId = null): string
    {
        $max = Lead::withTrashed()
            ->where('client_id', $clientId)
            ->when($branchId !== null, fn ($q) => $q->where('branch_id', $branchId))
            ->when($branchId === null, fn ($q) => $q->whereNull('branch_id'))
            ->selectRaw("COALESCE(MAX(CAST(NULLIF(regexp_replace(COALESCE(opp_code, ''), '\\D', '', 'g'), '') AS INTEGER)), 0) AS max_code")
            ->value('max_code');
        return sprintf('OPP-%04d', ((int) $max) + 1);
    }

    public static function isQualified(string $iso): bool
    {
        return in_array(strtoupper(trim($iso)), self::QUALIFIED_ISO_CODES, true);
    }

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
