<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        foreach (['quotations', 'proforma_invoices'] as $table) {
            Schema::table($table, function (Blueprint $t) {
                $t->timestamp('emailed_at')->nullable()->after('status');
                $t->timestamp('last_reminded_at')->nullable()->after('emailed_at');
                $t->unsignedSmallInteger('reminder_count')->default(0)->after('last_reminded_at');
            });
        }
    }

    public function down(): void
    {
        foreach (['quotations', 'proforma_invoices'] as $table) {
            Schema::table($table, function (Blueprint $t) {
                $t->dropColumn(['emailed_at', 'last_reminded_at', 'reminder_count']);
            });
        }
    }
};
