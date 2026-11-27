<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('consignees', function (Blueprint $table) {
            $table->boolean('same_as_customer')->default(false)->after('status');
            $table->index(['customer_id', 'same_as_customer']);
        });
    }

    public function down(): void
    {
        Schema::table('consignees', function (Blueprint $table) {
            $table->dropIndex(['customer_id', 'same_as_customer']);
            $table->dropColumn('same_as_customer');
        });
    }
};
