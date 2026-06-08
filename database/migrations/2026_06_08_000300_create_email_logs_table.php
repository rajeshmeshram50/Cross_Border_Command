<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Email history ("Gmail" menu) — one row per outbound email the system sends.
 *
 * Every Mail::send across the app is captured automatically by the
 * App\Listeners\LogSentEmail listener (wired to the MessageSent event), so no
 * sending site needs to be edited. The compose/send box on the Gmail page
 * writes through the SAME path — it just dispatches a ComposedEmail mailable
 * which the listener records like any other.
 *
 * Tenant + recipient mapping:
 *   - client_id / branch_id are resolved from the authenticated sender at send
 *     time, falling back to the recipient's own user/employee row. This is what
 *     powers the "branch-related" and "employee-related" tabs on the page.
 *   - employee_id is set when the recipient address matches an employee, so a
 *     branch admin can see every mail tied to a given staff member.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('email_logs', function (Blueprint $table) {
            $table->id();

            // Tenant + ownership — same scoping rules as announcements etc.
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            // The user who triggered the send (auth()->user() at send time),
            // null for system/unauthenticated sends (e.g. forgot-password OTP).
            $table->unsignedBigInteger('user_id')->nullable()->index();
            // Recipient mapping — set when the "to" address belongs to an
            // employee of this tenant. Drives the "By Employee" tab.
            $table->unsignedBigInteger('employee_id')->nullable()->index();

            // outbound today; column kept for a future inbound/sync feature.
            $table->string('direction', 12)->default('outbound');

            // Short bucket derived from the mailable class name (otp, payslip,
            // announcement, composed, …) so the UI can group/filter by kind.
            $table->string('category', 40)->nullable()->index();
            $table->string('mailable_class', 191)->nullable();

            // Envelope.
            $table->string('from_email', 191)->nullable();
            $table->string('from_name', 191)->nullable();
            $table->string('to_email', 191)->nullable()->index();
            $table->string('to_name', 191)->nullable();
            $table->json('cc')->nullable();
            $table->json('bcc')->nullable();

            // Content.
            $table->string('subject', 255)->nullable();
            $table->longText('body_html')->nullable();
            $table->longText('body_text')->nullable();
            $table->boolean('has_attachments')->default(false);

            // sent | failed.
            $table->string('status', 12)->default('sent');
            $table->text('error')->nullable();

            $table->timestamp('sent_at')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['client_id', 'branch_id'], 'email_logs_tenant_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('email_logs');
    }
};
