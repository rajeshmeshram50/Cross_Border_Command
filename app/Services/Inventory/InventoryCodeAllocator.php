<?php

namespace App\Services\Inventory;

use Illuminate\Support\Facades\DB;

/**
 * Inventory masters · the next code for a branch, allocated under a lock.
 *
 * WHY NOT THE ID
 * The codes used to be `'WH-' . pad($row->id)`, and an id comes from a
 * sequence. A sequence hands its number out OUTSIDE the transaction and never
 * takes it back: a failed insert or a rolled-back save burns the number for
 * good. That is correct for an id — two writers must get different ones
 * without waiting to see who commits — and wrong for a code, which a person
 * reads off a shelf and expects to run 001, 002, 003.
 *
 * A LOCK is the difference. It is held for the length of the transaction and
 * released when it ends, however it ends. Roll back and the number is free
 * again, which is exactly what a sequence cannot do.
 *
 * PER BRANCH, by decision: each branch counts from 001, so three branches each
 * have a WH-001. The code is therefore not unique on its own — the unique
 * index is (client_id, branch_id, code), and anything resolving a scanned
 * label must already know the branch. The QR carries the row id for that
 * reason.
 *
 * Same shape as SupplierInvoiceService::allocate(), deliberately: one way of
 * issuing a code in this codebase is enough.
 */
class InventoryCodeAllocator
{
    /** table => prefix. Shelves derive from their rack and are not allocated. */
    public const PREFIX = [
        'inventory_warehouses' => 'WH-',
        'inventory_zones'      => 'ZN-',
        'inventory_racks'      => 'RK-',
    ];

    /**
     * The next free code in this branch. CALL INSIDE A TRANSACTION.
     *
     * The BRANCH row is locked, not the client's: two branches numbering at the
     * same moment are independent sequences and must not block each other,
     * while two saves within one branch must. Locking the client would
     * serialise every branch in the company behind one row.
     *
     * Gaps are possible and intended — a code someone deleted is not reused,
     * because it may be on a label stuck to a shelf. The highest ever issued
     * is what counts, so deleted rows are included.
     */
    public function next(string $table, ?int $clientId, ?int $branchId): string
    {
        $prefix = self::PREFIX[$table] ?? abort(500, "No code prefix for {$table}.");

        if ($branchId !== null) {
            DB::table('branches')->where('id', $branchId)->lockForUpdate()->first();
        } elseif ($clientId !== null) {
            // A client-wide row has no branch to lock; the client will do.
            DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        }

        return $this->build($table, $prefix, $clientId, $branchId);
    }

    /** What the next code WOULD be. Read only — nothing locked or reserved. */
    public function peek(string $table, ?int $clientId, ?int $branchId): string
    {
        $prefix = self::PREFIX[$table] ?? abort(500, "No code prefix for {$table}.");

        return $this->build($table, $prefix, $clientId, $branchId);
    }

    /**
     * Highest number ever issued in this branch, plus one.
     *
     * Trashed rows are not excluded on purpose: a code that has been printed
     * and stuck on a shelf must never answer to something else, so a deleted
     * one leaves a permanent gap. Same rule as the SPI box codes.
     */
    private function build(string $table, string $prefix, ?int $clientId, ?int $branchId): string
    {
        $codes = DB::table($table)
            ->when($clientId === null,
                fn ($q) => $q->whereNull('client_id'),
                fn ($q) => $q->where('client_id', $clientId))
            ->when($branchId === null,
                fn ($q) => $q->whereNull('branch_id'),
                fn ($q) => $q->where('branch_id', $branchId))
            ->whereNotNull('code')
            ->pluck('code');

        $max   = 0;
        $regex = '/^' . preg_quote($prefix, '/') . '(\d+)$/i';

        foreach ($codes as $code) {
            if (preg_match($regex, (string) $code, $m)) {
                $max = max($max, (int) $m[1]);
            }
        }

        return $prefix . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);
    }
}
