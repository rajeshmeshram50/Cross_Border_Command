<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const TABLES = ['quotations', 'proforma_invoices'];

    public function up(): void
    {
        foreach (self::TABLES as $table) {
            Schema::table($table, function (Blueprint $t) {
                $t->string('dispatch_from', 255)->nullable();
                $t->string('deliver_to', 255)->nullable();
                $t->string('customer_gst_no', 20)->nullable();
            });
        }
    }

    public function down(): void
    {
        foreach (self::TABLES as $table) {
            Schema::table($table, function (Blueprint $t) {
                $t->dropColumn(['dispatch_from', 'deliver_to', 'customer_gst_no']);
            });
        }
    }
};
