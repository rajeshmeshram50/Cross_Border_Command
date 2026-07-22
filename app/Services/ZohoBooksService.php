<?php

namespace App\Services;

use App\Models\Customer;
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
        return $this->sendWithAuthRetry(
            fn (string $token) => Http::withHeaders(['Authorization' => 'Zoho-oauthtoken ' . $token])
                ->get("{$this->baseUrl}/" . ltrim($endpoint, '/'), array_merge(['organization_id' => $this->orgId], $query)),
            'GET ' . $endpoint
        );
    }

    /** POST a JSON body against the Books API; org id in the query string. Extra
     *  query params (e.g. ignore_auto_number) are appended to the URL. */
    private function post(string $endpoint, array $body, array $query = []): array
    {
        $url = "{$this->baseUrl}/" . ltrim($endpoint, '/') . '?organization_id=' . $this->orgId;
        foreach ($query as $k => $v) {
            $url .= '&' . $k . '=' . rawurlencode((string) $v);
        }
        return $this->sendWithAuthRetry(
            fn (string $token) => Http::withHeaders(['Authorization' => 'Zoho-oauthtoken ' . $token])->post($url, $body),
            'POST ' . $endpoint
        );
    }

    /**
     * Run an authorized Books call and, if Zoho rejects the cached access token
     * with a 401, drop the cache, force a fresh token, and retry once. Zoho can
     * revoke a token before our local TTL runs out (re-auth, scope change,
     * security event); without this one early expiry wedges EVERY sync until the
     * stale token's cache TTL elapses. $call receives the bearer token and must
     * return the Http Response.
     */
    private function sendWithAuthRetry(callable $call, string $label): array
    {
        $resp = $call($this->getAccessToken());
        if ($resp->status() === 401) {
            Cache::forget(self::TOKEN_CACHE_KEY);
            $resp = $call($this->refreshAccessToken());
        }
        return $this->handle($resp, $label);
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
        // Zoho's contact_name filter can return near-matches, so confirm the name
        // ACTUALLY equals ours before caching the id — otherwise a substring hit
        // (e.g. "ABC" matching "ABC Traders") gets permanently bound to this
        // vendor. Mirrors the exact-name check in findOrCreateItemId.
        $found = $this->get('contacts', ['contact_name' => $name, 'contact_type' => 'vendor']);
        $existing = null;
        foreach (($found['contacts'] ?? []) as $c) {
            if (mb_strtolower(trim((string) ($c['contact_name'] ?? ''))) === mb_strtolower($name)) {
                $existing = (string) $c['contact_id'];
                break;
            }
        }

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
        if ($rate < 0) return null;

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
     * Resolve a product to a purchasable Zoho Item id, creating it on first use.
     * Zoho purchase orders reject ad-hoc lines ("cannot be created for a
     * non-purchase item") — a PO line must point at a real purchasable item.
     *
     * Dedup (mirrors findOrCreateVendorId): when a local $productId is given, the
     * resolved Zoho item id is cached back onto products.zoho_item_id and reused
     * on every later sync WITHOUT re-searching — the guarantee against duplicate
     * items in Zoho. Ad-hoc lines (no product id, e.g. a Direct SPI) fall back to
     * name matching + a per-request memo.
     */
    public function findOrCreateItemId(string $name, float $rate, ?string $taxId = null, ?int $productId = null): string
    {
        // Fast path: a product that already carries its Zoho item id never
        // re-searches or re-creates.
        if ($productId) {
            $cached = \App\Models\Product::where('id', $productId)->value('zoho_item_id');
            if (!empty($cached)) return (string) $cached;
        }

        $name = trim($name) !== '' ? trim($name) : 'Item';
        // Zoho caps item names at 100 chars; a longer name hard-rejects item
        // creation and takes the whole PO/bill/estimate sync down with it. Cap it
        // (search + create use the same capped value so dedup stays consistent).
        $name = mb_substr($name, 0, 100);
        $key = mb_strtolower($name);
        $resolved = $this->itemCache[$key] ?? null;

        if (!$resolved) {
            // Reuse an existing purchasable item with the same name before creating.
            foreach (($this->get('items', ['name' => $name])['items'] ?? []) as $it) {
                if (mb_strtolower(trim((string) ($it['name'] ?? ''))) === $key && ($it['can_be_purchased'] ?? true)) {
                    $resolved = (string) $it['item_id'];
                    break;
                }
            }
        }

        if (!$resolved) {
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
            $resolved = (string) $id;
        }

        $this->itemCache[$key] = $resolved;
        // Remember it on the product so future syncs skip the search entirely.
        if ($productId) \App\Models\Product::where('id', $productId)->update(['zoho_item_id' => $resolved]);
        return $resolved;
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

    /** Public: GST numeric state code ("08") → Zoho 2-letter place of supply
     *  ("RJ"). Set on estimates/invoices so Zoho's intra/inter-state tax
     *  determination matches ours (critical when the org has no GSTIN). */
    public function placeOfSupply(?string $numeric): ?string
    {
        return self::placeOfContact($numeric);
    }

    /** Normalise a stored GST state code — "27", "7", or a legacy label like
     *  "27 – Maharashtra" — to its 2-digit numeric form for a reliable
     *  intra/inter-state comparison. Null when the value carries no digits. */
    public static function normStateCode(?string $s): ?string
    {
        $digits = preg_replace('/\D+/', '', (string) $s);
        return $digits === '' ? null : str_pad(substr($digits, 0, 2), 2, '0', STR_PAD_LEFT);
    }

    /** GST numeric state code (e.g. "27") → Zoho 2-letter place-of-supply ("MH"). */
    private static function placeOfContact(?string $numeric): ?string
    {
        // Tolerate "7" and legacy "27 – Maharashtra" labels: keep leading digits.
        $numeric = self::normStateCode($numeric);
        if ($numeric === null) return null;
        static $map = [
            '01' => 'JK',
            '02' => 'HP',
            '03' => 'PB',
            '04' => 'CH',
            '05' => 'UT',
            '06' => 'HR',
            '07' => 'DL',
            '08' => 'RJ',
            '09' => 'UP',
            '10' => 'BR',
            '11' => 'SK',
            '12' => 'AR',
            '13' => 'NL',
            '14' => 'MN',
            '15' => 'MZ',
            '16' => 'TR',
            '17' => 'ML',
            '18' => 'AS',
            '19' => 'WB',
            '20' => 'JH',
            '21' => 'OD',
            '22' => 'CT',
            '23' => 'MP',
            '24' => 'GJ',
            '25' => 'DD',
            '26' => 'DN',
            '27' => 'MH',
            '29' => 'KA',
            '30' => 'GA',
            '31' => 'LD',
            '32' => 'KL',
            '33' => 'TN',
            '34' => 'PY',
            '35' => 'AN',
            '36' => 'TS',
            '37' => 'AP',
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

    /* ─────────────────────── Bill + vendor payment ─────────────────────── */

    /** POST a fully-built bill payload; returns the bill node. */
    public function createBill(array $payload): array
    {
        $resp = $this->post('bills', $payload);
        $bill = $resp['bill'] ?? null;
        if (!$bill || empty($bill['bill_id'])) {
            throw new RuntimeException('Zoho Books did not return a bill id.');
        }
        return $bill;
    }

    /**
     * POST a vendor payment (records a payment against one or more bills).
     * Returns the vendorpayment node (carries payment_id).
     */
    public function recordVendorPayment(array $payload): array
    {
        $resp = $this->post('vendorpayments', $payload);
        $pay = $resp['vendorpayment'] ?? $resp['payment'] ?? null;
        if (!$pay || empty($pay['payment_id'])) {
            throw new RuntimeException('Zoho Books did not return a vendor-payment id.');
        }
        return $pay;
    }

    /**
     * The org's Bank/Cash ledgers, cached per org as
     * [['id' => …, 'name' => …, 'type' => 'bank'|'cash'], …] in chart order.
     */
    protected function bankCashAccounts(): array
    {
        return Cache::remember('zoho_books_bank_accounts:' . $this->orgId, now()->addHours(6), function () {
            $out = [];
            foreach (($this->get('chartofaccounts')['chartofaccounts'] ?? []) as $a) {
                $type = (string) ($a['account_type'] ?? '');
                if (($type === 'bank' || $type === 'cash') && ($a['is_active'] ?? true)) {
                    $out[] = ['id' => (string) ($a['account_id'] ?? ''), 'name' => (string) ($a['account_name'] ?? ''), 'type' => $type];
                }
            }
            return $out;
        });
    }

    /**
     * Resolve a "paid through" account id for a vendor payment (Zoho requires
     * one on every payment). When a bank name is given, match it to the org's
     * matching Bank ledger so bank-wise reconciliation in Zoho is correct;
     * otherwise (or when unmatched) fall back to the first active Bank, then Cash.
     * Returns null only when the org has no Bank/Cash ledger at all.
     */
    public function resolvePaidThroughAccountId(?string $bankName = null): ?string
    {
        $accounts = $this->bankCashAccounts();
        if (empty($accounts)) return null;

        $needle = trim(mb_strtolower((string) $bankName));
        if ($needle !== '') {
            // Match a bank ledger by name — exact first, then contains either way
            // (so "HDFC" matches "HDFC Bank" and vice-versa).
            foreach ($accounts as $a) {
                if ($a['type'] === 'bank' && mb_strtolower($a['name']) === $needle) return $a['id'];
            }
            foreach ($accounts as $a) {
                $n = mb_strtolower($a['name']);
                if ($a['type'] === 'bank' && $n !== '' && (str_contains($n, $needle) || str_contains($needle, $n))) return $a['id'];
            }
        }

        foreach ($accounts as $a) {
            if ($a['type'] === 'bank') return $a['id'];
        }
        return $accounts[0]['id'];   // no bank → first cash
    }

    /** Raw PDF bytes of Zoho's own rendered Bill — cached alongside the app. */
    public function getBillPdf(string $zohoId): string
    {
        $resp = Http::withHeaders(['Authorization' => 'Zoho-oauthtoken ' . $this->getAccessToken()])
            ->get("{$this->baseUrl}/bills/" . rawurlencode($zohoId), [
                'organization_id' => $this->orgId,
                'accept'          => 'pdf',
            ]);

        if (!$resp->successful()) {
            throw new RuntimeException('Zoho Books bill PDF fetch failed: ' . $resp->body());
        }
        return $resp->body();
    }

    /** Fetch a bill node (used to read its current open balance before applying
     *  a vendor credit against it). */
    public function getBill(string $billId): array
    {
        return $this->get('bills/' . rawurlencode($billId))['bill'] ?? [];
    }

    /* ─────────────────────── Vendor credit (debit note) ─────────────────────── */

    /**
     * POST a fully-built vendor-credit payload (Zoho's purchase debit note; it
     * reduces the payable to the supplier). Returns the vendor-credit node.
     */
    public function createVendorCredit(array $payload): array
    {
        $resp = $this->post('vendorcredits', $payload);
        // Zoho has used both node keys across versions — accept either. The id
        // field itself is vendor_credit_id (underscore); keep a fallback too.
        $vc = $resp['vendor_credit'] ?? $resp['vendorcredit'] ?? null;
        $id = $vc['vendor_credit_id'] ?? $vc['vendorcredit_id'] ?? null;
        if (!$vc || empty($id)) {
            throw new RuntimeException('Zoho Books did not return a vendor-credit id.');
        }
        // Normalise so callers can always read vendor_credit_id.
        $vc['vendor_credit_id'] = (string) $id;
        return $vc;
    }

    /**
     * Apply an existing vendor credit against one or more open bills, realising
     * the payable reduction. `$bills` = [['bill_id' => ..., 'amount_applied' => ...]].
     * Returns the decoded response.
     */
    public function applyVendorCreditToBills(string $vendorCreditId, array $bills): array
    {
        return $this->post('vendorcredits/' . rawurlencode($vendorCreditId) . '/bills', ['bills' => $bills]);
    }

    /** Fetch a vendor-credit node (used to read its remaining balance before a
     *  retry-apply on re-sync). Accepts either response key. */
    public function getVendorCredit(string $id): array
    {
        $r = $this->get('vendorcredits/' . rawurlencode($id));
        return $r['vendor_credit'] ?? $r['vendorcredit'] ?? [];
    }

    /** Raw PDF bytes of Zoho's own rendered vendor credit. */
    public function getVendorCreditPdf(string $zohoId): string
    {
        $resp = Http::withHeaders(['Authorization' => 'Zoho-oauthtoken ' . $this->getAccessToken()])
            ->get("{$this->baseUrl}/vendorcredits/" . rawurlencode($zohoId), [
                'organization_id' => $this->orgId,
                'accept'          => 'pdf',
            ]);

        if (!$resp->successful()) {
            throw new RuntimeException('Zoho Books vendor-credit PDF fetch failed: ' . $resp->body());
        }
        return $resp->body();
    }

    /* ─────────────── Sales side: customer, estimate, invoice ─────────────── */

    /**
     * Resolve a local Customer to its Zoho contact id (contact_type=customer),
     * creating it on first sync and caching the id back onto the customer row —
     * the guarantee against duplicate customer contacts in Zoho. Mirrors
     * findOrCreateVendorId.
     */
    public function findOrCreateCustomerId(Customer $customer, ?string $gstin = null, ?string $stateCode = null): string
    {
        if (!empty($customer->zoho_contact_id)) return (string) $customer->zoho_contact_id;

        $name = trim((string) ($customer->company_name ?: $customer->legal_name));
        if ($name === '') {
            throw new RuntimeException('Customer has no company/legal name to register in Zoho Books.');
        }

        // Reuse an existing Zoho customer of the same name before creating a dup.
        // Confirm the returned contact's name actually equals ours — Zoho's filter
        // can return near-matches (see findOrCreateVendorId / findOrCreateItemId).
        $found = $this->get('contacts', ['contact_name' => $name, 'contact_type' => 'customer']);
        $existing = null;
        foreach (($found['contacts'] ?? []) as $c) {
            if (mb_strtolower(trim((string) ($c['contact_name'] ?? ''))) === mb_strtolower($name)) {
                $existing = (string) $c['contact_id'];
                break;
            }
        }
        if ($existing) {
            $customer->forceFill(['zoho_contact_id' => (string) $existing])->saveQuietly();
            return (string) $existing;
        }

        $gstin = $gstin ? strtoupper(trim($gstin)) : null;
        $body = [
            'contact_name'  => $name,
            'company_name'  => $customer->company_name ?: $name,
            'contact_type'  => 'customer',
            'gst_treatment' => $gstin ? 'business_gst' : 'business_none',
        ];
        if ($gstin) $body['gst_no'] = $gstin;
        $poc = self::placeOfContact($gstin ? substr($gstin, 0, 2) : $stateCode);
        if ($poc) $body['place_of_contact'] = $poc;
        if ($customer->primary_email) {
            $body['contact_persons'] = [[
                'first_name'         => $name,
                'email'              => $customer->primary_email,
                'is_primary_contact' => true,
            ]];
        }

        $created = $this->post('contacts', $body);
        $id = $created['contact']['contact_id'] ?? null;
        if (!$id) throw new RuntimeException('Zoho Books did not return a contact id for the customer.');

        $customer->forceFill(['zoho_contact_id' => (string) $id])->saveQuietly();
        return (string) $id;
    }

    /** POST a fully-built estimate payload; returns the estimate node. The org's
     *  estimate auto-numbering assigns the number (our code is the
     *  reference_number), so we don't send estimate_number. */
    public function createEstimate(array $payload): array
    {
        $resp = $this->post('estimates', $payload);
        $est = $resp['estimate'] ?? null;
        $id  = $est['estimate_id'] ?? null;
        if (!$est || empty($id)) throw new RuntimeException('Zoho Books did not return an estimate id.');
        return $est;
    }

    /** POST a fully-built invoice payload; returns the invoice node. */
    public function createInvoice(array $payload): array
    {
        $resp = $this->post('invoices', $payload);
        $inv = $resp['invoice'] ?? null;
        $id  = $inv['invoice_id'] ?? null;
        if (!$inv || empty($id)) throw new RuntimeException('Zoho Books did not return an invoice id.');
        return $inv;
    }

    /** Raw PDF bytes of Zoho's own rendered estimate. */
    public function getEstimatePdf(string $zohoId): string
    {
        return $this->fetchPdf('estimates', $zohoId, 'estimate');
    }

    /** Raw PDF bytes of Zoho's own rendered invoice. */
    public function getInvoicePdf(string $zohoId): string
    {
        return $this->fetchPdf('invoices', $zohoId, 'invoice');
    }

    /** Shared PDF fetch for a Books entity. */
    private function fetchPdf(string $entity, string $zohoId, string $label): string
    {
        $resp = Http::withHeaders(['Authorization' => 'Zoho-oauthtoken ' . $this->getAccessToken()])
            ->get("{$this->baseUrl}/{$entity}/" . rawurlencode($zohoId), [
                'organization_id' => $this->orgId,
                'accept'          => 'pdf',
            ]);
        if (!$resp->successful()) {
            throw new RuntimeException("Zoho Books {$label} PDF fetch failed: " . $resp->body());
        }
        return $resp->body();
    }
}
