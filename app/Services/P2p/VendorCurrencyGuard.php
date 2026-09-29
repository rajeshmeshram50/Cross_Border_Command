<?php

namespace App\Services\P2p;

use App\Models\VendorCurrencyLock;
use App\Services\ZohoBooksService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * A supplier trades in one currency, because Zoho Books pins each contact to one
 * currency for life and rejects any transaction in another.
 *
 * `vendor_currency_locks` holds one row per supplier — the currency, and every
 * purchase order raised in it. Once any of those orders has reached Zoho Books
 * the currency is final, because the books cannot be made to forget it; until
 * then a lone draft may still change its mind.
 */
class VendorCurrencyGuard
{
    /** This supplier's row, or null when it has no purchase order yet. */
    public function lockFor(int $clientId, int $vendorId): ?VendorCurrencyLock
    {
        return VendorCurrencyLock::withoutGlobalScope('tenant')
            ->where('client_id', $clientId)
            ->where('vendor_id', $vendorId)
            ->first();
    }

    /** The currency this supplier trades in, or null when nothing has fixed it. */
    public function lockedCurrency(int $clientId, int $vendorId): ?string
    {
        $lock = $this->lockFor($clientId, $vendorId);

        return $lock ? strtoupper(trim((string) $lock->currency_code)) : null;
    }

    /**
     * Why this currency cannot be used on this supplier, or null when it can.
     *
     * Only a currency Zoho Books already holds can refuse one: until a supplier
     * is in the books nothing is committed anywhere, so its first orders may be
     * in any currency and the one that syncs first settles it. `$exceptPoId` is
     * kept for callers; a currency Zoho holds refuses every order alike.
     */
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

    /**
     * The currency a transaction of ours has already put in Zoho Books, or null.
     * This one refuses: a contact carrying a transaction cannot change currency.
     *
     * Deliberately not the currency merely *shown* on a contact. Every contact
     * made before we started sending one reads INR whether or not anyone chose
     * it, and an international PO may not be in INR — so refusing on a reading
     * would leave such a supplier with no usable currency at all.
     */
    public function settledCurrency(int $clientId, int $vendorId): ?string
    {
        $lock = $this->lockFor($clientId, $vendorId);

        return $lock && $lock->isSynced() ? strtoupper(trim((string) $lock->currency_code)) : null;
    }

    /** The order that put that currency in the books, so a refusal can name it. */
    public function settledByPo(int $clientId, int $vendorId): ?string
    {
        $lock = $this->lockFor($clientId, $vendorId);

        return $lock && $lock->isSynced() ? (($lock->po_codes[0] ?? null) ?: null) : null;
    }

    /**
     * The currency Zoho Books shows for this supplier, settled or not — what the
     * form offers as the supplier is picked. Null = not in the books yet.
     *
     * Answered from our own row when there is one. A contact made by another
     * module's sync (a supplier invoice, a debit note) leaves no row, so Zoho is
     * asked once and the answer kept, rather than called on every save.
     */
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
                /* Zoho unreachable, or the contact deleted there. Neither is a
                   reason to refuse a purchase order — the sync will say so if it
                   still matters, and findOrCreateVendorId heals a stale contact. */
                Log::warning('Vendor currency: Zoho contact unreadable', ['vendor' => $vendorId, 'err' => $e->getMessage()]);
                return '';
            }
        });

        if ($code === '') return null;
        /* Kept so the next Stage 01 answers from here instead of calling Zoho —
           as a reading, not as settled. Only a transaction of ours settles it. */
        $this->rememberZohoCurrency($clientId, $vendorId, $code, false);

        return $code;
    }

    /**
     * Record the currency Zoho Books holds for this supplier. `$settled` says a
     * transaction of ours put it there, which is what makes it refuse later
     * orders; a plain reading of the contact does not.
     */
    public function rememberZohoCurrency(int $clientId, int $vendorId, string $currency, bool $settled = true): void
    {
        $currency = strtoupper(trim($currency));
        if ($currency === '') return;

        // The row is the answer now, so the cached read must not outlive it.
        Cache::forget('vendor_zoho_ccy:' . $clientId . ':' . $vendorId);

        $lock = $this->lockFor($clientId, $vendorId);
        if ($lock) {
            // Settled once, settled for good — a later reading cannot undo it.
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

    /**
     * Record this PO against its supplier's currency, creating the supplier's row
     * on the first order. A PO that does not match an established currency is not
     * added — Stage 01 refuses those before they get here.
     */
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

        /* The only draft holding the currency changed to another one: it is still
           free to, so the row follows it rather than stranding the supplier on a
           currency nothing uses. */
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

    /**
     * Drop a cancelled or deleted PO's claim. A row that nothing holds any more,
     * and that never reached Zoho Books, goes with it so the supplier is free
     * again; a synced row keeps its currency whatever happens to the order.
     */
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
