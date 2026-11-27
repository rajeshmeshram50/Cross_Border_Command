<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('p2p_spi_boxes', 'flags')) {
            Schema::table('p2p_spi_boxes', function (Blueprint $table) {
                $table->json('flags')->nullable()->after('temp_max_c');
            });
        }

        DB::table('p2p_spi_box_items')
            ->whereNull('deleted_at')
            ->orderBy('box_id')
            ->get(['box_id', 'flags'])
            ->groupBy('box_id')
            ->each(function ($rows, $boxId) {
                $ids = $rows
                    ->flatMap(fn ($r) => (array) json_decode((string) $r->flags, true))
                    ->map(fn ($v) => (int) $v)
                    ->filter()
                    ->unique()
                    ->sort()
                    ->values()
                    ->all();

                if (!$ids) return;

                DB::table('p2p_spi_boxes')->where('id', $boxId)->update([
                    'flags' => json_encode($ids),
                ]);
            });
    }

    public function down(): void
    {
        if (Schema::hasColumn('p2p_spi_boxes', 'flags')) {
            Schema::table('p2p_spi_boxes', function (Blueprint $table) {
                $table->dropColumn('flags');
            });
        }
    }
};
