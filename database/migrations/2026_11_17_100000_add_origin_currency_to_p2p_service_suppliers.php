<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_service_suppliers', function (Blueprint $table) {
            if (! Schema::hasColumn('p2p_service_suppliers', 'origin')) {
                $table->string('origin', 16)->default('domestic')->after('vendor_id');
            }
            if (! Schema::hasColumn('p2p_service_suppliers', 'currency_code')) {
                $table->string('currency_code', 8)->default('INR')->after('origin');
            }
            if (! Schema::hasColumn('p2p_service_suppliers', 'exchange_rate')) {
                $table->decimal('exchange_rate', 14, 4)->nullable()->after('total_amount');
            }
            if (! Schema::hasColumn('p2p_service_suppliers', 'inr_amount')) {
                $table->decimal('inr_amount', 14, 2)->nullable()->after('exchange_rate');
            }
        });

        DB::table('p2p_service_suppliers')->whereNull('inr_amount')->update(['inr_amount' => DB::raw('total_amount')]);
    }

    public function down(): void
    {
        Schema::table('p2p_service_suppliers', function (Blueprint $table) {
            foreach (['origin', 'currency_code', 'exchange_rate', 'inr_amount'] as $c) {
                if (Schema::hasColumn('p2p_service_suppliers', $c)) {
                    $table->dropColumn($c);
                }
            }
        });
    }
};
