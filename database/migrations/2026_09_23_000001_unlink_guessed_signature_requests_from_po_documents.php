<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $ids = DB::table('p2p_purchase_order_documents as d')
            ->join('clm_signature_requests as s', 's.id', '=', 'd.signature_request_id')
            ->whereNotNull('d.source_type')
            ->whereIn('s.document_type', ['trade_doc', 'agreement'])
            ->pluck('d.id');

        if ($ids->isEmpty()) return;

        DB::table('p2p_purchase_order_documents')->whereIn('id', $ids)->update([
            'signature_request_id' => null,
            'status'               => 'pending',
            'sent_at'              => null,
            'signed_at'            => null,
        ]);
    }

    public function down(): void
    {
    }
};
