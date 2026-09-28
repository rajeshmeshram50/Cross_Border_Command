<?php

namespace App\Services\P2p;

use App\Models\VendorCurrencyLock;
use Illuminate\Support\Facades\DB;

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
     * The PO being edited is discounted: a draft that is the only thing holding
     * the currency, and has not reached Zoho Books, may still change it.
     */
    public function conflict(int $clientId, int $vendorId, ?string $currency, ?int $exceptPoId = null): ?string
    {
        $currency = strtoupper(trim((string) $currency));
        if ($currency === '') return null;

        $lock = $this->lockFor($clientId, $vendorId);
        if (!$lock) return null;

        $locked = strtoupper(trim((string) $lock->currency_code));
        if ($locked === $currency) return null;

        // Nothing but this PO holds the currency, and it never reached the books.
        $held = array_values(array_filter($lock->po_ids ?? [], fn ($id) => (int) $id !== (int) $exceptPoId));
        if (!$held && !$lock->isSynced()) return null;

        $by = ($lock->po_codes[0] ?? null) ?: 'its first order';
        $set = $lock->isSynced()
            ? " {$by} is already in Zoho Books, and a contact's currency cannot change once it carries transactions."
            : " It was set by {$by}.";

        return "This supplier trades in {$locked} — a {$currency} purchase order cannot be raised on it." . $set;
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

    /** This supplier's currency is now in Zoho Books, so it can no longer be undone. */
    public function markSynced(int $clientId, int $vendorId): void
    {
        VendorCurrencyLock::withoutGlobalScope('tenant')
            ->where('client_id', $clientId)
            ->where('vendor_id', $vendorId)
            ->update(['zoho_synced' => VendorCurrencyLock::SYNCED_YES, 'updated_at' => now()]);
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
