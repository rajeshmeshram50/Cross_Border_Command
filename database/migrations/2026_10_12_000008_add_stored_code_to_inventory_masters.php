<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Inventory · The code becomes a stored value, numbered per branch.
 *
 * It used to be computed from the row id — 'WH-' . pad($this->id) — and that
 * id comes from ONE sequence shared by every client and branch. Two things
 * followed, both visible to the user:
 *
 *   · the number counted the whole platform, so a branch's first warehouse
 *     could be WH-010;
 *   · nextval() is handed out OUTSIDE the transaction, so a failed insert or
 *     a rolled-back save burned a number permanently and left a hole in a
 *     code people read off a shelf.
 *
 * An id may have gaps — it only has to be unique. A CODE is read, printed and
 * searched for, so it has to count something a person recognises. Those are
 * different jobs and one column cannot do both.
 *
 * NUMBERED PER BRANCH, by decision: each branch starts again at 001, so three
 * branches each have their own WH-001. The code is therefore NOT unique on its
 * own — the unique index is (client_id, branch_id, code), and anything
 * resolving a scanned label must know the branch. The QR payload carries the
 * row id for exactly that reason; see BaseInventoryController::qr().
 *
 * Shelves get no column: a shelf code is its RACK's code plus the level
 * (RK-003-SH-02), so it follows the rack's stored code automatically.
 */
return new class extends Migration
{
    /** table => prefix. Shelves are derived from their rack and are not here. */
    private const TABLES = [
        'inventory_warehouses' => 'WH-',
        'inventory_zones'      => 'ZN-',
        'inventory_racks'      => 'RK-',
    ];

    public function up(): void
    {
        foreach (self::TABLES as $table => $prefix) {
            Schema::table($table, function (Blueprint $t) {
                $t->string('code', 20)->nullable()->after('branch_id');
            });

            $this->backfill($table, $prefix);

            Schema::table($table, function (Blueprint $t) use ($table) {
                /* Per branch, not globally: WH-001 exists once in each branch
                   and that is the point. A null branch_id is its own slot,
                   which Postgres treats as distinct from any other value —
                   acceptable here because a client-wide location is not a
                   thing these masters create. */
                $t->unique(['client_id', 'branch_id', 'code'], "{$table}_code_unique");
            });
        }
    }

    /**
     * Number the existing rows per branch, oldest first.
     *
     * In id order so the sequence matches the order they were created — the
     * first warehouse a branch made is its WH-001, which is the answer anyone
     * looking at the list expects.
     */
    private function backfill(string $table, string $prefix): void
    {
        $groups = DB::table($table)
            ->select('client_id', 'branch_id')
            ->groupBy('client_id', 'branch_id')
            ->get();

        foreach ($groups as $g) {
            $ids = DB::table($table)
                ->when(
                    $g->client_id === null,
                    fn($q) => $q->whereNull('client_id'),
                    fn($q) => $q->where('client_id', $g->client_id)
                )
                ->when(
                    $g->branch_id === null,
                    fn($q) => $q->whereNull('branch_id'),
                    fn($q) => $q->where('branch_id', $g->branch_id)
                )
                ->orderBy('id')
                ->pluck('id');

            foreach ($ids as $n => $id) {
                DB::table($table)->where('id', $id)->update([
                    'code' => $prefix . str_pad((string) ($n + 1), 3, '0', STR_PAD_LEFT),
                ]);
            }
        }
    }

    public function down(): void
    {
        foreach (array_keys(self::TABLES) as $table) {
            Schema::table($table, function (Blueprint $t) use ($table) {
                $t->dropUnique("{$table}_code_unique");
                $t->dropColumn('code');
            });
        }
    }
};
