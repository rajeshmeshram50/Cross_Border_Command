<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Third-party subscription / integration expiry tracker.
 *
 * A GLOBAL (company-wide, super-admin managed) register of the paid external
 * services this software depends on — Zoho Sign, Zoho Books, Razorpay, Azure,
 * domains, SSL certs, API plans — each with a renewal date and a responsible
 * owner. A daily scheduled command (subscriptions:send-expiry-reminders) mails
 * that owner when the renewal date is approaching, using the per-row
 * `reminder_days` thresholds. Deliberately NOT scoped by client_id: these are
 * the SaaS operator's own vendor subscriptions, not any tenant's.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('integration_subscriptions', function (Blueprint $table) {
            $table->id();

            $table->string('name');                       // "Zoho Sign"
            $table->string('provider')->nullable();       // "Zoho"
            $table->string('category')->nullable();       // "E-signature", "Payments", "Storage", "Domain", "SSL"

            $table->string('owner_name')->nullable();     // responsible person
            $table->string('owner_email');                // reminder recipient (required)

            $table->date('expires_at');                   // renewal / expiry date
            // Days-before thresholds at which to remind, e.g. [30,15,7,1].
            // Configurable per service (that was the chosen behaviour).
            $table->json('reminder_days');

            $table->boolean('auto_renew')->default(false);
            // active | expired | cancelled — 'active' rows are the ones the
            // reminder command evaluates.
            $table->string('status')->default('active');

            $table->decimal('amount', 12, 2)->nullable(); // optional cost tracking
            $table->string('currency', 3)->default('INR');

            $table->text('notes')->nullable();

            // Which thresholds have already been mailed for the CURRENT expires_at.
            // Reset to [] whenever expires_at changes so a renewed service starts
            // a fresh reminder cycle. Prevents duplicate mails on repeated runs.
            $table->json('reminders_sent')->nullable();
            $table->date('last_reminded_on')->nullable();

            $table->unsignedBigInteger('created_by')->nullable();

            $table->timestamps();

            $table->index(['status', 'expires_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('integration_subscriptions');
    }
};
