<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->string('gst_applicable', 8)->nullable()->after('risk_level');
        });

        Schema::create('customer_gst_scrutiny', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->constrained('customers')->cascadeOnDelete();

            $table->string('gst_number', 16);
            $table->string('status', 16)->default('Active');
            $table->date('last_filing_date')->nullable();
            $table->string('prev_non_gst_2a_invoice', 255)->nullable();
            $table->text('red_flags')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index('customer_id');
            $table->index('gst_number');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_gst_scrutiny');
        Schema::table('customers', function (Blueprint $table) {
            $table->dropColumn('gst_applicable');
        });
    }
};
