<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

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
