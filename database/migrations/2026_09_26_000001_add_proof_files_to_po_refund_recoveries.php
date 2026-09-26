<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A recovered payment could carry ONE proof: `proof_path` / `proof_name`. So a
 * user who uploaded the bank advice and then photographed the cheque kept only
 * whichever came second — the other was silently replaced (CS-567).
 *
 * `proof_files` holds the whole set, in the shape the inspection proofs already
 * use: [{ path, name, mime, size }]. The two old columns stay where they are
 * and keep pointing at the first file, so existing rows, the Zoho sync and the
 * download endpoint all carry on reading what they always read.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_po_refund_recoveries', function (Blueprint $table) {
            $table->json('proof_files')->nullable()->after('proof_name');
        });

        // Existing single proofs become a one-entry list, so every row is read
        // the same way from here on.
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
