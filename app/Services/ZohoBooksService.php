<?php

namespace App\Services;

use App\Models\Customer;
use App\Models\Vendor;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

class ZohoBooksService
{
    private const TOKEN_CACHE_KEY = 'zoho_books_access_token';

    private string $clientId;
    private string $clientSecret;
    private string $refreshToken;
    private string $orgId;
    private string $baseUrl;
    private string $accountsUrl;

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

    public function isConfigured(): bool
    {
        return $this->clientId !== '' && $this->clientSecret !== ''
            && $this->refreshToken !== '' && $this->orgId !== '';
    }

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

        $ttl = max(60, ((int) ($data['expires_in'] ?? 3600)) - 600);
        Cache::put(self::TOKEN_CACHE_KEY, $token, now()->addSeconds($ttl));

        return $token;
    }

    private function get(string $endpoint, array $query = []): array
    {
        return $this->sendWithAuthRetry(
            fn(string $token) => Http::withHeaders(['Authorization' => 'Zoho-oauthtoken ' . $token])
                ->get("{$this->baseUrl}/" . ltrim($endpoint, '/'), array_merge(['organization_id' => $this->orgId], $query)),
            'GET ' . $endpoint
        );
    }

    private function post(string $endpoint, array $body, array $query = []): array
    {
        $url = "{$this->baseUrl}/" . ltrim($endpoint, '/') . '?organization_id=' . $this->orgId;
        foreach ($query as $k => $v) {
            $url .= '&' . $k . '=' . rawurlencode((string) $v);
        }
        return $this->sendWithAuthRetry(
            fn(string $token) => Http::withHeaders(['Authorization' => 'Zoho-oauthtoken ' . $token])->post($url, $body),
            'POST ' . $endpoint
        );
    }

    private function delete(string $endpoint, array $query = []): array
    {
        $url = "{$this->baseUrl}/" . ltrim($endpoint, '/') . '?organization_id=' . $this->orgId;
        foreach ($query as $k => $v) {
            $url .= '&' . $k . '=' . rawurlencode((string) $v);
        }
        return $this->sendWithAuthRetry(
            fn(string $token) => Http::withHeaders(['Authorization' => 'Zoho-oauthtoken ' . $token])->delete($url),
            'DELETE ' . $endpoint
        );
    }

    private function upload(string $endpoint, string $fileBytes, string $filename, string $field = 'attachment'): array
    {
        $url = "{$this->baseUrl}/" . ltrim($endpoint, '/') . '?organization_id=' . $this->orgId;
        return $this->sendWithAuthRetry(
            fn(string $token) => Http::withHeaders(['Authorization' => 'Zoho-oauthtoken ' . $token])
                ->attach($field, $fileBytes, $filename)
                ->post($url, ['organization_id' => $this->orgId]),
            'UPLOAD ' . $endpoint
        );
    }

    private function put(string $endpoint, array $body, array $query = []): array
    {
        $url = "{$this->baseUrl}/" . ltrim($endpoint, '/') . '?organization_id=' . $this->orgId;
        foreach ($query as $k => $v) {
            $url .= '&' . $k . '=' . rawurlencode((string) $v);
        }
        return $this->sendWithAuthRetry(
            fn(string $token) => Http::withHeaders(['Authorization' => 'Zoho-oauthtoken ' . $token])->put($url, $body),
            'PUT ' . $endpoint
        );
    }

    public function attachToPurchaseOrder(string $zohoId, string $fileBytes, string $filename): void
    {
        $this->upload('purchaseorders/' . rawurlencode($zohoId) . '/attachment', $fileBytes, $filename);
    }

    public function attachToBill(string $billId, string $fileBytes, string $filename): void
    {
        $this->upload('bills/' . rawurlencode($billId) . '/attachment', $fileBytes, $filename);
    }

    public function attachToVendorCredit(string $vendorCreditId, string $fileBytes, string $filename): void
    {
        $this->upload('vendorcredits/' . rawurlencode($vendorCreditId) . '/attachment', $fileBytes, $filename);
    }

    private function sendWithAuthRetry(callable $call, string $label): array
    {
        $resp = $call($this->getAccessToken());
        if ($resp->status() === 401) {
            Cache::forget(self::TOKEN_CACHE_KEY);
            $resp = $call($this->refreshAccessToken());
        }
        return $this->handle($resp, $label);
    }

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

    public function findOrCreateVendorId(Vendor $vendor, ?string $gstin = null, ?string $stateCode = null, ?string $currencyCode = null): string
    {
        $name = trim((string) ($vendor->company_name ?: $vendor->legal_name));
        if ($name === '') {
            throw new RuntimeException('Supplier has no company/legal name to register in Zoho Books.');
        }

        $addr  = $vendor->relationLoaded('primaryAddress') ? $vendor->primaryAddress : $vendor->primaryAddress()->first();
        $zaddr = $this->buildVendorAddress($addr);

        $overseas = $this->isOverseasVendor($addr);
        $tin = $overseas ? trim((string) ($vendor->gst_number ?? '')) : '';
        if ($overseas) $gstin = null;

        if (!empty($vendor->zoho_contact_id)) {
            $id = (string) $vendor->zoho_contact_id;
            $contact = null;
            try {
                $contact = $this->get('contacts/' . $id)['contact'] ?? null;
            } catch (\Throwable $e) {
                $contact = null;
            }

            if ($contact) {
                $this->alignContactCurrency($contact, $id, $currencyCode, $vendor->id);
                if (mb_strtolower((string) ($contact['status'] ?? 'active')) === 'inactive') {
                    try {
                        $this->post('contacts/' . $id . '/active', []);
                    } catch (\Throwable $e) {
                        Log::warning('Zoho vendor contact reactivate failed', ['vendor' => $vendor->id, 'err' => $e->getMessage()]);
                    }
                }
                if ($zaddr || $overseas) {
                    $upd = $zaddr ? ['billing_address' => $zaddr, 'shipping_address' => $zaddr] : [];
                    if ($overseas && mb_strtolower((string) ($contact['gst_treatment'] ?? '')) !== 'overseas') {
                        $upd['gst_treatment'] = 'overseas';
                        $upd['gst_no'] = '';
                    }
                    if ($overseas && $tin !== '' && !str_contains((string) ($contact['notes'] ?? ''), $tin)) {
                        $upd['notes'] = trim(((string) ($contact['notes'] ?? '')) . "
TIN: " . $tin);
                    }
                    $vk = 'zoho_vendor_addr:' . $vendor->id;
                    if ($upd && Cache::get($vk) !== md5(json_encode($upd))) {
                        try {
                            $this->put('contacts/' . $id, $upd);
                            Cache::forever($vk, md5(json_encode($upd)));
                        } catch (\Throwable $e) {
                            Log::warning('Zoho vendor address update failed', ['vendor' => $vendor->id, 'err' => $e->getMessage()]);
                        }
                    }
                }
                return $id;
            }

            Log::warning('Zoho vendor contact not accessible — recreating', ['vendor' => $vendor->id, 'stale_contact_id' => $id]);
            $vendor->forceFill(['zoho_contact_id' => null])->saveQuietly();
        }

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
            try {
                $found = $this->get('contacts/' . rawurlencode((string) $existing))['contact'] ?? null;
                if ($found) $this->alignContactCurrency($found, (string) $existing, $currencyCode, $vendor->id);
            } catch (\Throwable $e) {
                Log::warning('Zoho vendor contact currency check failed', ['vendor' => $vendor->id, 'err' => $e->getMessage()]);
            }
            return (string) $existing;
        }

        $email = $vendor->primary_email ?: optional($addr)->email;

        $gstin = $gstin ? strtoupper(trim($gstin)) : null;
        $body = [
            'contact_name'  => $name,
            'company_name'  => $vendor->company_name ?: $name,
            'contact_type'  => 'vendor',
            'gst_treatment' => $overseas ? 'overseas' : ($gstin ? 'business_gst' : 'business_none'),
        ];
        if ($gstin) $body['gst_no'] = $gstin;
        if ($ccyId = $this->resolveCurrencyId($currencyCode)) $body['currency_id'] = $ccyId;
        if ($overseas && $tin !== '') $body['notes'] = 'TIN: ' . $tin;
        $poc = $overseas ? null : self::placeOfContact($gstin ? substr($gstin, 0, 2) : $stateCode);
        if ($poc) $body['place_of_contact'] = $poc;
        $persons = $this->buildVendorContactPersons($vendor, $name, $email);
        if ($persons) $body['contact_persons'] = $persons;
        if ($zaddr) {
            $body['billing_address']  = $zaddr;
            $body['shipping_address'] = $zaddr;
        }

        $created = $this->post('contacts', $body);
        $id = $created['contact']['contact_id'] ?? null;
        if (!$id) throw new RuntimeException('Zoho Books did not return a contact id for the supplier.');

        $vendor->forceFill(['zoho_contact_id' => (string) $id])->saveQuietly();
        return (string) $id;
    }

    private function buildVendorContactPersons(Vendor $vendor, string $name, ?string $email): array
    {
        $addrs = $vendor->relationLoaded('addresses') ? $vendor->addresses : $vendor->addresses()->get();

        $persons = [];
        $seen = [];
        foreach ($addrs as $a) {
            $cname = trim((string) $a->contact_name);
            $cmail = trim((string) $a->email);
            if ($cname === '' && $cmail === '') continue;
            $key = mb_strtolower($cname . '|' . $cmail);
            if (isset($seen[$key])) continue;
            $seen[$key] = true;
            $persons[] = array_filter([
                'first_name'  => $cname ?: $name,
                'email'       => $cmail ?: null,
                'phone'       => trim((string) $a->contact_no) ?: null,
                'designation' => trim((string) $a->designation) ?: null,
            ], fn($v) => $v !== null && $v !== '');
        }

        if (!$persons && $email) {
            $persons[] = array_filter([
                'first_name' => $name,
                'email'      => $email,
            ], fn($v) => $v !== null && $v !== '');
        }

        if ($persons) $persons[0]['is_primary_contact'] = true;
        return $persons;
    }

    private function isOverseasVendor($addr): bool
    {
        if (!$addr || !$addr->country_id) return false;
        $country = \Illuminate\Support\Facades\DB::table('master_countries')->where('id', $addr->country_id)->value('name');
        return $country !== null && mb_strtolower(trim((string) $country)) !== 'india';
    }

    private function buildVendorAddress($addr): ?array
    {
        if (!$addr) return null;
        $line = trim((string) $addr->address_line);
        if ($line === '') return null;
        $state   = $addr->state_id ? \Illuminate\Support\Facades\DB::table('master_states')->where('id', $addr->state_id)->value('name') : null;
        $country = $addr->country_id ? \Illuminate\Support\Facades\DB::table('master_countries')->where('id', $addr->country_id)->value('name') : null;
        $out = array_filter([
            'address'    => $line,
            'city'       => trim((string) $addr->city),
            'state'      => trim((string) $state),
            'state_code' => trim((string) $addr->state_code),
            'zip'        => trim((string) $addr->pincode),
            'country'    => trim((string) $country),
            'phone'      => trim((string) $addr->contact_no),
        ], fn($v) => $v !== null && $v !== '');
        return $out ?: null;
    }

    public function resolveTaxId(float $rate, bool $interState = false): ?string
    {
        if ($rate < 0) return null;

        $cacheKey = 'zoho_books_tax_maps:' . $this->orgId;
        $build = function () {
            $intra = [];
            $inter = [];
            foreach (($this->get('settings/taxes')['taxes'] ?? []) as $t) {
                $pct  = (string) round((float) ($t['tax_percentage'] ?? 0), 2);
                $id   = (string) ($t['tax_id'] ?? '');
                $spec = strtolower((string) ($t['tax_specification'] ?? ''));
                $isIgst = $spec !== ''
                    ? $spec === 'inter'
                    : str_starts_with(strtoupper((string) ($t['tax_name'] ?? '')), 'IGST');
                if ($isIgst) {
                    $inter[$pct] = $inter[$pct] ?? $id;
                } else {
                    $intra[$pct] = $intra[$pct] ?? $id;
                }
            }
            return ['intra' => $intra, 'inter' => $inter];
        };

        $maps = Cache::remember($cacheKey, now()->addMinutes(30), $build);

        $key   = (string) round($rate, 2);
        $pick  = fn($m) => $interState ? ($m['inter'][$key] ?? '') : ($m['intra'][$key] ?? '');
        $id    = $pick($maps);

        if ($id === '') {
            $maps = $build();
            Cache::put($cacheKey, $maps, now()->addMinutes(30));
            $id = $pick($maps);
        }

        if ($id === '') {
            $label = $interState ? 'IGST' : 'GST (CGST+SGST)';
            throw new RuntimeException("{$label} {$key}% tax not found in Zoho Books — add it and try again.");
        }
        return $id;
    }

    private const GST_STATE_CODES = [
        'JK' => '01',
        'jammu and kashmir' => '01',
        'jammu & kashmir' => '01',
        'HP' => '02',
        'himachal pradesh' => '02',
        'PB' => '03',
        'punjab' => '03',
        'CH' => '04',
        'chandigarh' => '04',
        'UT' => '05',
        'UK' => '05',
        'uttarakhand' => '05',
        'HR' => '06',
        'haryana' => '06',
        'DL' => '07',
        'delhi' => '07',
        'RJ' => '08',
        'rajasthan' => '08',
        'UP' => '09',
        'uttar pradesh' => '09',
        'BR' => '10',
        'bihar' => '10',
        'SK' => '11',
        'sikkim' => '11',
        'AR' => '12',
        'arunachal pradesh' => '12',
        'NL' => '13',
        'nagaland' => '13',
        'MN' => '14',
        'manipur' => '14',
        'MZ' => '15',
        'mizoram' => '15',
        'TR' => '16',
        'tripura' => '16',
        'ML' => '17',
        'meghalaya' => '17',
        'AS' => '18',
        'assam' => '18',
        'WB' => '19',
        'west bengal' => '19',
        'JH' => '20',
        'jharkhand' => '20',
        'OD' => '21',
        'OR' => '21',
        'odisha' => '21',
        'orissa' => '21',
        'CG' => '22',
        'CT' => '22',
        'chhattisgarh' => '22',
        'MP' => '23',
        'madhya pradesh' => '23',
        'GJ' => '24',
        'gujarat' => '24',
        'DD' => '26',
        'DN' => '26',
        'daman and diu' => '26',
        'dadra and nagar haveli' => '26',
        'dadra and nagar haveli and daman and diu' => '26',
        'MH' => '27',
        'maharashtra' => '27',
        'KA' => '29',
        'karnataka' => '29',
        'GA' => '30',
        'goa' => '30',
        'LD' => '31',
        'lakshadweep' => '31',
        'KL' => '32',
        'kerala' => '32',
        'TN' => '33',
        'tamil nadu' => '33',
        'PY' => '34',
        'puducherry' => '34',
        'pondicherry' => '34',
        'AN' => '35',
        'andaman and nicobar islands' => '35',
        'TS' => '36',
        'TG' => '36',
        'telangana' => '36',
        'AP' => '37',
        'andhra pradesh' => '37',
        'LA' => '38',
        'ladakh' => '38',
    ];

    public function orgStateCode(): ?string
    {
        return Cache::remember('zoho_books_org_state:' . $this->orgId, now()->addHours(6), function () {
            $org = $this->get('organizations')['organizations'][0] ?? [];

            $gst = (string) ($org['gst_no'] ?? '');
            if (strlen($gst) >= 2 && ctype_digit(substr($gst, 0, 2))) return substr($gst, 0, 2);

            $sc = strtoupper(trim((string) ($org['state_code'] ?? '')));
            if ($sc !== '' && ctype_digit($sc)) return self::normStateCode($sc);
            if ($sc !== '' && isset(self::GST_STATE_CODES[$sc])) return self::GST_STATE_CODES[$sc];

            $name = mb_strtolower(trim((string) ($org['state'] ?? '')));
            if ($name !== '' && isset(self::GST_STATE_CODES[$name])) return self::GST_STATE_CODES[$name];

            return null;
        });
    }

    public function findOrCreateItemId(string $name, float $rate, ?string $taxId = null, ?int $productId = null, ?float $gstPct = null): string
    {
        $name = trim($name) !== '' ? trim($name) : 'Item';
        $name = mb_substr($name, 0, 100);
        $key = mb_strtolower($name);

        $product   = $productId ? \App\Models\Product::with(['uom', 'hsn'])->find($productId) : null;
        $body      = $this->buildZohoItemBody($name, $rate, $taxId, $product, $gstPct);
        $imagePath = $product ? (string) $product->primary_image : '';
        $hash      = md5(json_encode([$body, $imagePath]));
        $hashKey   = $productId ? ('zoho_item_hash:' . $productId) : null;

        $itemId = null;
        if ($productId) {
            $cached = \App\Models\Product::where('id', $productId)->value('zoho_item_id');
            if (!empty($cached)) {
                try {
                    $it = $this->get('items/' . rawurlencode((string) $cached))['item'] ?? null;
                    if ($it) {
                        if (mb_strtolower((string) ($it['status'] ?? 'active')) === 'inactive') {
                            try {
                                $this->post('items/' . rawurlencode((string) $cached) . '/active', []);
                            } catch (\Throwable $e) {
                                Log::warning('Zoho item reactivate failed', ['item' => $cached, 'err' => $e->getMessage()]);
                            }
                        }
                        $itemId = (string) $cached;
                    } else {
                        \App\Models\Product::where('id', $productId)->update(['zoho_item_id' => null]);
                    }
                } catch (\Throwable $e) {
                    Log::warning('Zoho item not accessible — recreating', ['item' => $cached, 'err' => $e->getMessage()]);
                    \App\Models\Product::where('id', $productId)->update(['zoho_item_id' => null]);
                }
            }
        }
        if (!$itemId) $itemId = $this->itemCache[$key] ?? null;
        if (!$itemId) {
            foreach (($this->get('items', ['name' => $name])['items'] ?? []) as $it) {
                if (mb_strtolower(trim((string) ($it['name'] ?? ''))) === $key && ($it['can_be_purchased'] ?? true)) {
                    $itemId = (string) $it['item_id'];
                    break;
                }
            }
        }

        if ($itemId) {
            if (!$hashKey || Cache::get($hashKey) !== $hash) {
                try {
                    $this->put('items/' . rawurlencode($itemId), $body);
                    $this->uploadItemImageSafe($itemId, $imagePath);
                } catch (\Throwable $e) {
                    Log::warning('Zoho item update failed', ['item' => $itemId, 'err' => $e->getMessage()]);
                }
            }
        } else {
            $created = $this->post('items', $body);
            $itemId = (string) ($created['item']['item_id'] ?? '');
            if ($itemId === '') throw new RuntimeException('Zoho Books did not return an item id for "' . $name . '".');
            $this->uploadItemImageSafe($itemId, $imagePath);
        }

        if ($hashKey) Cache::forever($hashKey, $hash);
        $this->itemCache[$key] = $itemId;
        if ($productId) \App\Models\Product::where('id', $productId)->update(['zoho_item_id' => $itemId]);
        return $itemId;
    }

    private function buildZohoItemBody(string $name, float $rate, ?string $taxId, $product, ?float $gstPct = null): array
    {
        $body = [
            'name'          => $name,
            'product_type'  => 'goods',
            'item_type'     => 'sales_and_purchases',
            'rate'          => $rate,
            'purchase_rate' => $rate,
        ];
        if ($taxId) $body['tax_id'] = $taxId;
        if ($gstPct !== null && $gstPct > 0) {
            try {
                $body['intra_state_tax_id'] = $this->resolveTaxId($gstPct, false);
            } catch (\Throwable $e) {
            }
            try {
                $body['inter_state_tax_id'] = $this->resolveTaxId($gstPct, true);
            } catch (\Throwable $e) {
            }
        }
        if (!$product) return $body;

        $desc = trim((string) $product->description);
        if ($desc !== '') {
            if (mb_strlen($desc) > 1900) {
                $desc = rtrim(mb_substr($desc, 0, 1900)) . "...\nNOTE: (REMAINING — REFER THE SYSTEM GENERATED DOCUMENT)";
            }
            $body['description']          = $desc;
            $body['purchase_description'] = $desc;
        }
        $unit = trim((string) (optional($product->uom)->short_code ?: optional($product->uom)->title));
        if ($unit !== '') $body['unit'] = mb_substr($unit, 0, 100);
        $hsn = trim((string) optional($product->hsn)->hsn_code);
        if ($hsn !== '') $body['hsn_or_sac'] = $hsn;

        return $body;
    }

    private function uploadItemImageSafe(string $itemId, string $imagePath): void
    {
        if ($imagePath === '') return;
        try {
            $disk = \Illuminate\Support\Facades\Storage::disk('public');
            if (!$disk->exists($imagePath)) return;
            $this->upload('items/' . rawurlencode($itemId) . '/image', $disk->get($imagePath), basename($imagePath), 'image');
        } catch (\Throwable $e) {
            Log::warning('Zoho item image upload failed', ['item' => $itemId, 'err' => $e->getMessage()]);
        }
    }

    private function alignContactCurrency(array $contact, string $contactId, ?string $wanted, $vendorId): void
    {
        $wanted = strtoupper(trim((string) $wanted));
        if ($wanted === '') return;

        $have = strtoupper(trim((string) ($contact['currency_code'] ?? '')));
        if ($have === '' || $have === $wanted) return;

        $wantedId = $this->resolveCurrencyId($wanted) ?? ($this->currencyMap()['INR'] ?? null);

        try {
            $this->put('contacts/' . rawurlencode($contactId), ['currency_id' => $wantedId]);
            Log::info('Zoho vendor contact currency corrected', ['vendor' => $vendorId, 'from' => $have, 'to' => $wanted]);
        } catch (\Throwable $e) {
            throw new RuntimeException(
                "This supplier is registered in Zoho Books in {$have} and already has transactions, so a {$wanted} "
                . 'order cannot be posted against it. Raise the order in ' . $have . ', or give the supplier a '
                . "separate {$wanted} contact in Zoho Books."
            );
        }
    }

    public function contactCurrency(string $contactId): ?string
    {
        $contact = $this->get('contacts/' . rawurlencode($contactId))['contact'] ?? null;
        $code = strtoupper(trim((string) ($contact['currency_code'] ?? '')));

        return $code === '' ? null : $code;
    }

    public function forgetCurrencyCache(): void
    {
        Cache::forget('zoho_books_ccy_map:' . $this->orgId);
    }

    public function enabledCurrencies(): array
    {
        try {
            if (!$this->isConfigured()) return [];
            $codes = array_values(array_filter(array_keys($this->currencyMap())));
            sort($codes);

            return $codes;
        } catch (\Throwable $e) {
            Log::warning('Zoho Books: currency list unreadable', ['err' => $e->getMessage()]);

            return [];
        }
    }

    public function currencyMap(): array
    {
        return Cache::remember('zoho_books_ccy_map:' . $this->orgId, now()->addMinutes(60), function () {
            $out = [];
            foreach (($this->get('settings/currencies')['currencies'] ?? []) as $c) {
                $out[strtoupper((string) ($c['currency_code'] ?? ''))] = (string) ($c['currency_id'] ?? '');
            }
            return $out;
        });
    }

    public function resolveCurrencyId(?string $code): ?string
    {
        $code = strtoupper(trim((string) $code));
        if ($code === '' || $code === 'INR') return null;

        $map = $this->currencyMap();
        if (!isset($map[$code]) || $map[$code] === '') {
            throw new RuntimeException(
                "{$code} is not one of the currencies enabled in Zoho Books. Add it under Settings → Currencies, then sync again."
            );
        }

        return $map[$code];
    }

    public function placeOfSupply(?string $numeric): ?string
    {
        return self::placeOfContact($numeric);
    }

    public static function normStateCode(?string $s): ?string
    {
        $digits = preg_replace('/\D+/', '', (string) $s);
        return $digits === '' ? null : str_pad(substr($digits, 0, 2), 2, '0', STR_PAD_LEFT);
    }

    private static function placeOfContact(?string $numeric): ?string
    {
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

    public function createPurchaseOrder(array $payload): array
    {
        $resp = $this->post('purchaseorders', $payload);
        $po = $resp['purchaseorder'] ?? null;
        if (!$po || empty($po['purchaseorder_id'])) {
            throw new RuntimeException('Zoho Books did not return a purchase-order id.');
        }
        return $po;
    }

    public function deletePurchaseOrder(string $zohoId): void
    {
        $this->delete('purchaseorders/' . rawurlencode($zohoId));
    }

    public function markPurchaseOrderOpen(string $zohoId): void
    {
        $this->post('purchaseorders/' . rawurlencode($zohoId) . '/status/open', []);
    }

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

    public function createBill(array $payload): array
    {
        $resp = $this->post('bills', $payload);
        $bill = $resp['bill'] ?? null;
        if (!$bill || empty($bill['bill_id'])) {
            throw new RuntimeException('Zoho Books did not return a bill id.');
        }
        return $bill;
    }

    public function deleteBill(string $billId): void
    {
        $this->delete('bills/' . rawurlencode($billId));
    }

    public function recordVendorPayment(array $payload): array
    {
        $resp = $this->post('vendorpayments', $payload);
        $pay = $resp['vendorpayment'] ?? $resp['payment'] ?? null;
        if (!$pay || empty($pay['payment_id'])) {
            throw new RuntimeException('Zoho Books did not return a vendor-payment id.');
        }
        return $pay;
    }

    public function deleteVendorPayment(string $paymentId): void
    {
        $this->delete('vendorpayments/' . rawurlencode($paymentId));
    }

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

    public function resolvePaidThroughAccountId(?string $bankName = null): ?string
    {
        $accounts = $this->bankCashAccounts();
        if (empty($accounts)) return null;

        $needle = trim(mb_strtolower((string) $bankName));
        if ($needle !== '') {
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
        return $accounts[0]['id'];
    }

    public function resolveExpenseAccountId(string $name): string
    {
        $name = trim($name) !== '' ? mb_substr(trim($name), 0, 100) : 'Employee Reimbursement';
        $needle = mb_strtolower($name);

        $accounts = $this->expenseAccounts();
        foreach ($accounts as $a) {
            if (mb_strtolower($a['name']) === $needle) return $a['id'];
        }

        $created = $this->post('chartofaccounts', ['account_name' => $name, 'account_type' => 'expense']);
        $id = $created['chart_of_account']['account_id'] ?? $created['chartofaccount']['account_id'] ?? null;
        if (!$id) throw new RuntimeException('Zoho Books did not return an expense account id.');
        Cache::forget('zoho_books_expense_accounts:' . $this->orgId);
        return (string) $id;
    }

    protected function expenseAccounts(): array
    {
        return Cache::remember('zoho_books_expense_accounts:' . $this->orgId, now()->addHours(6), function () {
            $out = [];
            foreach (($this->get('chartofaccounts')['chartofaccounts'] ?? []) as $a) {
                if ((string) ($a['account_type'] ?? '') === 'expense' && ($a['is_active'] ?? true)) {
                    $out[] = ['id' => (string) ($a['account_id'] ?? ''), 'name' => (string) ($a['account_name'] ?? '')];
                }
            }
            return $out;
        });
    }

    public function findOrCreatePaidThroughAccountId(string $name): string
    {
        $name = trim($name) !== '' ? mb_substr(trim($name), 0, 100) : 'Bank';
        $needle = mb_strtolower($name);

        foreach ($this->bankCashAccounts() as $a) {
            if (mb_strtolower($a['name']) === $needle) return $a['id'];
        }

        $created = $this->post('chartofaccounts', ['account_name' => $name, 'account_type' => 'bank']);
        $id = $created['chart_of_account']['account_id'] ?? $created['chartofaccount']['account_id'] ?? null;
        if (!$id) throw new RuntimeException('Zoho Books did not return a paid-through account id.');
        Cache::forget('zoho_books_bank_accounts:' . $this->orgId);
        return (string) $id;
    }

    public function createExpense(array $payload): array
    {
        $resp = $this->post('expenses', $payload);
        $exp  = $resp['expense'] ?? null;
        if (!$exp || empty($exp['expense_id'])) {
            throw new RuntimeException('Zoho Books did not return an expense id.');
        }
        return $exp;
    }

    public function deleteExpense(string $expenseId): void
    {
        $this->delete('expenses/' . rawurlencode($expenseId));
    }

    public function attachExpenseReceipt(string $expenseId, string $fileBytes, string $filename): void
    {
        $this->upload('expenses/' . rawurlencode($expenseId) . '/attachment', $fileBytes, $filename, 'attachment');
    }

    public function resolveExpenseTitleFieldApiName(): ?string
    {
        $fallback = (string) config('services.zoho_books.expense_title_cf', '');

        $found = Cache::remember('zoho_books_expense_title_cf:' . $this->orgId, now()->addHours(6), function () {
            try {
                $fields = $this->get('settings/fields', ['entity' => 'expense'])['fields'] ?? [];
            } catch (\Throwable $e) {
                return '';
            }
            foreach ($fields as $f) {
                if (empty($f['is_custom_field']) || empty($f['api_name'])) continue;
                $label = mb_strtolower((string) ($f['field_name_formatted'] ?? ''));
                if (str_contains($label, 'title')) return (string) $f['api_name'];
            }
            foreach ($fields as $f) {
                if (!empty($f['is_custom_field']) && !empty($f['is_mandatory']) && !empty($f['api_name'])) {
                    return (string) $f['api_name'];
                }
            }
            return '';
        });

        return ($found ?: $fallback) ?: null;
    }

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

    public function getBill(string $billId): array
    {
        return $this->get('bills/' . rawurlencode($billId))['bill'] ?? [];
    }

    public function createVendorCredit(array $payload): array
    {
        $resp = $this->post('vendorcredits', $payload);
        $vc = $resp['vendor_credit'] ?? $resp['vendorcredit'] ?? null;
        $id = $vc['vendor_credit_id'] ?? $vc['vendorcredit_id'] ?? null;
        if (!$vc || empty($id)) {
            throw new RuntimeException('Zoho Books did not return a vendor-credit id.');
        }
        $vc['vendor_credit_id'] = (string) $id;
        return $vc;
    }

    public function deleteVendorCredit(string $vendorCreditId): void
    {
        $this->delete('vendorcredits/' . rawurlencode($vendorCreditId));
    }

    public function applyVendorCreditToBills(string $vendorCreditId, array $bills): array
    {
        return $this->post('vendorcredits/' . rawurlencode($vendorCreditId) . '/bills', ['bills' => $bills]);
    }

    public function refundVendorCredit(string $vendorCreditId, array $payload): array
    {
        $resp = $this->post('vendorcredits/' . rawurlencode($vendorCreditId) . '/refunds', $payload);
        $node = $resp['vendor_credit_refund'] ?? $resp['vendorcredit_refund'] ?? null;
        $id = $node['vendor_credit_refund_id'] ?? $node['vendorcredit_refund_id'] ?? null;
        if (!$node || empty($id)) {
            throw new RuntimeException('Zoho Books did not return a vendor-credit refund id.');
        }
        $node['vendor_credit_refund_id'] = (string) $id;
        return $node;
    }

    public function deleteVendorCreditRefund(string $vendorCreditId, string $refundId): void
    {
        $this->delete('vendorcredits/' . rawurlencode($vendorCreditId) . '/refunds/' . rawurlencode($refundId));
    }

    public function getVendorCredit(string $id): array
    {
        $r = $this->get('vendorcredits/' . rawurlencode($id));
        return $r['vendor_credit'] ?? $r['vendorcredit'] ?? [];
    }

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

    public function findOrCreateCustomerId(Customer $customer, ?string $gstin = null, ?string $stateCode = null): string
    {
        if (!empty($customer->zoho_contact_id)) return (string) $customer->zoho_contact_id;

        $name = trim((string) ($customer->company_name ?: $customer->legal_name));
        if ($name === '') {
            throw new RuntimeException('Customer has no company/legal name to register in Zoho Books.');
        }

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

    public function createEstimate(array $payload): array
    {
        $resp = $this->post('estimates', $payload);
        $est = $resp['estimate'] ?? null;
        $id  = $est['estimate_id'] ?? null;
        if (!$est || empty($id)) throw new RuntimeException('Zoho Books did not return an estimate id.');
        return $est;
    }

    public function createInvoice(array $payload): array
    {
        $resp = $this->post('invoices', $payload);
        $inv = $resp['invoice'] ?? null;
        $id  = $inv['invoice_id'] ?? null;
        if (!$inv || empty($id)) throw new RuntimeException('Zoho Books did not return an invoice id.');
        return $inv;
    }

    public function getEstimatePdf(string $zohoId): string
    {
        return $this->fetchPdf('estimates', $zohoId, 'estimate');
    }

    public function getInvoicePdf(string $zohoId): string
    {
        return $this->fetchPdf('invoices', $zohoId, 'invoice');
    }

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
