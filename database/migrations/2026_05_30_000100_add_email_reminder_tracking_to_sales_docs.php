<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds email + reminder tracking to Quotations and Proforma Invoices.
 *
 *   - emailed_at         when the initial document email was sent to the customer
 *   - last_reminded_at   last time a reminder was sent (null if none yet)
 *   - reminder_count     how many reminders have been sent (drives the UI badge)
 *
 * The UI uses `emailed_at` to gate which button is active:
 *   - emailed_at == null  → "Email" enabled, "Reminder" disabled
 *   - emailed_at != null  → "Email" disabled (initial email already went out),
 *                           "Reminder" enabled
 *
 * Reminder sends only update last_reminded_at + reminder_count, never the
 * original emailed_at — that column is the "first send" anchor.
 */
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
