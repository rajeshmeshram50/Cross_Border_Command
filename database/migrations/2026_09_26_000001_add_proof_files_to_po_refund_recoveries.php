<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_po_refund_recoveries', function (Blueprint $table) {
            $table->json('proof_files')->nullable()->after('proof_name');
        });

        DB::table('p2p_po_refund_recoveries')
            ->whereNotNull('proof_path')
            ->orderBy('id')
            ->chunkById(200, function ($rows) {
                foreach ($rows as $r) {
                    DB::table('p2p_po_refund_recoveries')->where('id', $r->id)->update([
                        'proof_files' => json_encode([[
                            'path' => $r->proof_path,
                            'name' => $r->proof_name ?: basename($r->proof_path),
                            'mime' => null,
                            'size' => null,
                        ]]),
                    ]);
                }
            });
    }

    public function down(): void
    {
        Schema::table('p2p_po_refund_recoveries', function (Blueprint $table) {
            $table->dropColumn('proof_files');
        });
    }
};
