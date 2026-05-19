<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Pre-upload-fix rows have `blob:http://localhost:.../<uuid>` strings
 * baked into `primary_image` and `secondary_images`. Those URLs only ever
 * existed in the browser session that created them and now serve no
 * purpose — strip them so the URL accessors stop emitting
 * `/storage/blob:...` garbage.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Null out blob:* primary images.
        DB::table('products')
            ->where('primary_image', 'like', 'blob:%')
            ->update(['primary_image' => null]);

        // Secondary images is a JSON column — re-encode per row, removing
        // any blob: entries.
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
        // No-op: the stripped values were unrecoverable garbage.
    }
};
