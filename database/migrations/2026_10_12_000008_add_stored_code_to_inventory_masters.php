<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
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
                $t->unique(['client_id', 'branch_id', 'code'], "{$table}_code_unique");
            });
        }
    }

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
