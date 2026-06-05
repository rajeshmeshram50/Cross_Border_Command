<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Re-lock the Address Types master to EXACTLY three fixed entries:
 *
 *   1. Registered Office
 *   2. Warehouse
 *   3. Branch
 *
 * Supersedes the earlier set (Warehouse / Registered Address / Billing
 * Address): "Billing Address" is dropped in favour of "Branch", and the
 * canonical name is "Registered Office" (not "Registered Address").
 *
 * All three are pinned as global `is_system = true` rows, so the master UI +
 * MasterController block create / edit / delete on them. Everything else
 * (old system rows like Billing Address, and any per-tenant custom rows) is
 * removed so this vocabulary is identical for every tenant.
 *
 * FK-safe: address `type` columns on consignee/customer/vendor/employee
 * addresses are plain strings, so deleting master rows never breaks existing
 * records — they keep their stored value, they just can't be re-picked.
 */
return new class extends Migration
{
    private array $fixed = ['Registered Office', 'Warehouse', 'Branch'];

    public function up(): void
    {
        $now = now();

        // Normalise the prior "Registered Address" naming back to the canonical
        // "Registered Office" so we keep (not duplicate) that row.
        DB::table('master_address_types')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->whereRaw('LOWER(name) = ?', ['registered address'])
            ->update(['name' => 'Registered Office', 'is_system' => true, 'status' => 'Active', 'updated_at' => $now]);

        // Upsert each of the three as a pinned global system row.
        foreach ($this->fixed as $name) {
            $row = DB::table('master_address_types')
                ->whereNull('client_id')
                ->whereNull('branch_id')
                ->whereRaw('LOWER(name) = ?', [strtolower($name)])
                ->first();

            if ($row) {
                DB::table('master_address_types')->where('id', $row->id)->update([
                    'name'       => $name,
                    'is_system'  => true,
                    'status'     => 'Active',
                    'updated_at' => $now,
                ]);
            } else {
                DB::table('master_address_types')->insert([
                    'client_id'  => null,
                    'branch_id'  => null,
                    'name'       => $name,
                    'status'     => 'Active',
                    'is_system'  => true,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        }

        // Delete everything that isn't one of the three fixed — the old
        // "Billing Address" system row + any tenant custom rows.
        DB::table('master_address_types')
            ->whereRaw('LOWER(name) NOT IN (?, ?, ?)', ['registered office', 'warehouse', 'branch'])
            ->delete();
    }

    public function down(): void
    {
        // Forward-only re-lock — nothing to roll back. The "Branch" row can be
        // removed manually if you ever need the older set again.
    }
};
