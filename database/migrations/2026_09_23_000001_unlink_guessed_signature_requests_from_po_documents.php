<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Stage 04 used to find a document's signature request by matching the
 * supplier and the CLM library id, because the request itself carries no
 * purchase order. That claimed requests raised from other screens: a document
 * this PO never sent showed as Signed, with its signed copy, certificate and
 * tracker all live.
 *
 * The link is now recorded when the PO sends (documents/mark-sent), so these
 * guessed links are dropped. The rows go back to pending and can be sent
 * again; nothing in Zoho or the CLM library is touched.
 */
return new class extends Migration
{
    public function up(): void
    {
        $ids = DB::table('p2p_purchase_order_documents as d')
            ->join('clm_signature_requests as s', 's.id', '=', 'd.signature_request_id')
            ->whereNotNull('d.source_type')                       // came from a CLM library
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
        // The guess is not worth restoring.
    }
};
