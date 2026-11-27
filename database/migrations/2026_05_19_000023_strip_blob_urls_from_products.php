<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('products')
            ->where('primary_image', 'like', 'blob:%')
            ->update(['primary_image' => null]);

        DB::table('products')
            ->whereNotNull('secondary_images')
            ->orderBy('id')
            ->chunkById(200, function ($rows) {
                foreach ($rows as $row) {
                    $arr = json_decode((string) $row->secondary_images, true);
                    if (!is_array($arr)) continue;

                    $filtered = array_values(array_filter(
                        $arr,
                        fn ($v) => is_string($v) && $v !== '' && !str_starts_with($v, 'blob:')
                    ));

                    if (count($filtered) !== count($arr)) {
                        DB::table('products')
                            ->where('id', $row->id)
                            ->update(['secondary_images' => json_encode($filtered)]);
                    }
                }
            });
    }

    public function down(): void
    {
    }
};
