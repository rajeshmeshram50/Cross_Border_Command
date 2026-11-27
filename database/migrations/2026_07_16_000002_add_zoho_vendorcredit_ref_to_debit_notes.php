<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('debit_notes', function (Blueprint $table) {
            $table->string('zoho_vendorcredit_id', 64)->nullable()->after('zoho_status');
            $table->string('zoho_vendorcredit_number', 64)->nullable()->after('zoho_vendorcredit_id');
            $table->decimal('zoho_applied_amount', 14, 2)->default(0)->after('zoho_vendorcredit_number');
            $table->timestamp('zoho_synced_at')->nullable()->after('zoho_applied_amount');
            $table->text('zoho_error')->nullable()->after('zoho_synced_at');
            $table->string('zoho_pdf_path', 255)->nullable()->after('zoho_error');
        });
    }

    public function down(): void
    {
        Schema::table('debit_notes', function (Blueprint $table) {
            $table->dropColumn([
                'zoho_vendorcredit_id', 'zoho_vendorcredit_number', 'zoho_applied_amount',
                'zoho_synced_at', 'zoho_error', 'zoho_pdf_path',
            ]);
        });
    }
};
