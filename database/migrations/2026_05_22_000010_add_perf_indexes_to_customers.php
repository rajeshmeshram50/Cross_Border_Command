<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->index('created_by', 'customers_created_by_idx');
            $table->index('created_at', 'customers_created_at_idx');
            $table->index(['client_id', 'created_at'], 'customers_client_created_idx');
        });

        Schema::table('customer_addresses', function (Blueprint $table) {
            $table->index(['customer_id', 'cp_email'], 'cust_addr_cust_email_idx');
            $table->index(['customer_id', 'cp_contact'], 'cust_addr_cust_phone_idx');
        });
    }

    public function down(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->dropIndex('customers_created_by_idx');
            $table->dropIndex('customers_created_at_idx');
            $table->dropIndex('customers_client_created_idx');
        });

        Schema::table('customer_addresses', function (Blueprint $table) {
            $table->dropIndex('cust_addr_cust_email_idx');
            $table->dropIndex('cust_addr_cust_phone_idx');
        });
    }
};
