<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_purchase_order_documents', function (Blueprint $t) {
            $t->enum('needed', ['yes', 'no'])->nullable()->after('is_required');
            $t->unsignedBigInteger('needed_by')->nullable()->after('needed');
            $t->timestamp('needed_at')->nullable()->after('needed_by');
        });
    }

    public function down(): void
    {
        Schema::table('p2p_purchase_order_documents', function (Blueprint $t) {
            $t->dropColumn(['needed', 'needed_by', 'needed_at']);
        });
    }
};
