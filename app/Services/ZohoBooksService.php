<?php

namespace App\Services;

use App\Models\Vendor;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Zoho Books API client — powers the Purchase Order "Sync with Zohobook" flow.
 *
 * Auth mirrors [[ZohoSignService]] exactly (OAuth refresh-token grant, cached
 * access token with a 10-min safety buffer) but against a SEPARATE cache key
 * and a Books-scoped refresh token — Sign and Books tokens are not
 * interchangeable. The API host is the Books host (zohoapis.in/books/v3), and
 * every call carries ?organization_id=<org>.
 *
 * Public surface:
 *   - isConfigured()            → controller returns 503 cleanly when creds absent
 *   - findOrCreateVendorId()    → local Vendor  → Zoho contact_id (cached on vendor)
 *   - resolveTaxId(rate)        → GST %         → Zoho tax_id
 *   - resolveCurrencyId(code)   → ISO code      → Zoho currency_id
 *   - createPurchaseOrder(body) → POST /purchaseorders, returns the purchaseorder node
 *   - getPurchaseOrderPdf(id)   → raw PDF bytes of Zoho's own rendered PO
 *
 * Every method throws RuntimeException with the upstream Zoho message intact so
 * the controller can surface it to the user as a truthful 422 (Zoho's errors
 * are actionable: "tax not configured", "contact_name already exists", etc.).
 */
class ZohoBooksService
{
    private const TOKEN_CACHE_KEY = 'zoho_books_access_token';

    private string $clientId;
    private string $clientSecret;
    private string $refreshToken;
    private string $orgId;
    private string $baseUrl;
    private string $accountsUrl;

    /** Per-request memo so a product repeated across lines is resolved once. */
    private array $itemCache = [];

    public function __construct()
    {
        $cfg = config('services.zoho_books');
        $this->clientId     = (string) ($cfg['client_id']       ?? '');
        $this->clientSecret = (string) ($cfg['client_secret']   ?? '');
        $this->refreshToken = (string) ($cfg['refresh_token']   ?? '');
        $this->orgId        = (string) ($cfg['organization_id'] ?? '');
        $this->baseUrl      = rtrim((string) ($cfg['base_url']     ?? 'https://www.zohoapis.in/books/v3'), '/');
        $this->accountsUrl  = rtrim((string) ($cfg['accounts_url'] ?? 'https://accounts.zoho.in'), '/');
    }

    /** True once the env keys are filled — the controller 503s otherwise. */
    public function isConfigured(): bool
    {
        return $this->clientId !== '' && $this->clientSecret !== ''
            && $this->refreshToken !== '' && $this->orgId !== '';
    }

    /* ─────────────────────── Auth ─────────────────────── */

    private function getAccessToken(): string
    {
        if (!$this->isConfigured()) {
            throw new RuntimeException('Zoho Books is not configured. Set ZOHO_BOOKS_REFRESH_TOKEN and ZOHO_BOOKS_ORG_ID.');
        }

        $cached = Cache::get(self::TOKEN_CACHE_KEY);
        if (is_string($cached) && $cached !== '') return $cached;

        return $this->refreshAccessToken();
    }

    private function refreshAccessToken(): string
    {
        $resp = Http::asForm()->post("{$this->accountsUrl}/oauth/v2/token", [
            'refresh_token' => $this->refreshToken,
            'client_id'     => $this->clientId,
            'client_secret' => $this->clientSecret,
            'grant_type'    => 'refresh_token',
        ]);

        if (!$resp->successful()) {
            Log::error('Zoho Books token refresh failed', ['status' => $resp->status(), 'body' => $resp->body()]);
            throw new RuntimeException('Zoho Books token refresh failed: ' . $resp->body());
        }

        $data  = $resp->json();
        $token = $data['access_token'] ?? null;
        if (!is_string($token) || $token === '') {
            throw new RuntimeException('Zoho Books refresh response missing access_token: ' . $resp->body());
        }

        // 10-min safety buffer before Zoho's stated expiry (same as ZohoSignService).
        $ttl = max(60, ((int) ($data['expires_in'] ?? 3600)) - 600);
        Cache::put(self::TOKEN_CACHE_KEY, $token, now()->addSeconds($ttl));

        return $token;
    }

    /* ─────────────────────── Low-level HTTP ─────────────────────── */

    /** GET against the Books API; org id auto-appended. Returns decoded JSON. */
    private function get(string $endpoint, array $query = []): array
    {
        $resp = Http::withHeaders(['Authorization' => 'Zoho-oauthtoken ' . $this->getAccessToken()])
            ->get("{$this->baseUrl}/" . ltrim($endpoint, '/'), array_merge(['organization_id' => $this->orgId], $query));
        return $this->handle($resp, 'GET ' . $endpoint);
    }

    /** POST a JSON body against the Books API; org id in the query string. */
    private function post(string $endpoint, array $body): array
    {
        $resp = Http::withHeaders(['Authorization' => 'Zoho-oauthtoken ' . $this->getAccessToken()])
            ->post("{$this->baseUrl}/" . ltrim($endpoint, '/') . '?organization_id=' . $this->orgId, $body);
        return $this->handle($resp, 'POST ' . $endpoint);
    }

    /**
     * Zoho Books signals failure two ways: a non-2xx HTTP status, OR a 2xx body
     * with a non-zero `code`. Treat both as errors and surface Zoho's message.
     */
    private function handle($resp, string $label): array
    {
        $json = $resp->json() ?? [];
        $code = $json['code'] ?? null;

        if (!$resp->successful() || ($code !== null && (int) $code !== 0)) {
            $message = $json['message'] ?? $resp->body();
            Log::error('Zoho Books API error', [
                'call'    => $label,
                'status'  => $resp->status(),
                'code'    => $code,
                'message' => $message,
            ]);
            throw new RuntimeException('Zoho Books: ' . $message);
        }

        return $json;
    }

    /* ─────────────────────── Reference resolvers ─────────────────────── */

    /**
     * Resolve a local Vendor to its Zoho contact id, creating the Zoho vendor
     * on first sync and caching the id back onto the vendor row so we never
     * search/create twice.
     */
    public function findOrCreateVendorId(Vendor $vendor, ?string $gstin = null, ?string $stateCode = null): string
    {
        if (!empty($vendor->zoho_contact_id)) return (string) $vendor->zoho_contact_id;

        $name = trim((string) ($vendor->company_name ?: $vendor->legal_name));
        if ($name === '') {
            throw new RuntimeException('Supplier has no company/legal name to register in Zoho Books.');
        }

        // Try to match an existing Zoho vendor by name before creating a duplicate.
        $found = $this->get('contacts', ['contact_name' => $name, 'contact_type' => 'vendor']);
        $existing = $found['contacts'][0]['contact_id'] ?? null;

        if ($existing) {
            $vendor->forceFill(['zoho_contact_id' => (string) $existing])->saveQuietly();
            return (string) $existing;
        }

        $addr  = $vendor->relationLoaded('primaryAddress') ? $vendor->primaryAddress : $vendor->primaryAddress()->first();
        $email = $vendor->primary_email ?: optional($addr)->email;

        // GST treatment: a vendor with a GSTIN is a registered business (forward
        // GST applies); without one Zoho treats it as unregistered and would
        // reject forward tax. Place of supply comes from the GSTIN state prefix
        // (registered) or the vendor's own state code (unregistered).
        $gstin = $gstin ? strtoupper(trim($gstin)) : null;
        $body = [
            'contact_name'  => $name,
            'company_name'  => $vendor->company_name ?: $name,
            'contact_type'  => 'vendor',
            'gst_treatment' => $gstin ? 'business_gst' : 'business_none',
        ];
        if ($gstin) $body['gst_no'] = $gstin;
        $poc = self::placeOfContact($gstin ? substr($gstin, 0, 2) : $stateCode);
        if ($poc) $body['place_of_contact'] = $poc;
        if ($email) {
            $body['contact_persons'] = [[
                'first_name'    => optional($addr)->contact_name ?: $name,
                'email'         => $email,
                'phone'         => (string) optional($addr)->contact_no,
                'is_primary_contact' => true,
            ]];
        }

        $created = $this->post('contacts', $body);
        $id = $created['contact']['contact_id'] ?? null;
        if (!$id) throw new RuntimeException('Zoho Books did not return a contact id for the supplier.');

        $vendor->forceFill(['zoho_contact_id' => (string) $id])->saveQuietly();
        return (string) $id;
    }

    /**
     * Map a GST percentage to a configured Zoho tax id. Zoho enforces the tax
     * TYPE by place of supply: an intra-state purchase (vendor state = org
     * state) must use the combined CGST+SGST group tax ("GST18"), while an
     * inter-state purchase must use IGST — applying the wrong one is rejected
     * ("IGST cannot be applied as this is an intrastate transaction"). We build
     * two rate→id maps and pick by $interState.
     */
    public function resolveTaxId(float $rate, bool $interState = false): ?string
    {
        if ($rate <= 0) return null;

        $maps = Cache::remember('zoho_books_tax_maps:' . $this->orgId, now()->addMinutes(30), function () {
            $intra = [];
            $inter = [];
            foreach (($this->get('settings/taxes')['taxes'] ?? []) as $t) {
                $pct  = (string) round((float) ($t['tax_percentage'] ?? 0), 2);
                $id   = (string) ($t['tax_id'] ?? '');
                $isIgst = str_starts_with(strtoupper((string) ($t['tax_name'] ?? '')), 'IGST');
                if ($isIgst) {
                    $inter[$pct] = $inter[$pct] ?? $id;          // IGST5 / IGST18 …
                } else {
                    $intra[$pct] = $intra[$pct] ?? $id;          // GST5 / GST18 (CGST+SGST group)
                }
            }
            return ['intra' => $intra, 'inter' => $inter];
        });

        $map = $interState ? $maps['inter'] : $maps['intra'];
        $key = (string) round($rate, 2);
        if (empty($map[$key])) {
            $label = $interState ? 'IGST' : 'GST (CGST+SGST)';
            throw new RuntimeException("No {$label} tax at {$key}% is configured in Zoho Books. Add it under Settings → Taxes, then sync again.");
        }
        return $map[$key];
    }

    /** Org's own GST state code ("27" for Maharashtra), from the org GSTIN. */
    public function orgStateCode(): ?string
    {
        return Cache::remember('zoho_books_org_state:' . $this->orgId, now()->addHours(6), function () {
            $org = $this->get('organizations')['organizations'][0] ?? [];
            $gst = (string) ($org['gst_no'] ?? '');
            return strlen($gst) >= 2 ? substr($gst, 0, 2) : null;
        });
    }

    /**
     * Resolve a product name to a purchasable Zoho Item id, creating it on
     * first use. Zoho purchase orders reject ad-hoc lines ("cannot be created
     * for a non-purchase item") — a PO line must point at a real item that is
     * flagged purchasable, so we ensure one exists.
     */
    public function findOrCreateItemId(string $name, float $rate, ?string $taxId = null): string
    {
        $name = trim($name) !== '' ? trim($name) : 'Item';
        $key = mb_strtolower($name);
        if (isset($this->itemCache[$key])) return $this->itemCache[$key];

        // Reuse an existing purchasable item with the same name before creating.
        foreach (($this->get('items', ['name' => $name])['items'] ?? []) as $it) {
            if (mb_strtolower(trim((string) ($it['name'] ?? ''))) === $key && ($it['can_be_purchased'] ?? true)) {
                return $this->itemCache[$key] = (string) $it['item_id'];
            }
        }

        $body = [
            'name'          => $name,
            'product_type'  => 'goods',
            'item_type'     => 'sales_and_purchases', // purchasable → valid on a PO
            'rate'          => $rate,
            'purchase_rate' => $rate,
        ];
        if ($taxId) $body['tax_id'] = $taxId;

        $created = $this->post('items', $body);
        $id = $created['item']['item_id'] ?? null;
        if (!$id) throw new RuntimeException('Zoho Books did not return an item id for "' . $name . '".');

        return $this->itemCache[$key] = (string) $id;
    }

    /** Map an ISO currency code (e.g. USD) to the org's Zoho currency id. */
    public function resolveCurrencyId(?string $code): ?string
    {
        $code = strtoupper(trim((string) $code));
        if ($code === '' || $code === 'INR') return null; // INR = org base, omit.

        $map = Cache::remember('zoho_books_ccy_map:' . $this->orgId, now()->addMinutes(60), function () {
            $out = [];
            foreach (($this->get('settings/currencies')['currencies'] ?? []) as $c) {
                $out[strtoupper((string) ($c['currency_code'] ?? ''))] = (string) ($c['currency_id'] ?? '');
            }
            return $out;
        });

        return $map[$code] ?? null;
    }

    /** GST numeric state code (e.g. "27") → Zoho 2-letter place-of-supply ("MH"). */
    private static function placeOfContact(?string $numeric): ?string
    {
        $numeric = str_pad(trim((string) $numeric), 2, '0', STR_PAD_LEFT);
        static $map = [
            '01' => 'JK', '02' => 'HP', '03' => 'PB', '04' => 'CH', '05' => 'UT', '06' => 'HR',
            '07' => 'DL', '08' => 'RJ', '09' => 'UP', '10' => 'BR', '11' => 'SK', '12' => 'AR',
            '13' => 'NL', '14' => 'MN', '15' => 'MZ', '16' => 'TR', '17' => 'ML', '18' => 'AS',
            '19' => 'WB', '20' => 'JH', '21' => 'OD', '22' => 'CT', '23' => 'MP', '24' => 'GJ',
            '25' => 'DD', '26' => 'DN', '27' => 'MH', '29' => 'KA', '30' => 'GA', '31' => 'LD',
            '32' => 'KL', '33' => 'TN', '34' => 'PY', '35' => 'AN', '36' => 'TS', '37' => 'AP',
            '38' => 'LA',
        ];
        return $map[$numeric] ?? null;
    }

    /* ─────────────────────── Purchase order ─────────────────────── */

    /** POST a fully-built purchase-order payload; returns the purchaseorder node. */
    public function createPurchaseOrder(array $payload): array
    {
        $resp = $this->post('purchaseorders', $payload);
        $po = $resp['purchaseorder'] ?? null;
        if (!$po || empty($po['purchaseorder_id'])) {
            throw new RuntimeException('Zoho Books did not return a purchase-order id.');
        }
        return $po;
    }

    /** Raw PDF bytes of Zoho's own rendered PO — cached alongside the app PDF. */
    public function getPurchaseOrderPdf(string $zohoId): string
    {
        $resp = Http::withHeaders(['Authorization' => 'Zoho-oauthtoken ' . $this->getAccessToken()])
            ->get("{$this->baseUrl}/purchaseorders/" . rawurlencode($zohoId), [
                'organization_id' => $this->orgId,
                'accept'          => 'pdf',
            ]);

        if (!$resp->successful()) {
            throw new RuntimeException('Zoho Books PDF fetch failed: ' . $resp->body());
        }
        return $resp->body();
    }
}
