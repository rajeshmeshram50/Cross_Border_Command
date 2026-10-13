<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Inventory · Product flags get the stored, per-branch code the others have.
 *
 * The fifth master was left behind by 2026_10_12_000008: warehouses, zones and
 * racks now store a code counted per branch, while a flag's code was still
 * 'PF-' . pad($this->id) off the model — one platform-wide sequence, so a
 * branch's first flag of its own could read PF-007.
 *
 * NUMBERING, and why it does not start at 001.
 * The three platform defaults (Hazardous, Cold Chain, Fragile) are owned by
 * nobody and appear on EVERY branch's picker, so their codes are spent in
 * every branch. A tenant's own first flag therefore continues after them —
 * PF-004 — and each branch numbers from there independently, so two branches
 * both call their first flag PF-004. Starting a tenant flag at 001 would print
 * PF-001 beside the shared Hazardous on the same dropdown.
 *
 * Unique on (client_id, branch_id, code), like the other three. A flag is not
 * scanned, so unlike a shelf label a reused number costs nothing — the
 * allocator counts live rows, and this table has no soft deletes.
 */
return new class extends Migration
{
    private const TABLE  = 'inventory_product_flags';
    private const PREFIX = 'PF-';

    public function up(): void
    {
        Schema::table(self::TABLE, function (Blueprint $t) {
            $t->string('code', 20)->nullable()->after('branch_id');
        });

        $this->backfill();

        Schema::table(self::TABLE, function (Blueprint $t) {
            $t->unique(['client_id', 'branch_id', 'code'], self::TABLE . '_code_unique');
        });
    }

    /**
     * Platform defaults first, in id order; every branch then continues from
     * where they stop, so an existing tenant flag keeps a code above theirs.
     */
    private function backfill(): void
    {
        $platform = DB::table(self::TABLE)
            ->whereNull('client_id')->whereNull('branch_id')
            ->orderBy('id')->pluck('id');

        foreach ($platform as $n => $id) {
            DB::table(self::TABLE)->where('id', $id)->update(['code' => $this->code($n + 1)]);
        }

        $offset = $platform->count();

        $groups = DB::table(self::TABLE)
            ->select('client_id', 'branch_id')
            ->whereNotNull('client_id')
            ->groupBy('client_id', 'branch_id')
            ->get();

        foreach ($groups as $g) {
            $ids = DB::table(self::TABLE)
                ->where('client_id', $g->client_id)
                ->when($g->branch_id === null,
                    fn ($q) => $q->whereNull('branch_id'),
                    fn ($q) => $q->where('branch_id', $g->branch_id))
                ->orderBy('id')->pluck('id');

            foreach ($ids as $n => $id) {
                DB::table(self::TABLE)->where('id', $id)->update(['code' => $this->code($offset + $n + 1)]);
            }
        }
    }

    private function code(int $n): string
    {
        return self::PREFIX . str_pad((string) $n, 3, '0', STR_PAD_LEFT);
    }

    public function down(): void
    {
        Schema::table(self::TABLE, function (Blueprint $t) {
            $t->dropUnique(self::TABLE . '_code_unique');
            $t->dropColumn('code');
        });
    }
};
