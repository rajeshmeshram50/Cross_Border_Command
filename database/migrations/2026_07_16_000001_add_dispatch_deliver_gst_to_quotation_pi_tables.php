<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Domestic Quotation / PI: capture where the goods leave from, where they
 * land, and the customer's GSTIN as quoted.
 *
 * `customer_gst_no` is snapshotted onto the document rather than read live
 * off the customer — the same reason `customer_name` / `bank_label` are
 * cached here. A GSTIN printed on an issued quotation must not silently
 * change when the customer master is later edited.
 *
 * No column ordering (`after()`) — this schema runs on PostgreSQL.
 */
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
