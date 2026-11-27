<?php

namespace App\Services\P2p;

use App\Models\VendorCurrencyLock;
use App\Services\ZohoBooksService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class VendorCurrencyGuard
{
    public function lockFor(int $clientId, int $vendorId): ?VendorCurrencyLock
    {
        return VendorCurrencyLock::withoutGlobalScope('tenant')
            ->where('client_id', $clientId)
            ->where('vendor_id', $vendorId)
            ->first();
    }

    public function lockedCurrency(int $clientId, int $vendorId): ?string
    {
        $lock = $this->lockFor($clientId, $vendorId);

        return $lock ? strtoupper(trim((string) $lock->currency_code)) : null;
    }

    public function conflict(int $clientId, int $vendorId, ?string $currency, ?int $exceptPoId = null): ?string
    {
        $currency = strtoupper(trim((string) $currency));
        if ($currency === '') return null;

        $locked = $this->settledCurrency($clientId, $vendorId);
        if ($locked === null || $locked === $currency) return null;

        $lock = $this->lockFor($clientId, $vendorId);
        $by = ($lock?->po_codes[0] ?? null) ?: null;

        return "This supplier trades in {$locked} — a {$currency} purchase order cannot be raised on it."
            . ($by ? " {$by} is already in Zoho Books," : ' It is already in Zoho Books,')
            . " and a contact's currency cannot change once it carries transactions.";
    }

    public function settledCurrency(int $clientId, int $vendorId): ?string
    {
        $lock = $this->lockFor($clientId, $vendorId);

        return $lock && $lock->isSynced() ? strtoupper(trim((string) $lock->currency_code)) : null;
    }

    public function settledByPo(int $clientId, int $vendorId): ?string
    {
        $lock = $this->lockFor($clientId, $vendorId);

        return $lock && $lock->isSynced() ? (($lock->po_codes[0] ?? null) ?: null) : null;
    }

    public function currencyInZoho(int $clientId, int $vendorId): ?string
    {
        $lock = $this->lockFor($clientId, $vendorId);
        if ($lock) return strtoupper(trim((string) $lock->currency_code));

        $contactId = DB::table('vendors')->where('id', $vendorId)->value('zoho_contact_id');
        if (!$contactId) return null;

        $key = 'vendor_zoho_ccy:' . $clientId . ':' . $vendorId;
        $code = Cache::remember($key, now()->addMinutes(30), function () use ($contactId, $vendorId) {
            try {
                $books = app(ZohoBooksService::class);
                if (!$books->isConfigured()) return '';

                return strtoupper(trim((string) ($books->contactCurrency((string) $contactId) ?? '')));
            } catch (\Throwable $e) {
                Log::warning('Vendor currency: Zoho contact unreadable', ['vendor' => $vendorId, 'err' => $e->getMessage()]);
                return '';
            }
        });

        if ($code === '') return null;
        $this->rememberZohoCurrency($clientId, $vendorId, $code, false);

        return $code;
    }

    public function rememberZohoCurrency(int $clientId, int $vendorId, string $currency, bool $settled = true): void
    {
        $currency = strtoupper(trim($currency));
        if ($currency === '') return;

        Cache::forget('vendor_zoho_ccy:' . $clientId . ':' . $vendorId);

        $lock = $this->lockFor($clientId, $vendorId);
        if ($lock) {
            $attrs = ['currency_code' => $currency];
            if ($settled) $attrs['zoho_synced'] = VendorCurrencyLock::SYNCED_YES;
            $lock->forceFill($attrs)->save();
            return;
        }

        VendorCurrencyLock::withoutGlobalScope('tenant')->create([
            'client_id'     => $clientId,
            'vendor_id'     => $vendorId,
            'supplier_code' => DB::table('vendors')->where('id', $vendorId)->value('vendor_code'),
            'po_ids'        => [],
            'po_codes'      => [],
            'currency_code' => $currency,
            'zoho_synced'   => $settled ? VendorCurrencyLock::SYNCED_YES : VendorCurrencyLock::SYNCED_NO,
        ]);
    }

    public function remember(
        int $clientId,
        ?int $branchId,
        int $vendorId,
        int $poId,
        ?string $poCode,
        ?string $currency,
        ?string $supplierCode = null,
    ): void {
        $currency = strtoupper(trim((string) ($currency ?: 'INR')));
        $lock = $this->lockFor($clientId, $vendorId);

        if (!$lock) {
            VendorCurrencyLock::withoutGlobalScope('tenant')->create([
                'client_id'     => $clientId,
                'branch_id'     => $branchId,
                'vendor_id'     => $vendorId,
                'supplier_code' => $supplierCode ?: DB::table('vendors')->where('id', $vendorId)->value('vendor_code'),
                'po_ids'        => [$poId],
                'po_codes'      => array_values(array_filter([$poCode])),
                'currency_code' => $currency,
                'zoho_synced'   => VendorCurrencyLock::SYNCED_NO,
            ]);
            return;
        }

        $ids = array_map('intval', $lock->po_ids ?? []);
        $codes = $lock->po_codes ?? [];

        if (strtoupper(trim((string) $lock->currency_code)) !== $currency) {
            if ($lock->isSynced() || array_values(array_diff($ids, [$poId]))) return;
            $lock->currency_code = $currency;
        }

        if (!in_array($poId, $ids, true)) {
            $ids[] = $poId;
            if ($poCode) $codes[] = $poCode;
        }

        $lock->po_ids = array_values($ids);
        $lock->po_codes = array_values(array_unique($codes));
        $lock->save();
    }

    public function forget(int $clientId, int $vendorId, int $poId): void
    {
        $lock = $this->lockFor($clientId, $vendorId);
        if (!$lock || $lock->isSynced()) return;

        $ids = array_values(array_filter(array_map('intval', $lock->po_ids ?? []), fn ($id) => $id !== $poId));
        if (!$ids) { $lock->delete(); return; }

        $codes = DB::table('p2p_purchase_orders')->whereIn('id', $ids)->orderBy('id')->pluck('code')->all();
        $lock->po_ids = $ids;
        $lock->po_codes = $codes;
        $lock->save();
    }
}
