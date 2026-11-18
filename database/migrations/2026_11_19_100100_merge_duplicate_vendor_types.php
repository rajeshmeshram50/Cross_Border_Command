<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Fold per-tenant Supplier Types onto the global ones they duplicate.
 *
 * 2026_11_19_100000 seeded the ten canonical types at global scope using the
 * Figma spelling ("Material/ Goods"). Tenants that had already created the same
 * type under the older spelling ("Material / Goods") were left with BOTH rows,
 * so their Supplier Type dropdown lists the same type twice and their suppliers
 * sit on the non-system copy.
 *
 * Matching is on the name with spacing and case normalised away, so the two
 * spellings resolve to one key. Only a row that matches a canonical name is
 * touched: a tenant type with no counterpart ("Logistic", "Services") is left
 * ACTIVE as a legacy bucket — its `kind` already files it correctly, and
 * guessing which leaf it belongs to would put a label on a supplier that
 * nobody chose.
 *
 * Suppliers are repointed first, then the duplicate is deactivated rather than
 * deleted: the row leaves the dropdown but stays recoverable, and nothing is
 * orphaned if a reference is found later.
 *
 * Idempotent — a second run finds nothing left to repoint.
 */
return new class extends Migration
{
    /** "Material / Goods" and "Material/ Goods" both key to "material/goods". */
    private function norm(?string $name): string
    {
        $n = mb_strtolower(trim((string) $name));
        $n = preg_replace('/\s*\/\s*/', '/', $n);   // spaces around a slash
        return preg_replace('/\s+/', ' ', $n);       // collapse the rest
    }

    public function up(): void
    {
        $canonical = [];
        foreach (DB::table('master_vendor_types')->whereNull('client_id')->where('is_system', true)->get(['id', 'name']) as $g) {
            $canonical[$this->norm($g->name)] = (int) $g->id;
        }
        if (empty($canonical)) return;   // 100000 has not run; nothing to fold

        $dupes = DB::table('master_vendor_types')->whereNotNull('client_id')->get(['id', 'client_id', 'name']);

        foreach ($dupes as $row) {
            $globalId = $canonical[$this->norm($row->name)] ?? null;
            if (!$globalId) continue;    // no counterpart — legacy row, left alone

            DB::table('vendors')
                ->where('vendor_type_id', $row->id)
                ->update(['vendor_type_id' => $globalId, 'updated_at' => now()]);

            DB::table('master_vendor_types')
                ->where('id', $row->id)
                ->update(['status' => 'Inactive', 'updated_at' => now()]);
        }
    }

    /**
     * Reactivates the folded rows. The suppliers are NOT moved back: which
     * tenant row each one came from is no longer recorded, and sending them to
     * the wrong copy would be worse than leaving them on the canonical type
     * they now correctly carry.
     */
    public function down(): void
    {
        $canonical = [];
        foreach (DB::table('master_vendor_types')->whereNull('client_id')->where('is_system', true)->get(['id', 'name']) as $g) {
            $canonical[$this->norm($g->name)] = (int) $g->id;
        }

        foreach (DB::table('master_vendor_types')->whereNotNull('client_id')->where('status', 'Inactive')->get(['id', 'name']) as $row) {
            if (isset($canonical[$this->norm($row->name)])) {
                DB::table('master_vendor_types')->where('id', $row->id)
                    ->update(['status' => 'Active', 'updated_at' => now()]);
            }
        }
    }
};
