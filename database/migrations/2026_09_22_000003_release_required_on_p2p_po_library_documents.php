<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('p2p_purchase_order_documents')
            ->whereNotNull('source_type')
            ->where('is_required', 'yes')
            ->update(['is_required' => 'no']);
    }

    public function down(): void
    {
    }
};
