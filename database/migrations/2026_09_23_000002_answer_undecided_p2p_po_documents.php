<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('p2p_purchase_order_documents')->whereNull('needed')
            ->where('doc_kind', 'purchase_order')->update(['needed' => 'yes']);

        DB::table('p2p_purchase_order_documents')->whereNull('needed')
            ->where(fn ($q) => $q->where('doc_kind', '!=', 'purchase_order')->orWhereNull('doc_kind'))
            ->update(['needed' => 'no']);
    }

    public function down(): void
    {
    }
};
