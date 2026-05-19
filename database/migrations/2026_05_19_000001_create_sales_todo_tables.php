<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sales Matrix → Productivity Tracker.
 *
 * Two tables sit behind the /sales/todo page:
 *
 *   sales_reminders — one row per "Reminder" the user creates (follow-up,
 *     document chase, payment chase, etc.). Status alternates between
 *     'In Progress' and 'Done'. Optional attachment lives on disk; only
 *     the relative path is stored here.
 *
 *   sales_meetings — one row per Virtual or Physical meeting. Tracks
 *     customer details, platform/venue, time window, and lifecycle
 *     ('In Progress' → 'Done' | 'Postponed' | 'Cancelled'). Each row
 *     carries an auto-numbered code (M-### for virtual, P-### for
 *     physical) scoped per (client_id, branch_id).
 *
 * Both tables follow the project's standard tenant-scoping pattern:
 * client_id + branch_id stamped on every row + created_by_user_id for
 * ownership. Soft-deleted so accidentally removed rows can be restored
 * by an admin if needed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sales_reminders', function (Blueprint $table) {
            $table->id();

            // Tenant scope — mirrors the rest of the app (Announcement /
            // ExpenseClaim / HrDocumentTemplate). Nullable on client_id so
            // super_admin-created rows don't break the schema; production
            // tenant-scoped rows are NOT NULL via controller validation.
            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            // Ownership — the User who created the reminder. employee_id
            // is denormalised from User.employee_id so list queries scoped
            // to "my reminders" don't have to join through users every time.
            $table->foreignId('created_by_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('employee_id')->nullable()->constrained('employees')->nullOnDelete();

            // Reminder body
            $table->string('opp_id', 60)->nullable()->index();
            $table->date('opp_date')->nullable();
            $table->string('subject', 255);
            $table->date('set_date');
            // Free-text TAT bucket so frontend can offer "24 Hours", "48 Hours",
            // "1 Week", or any future custom label without a schema change.
            $table->string('tat', 60)->default('24 Hours');
            $table->text('remark')->nullable();
            // Relative storage path (e.g. 'sales-todo/reminders/c1/2026/...');
            // resolve via file_url() at read time.
            $table->string('attachment_path', 1024)->nullable();
            $table->string('attachment_original_name', 255)->nullable();

            // Lifecycle — only two states for reminders (In Progress / Done).
            // String enum so adding 'Cancelled' later is a one-line change.
            $table->string('status', 32)->default('In Progress')->index();

            $table->timestamps();
            $table->softDeletes();

            $table->index(['client_id', 'branch_id', 'status']);
            $table->index(['created_by_user_id', 'status']);
            $table->index('set_date');
        });

        Schema::create('sales_meetings', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            $table->foreignId('created_by_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('employee_id')->nullable()->constrained('employees')->nullOnDelete();

            // Auto-numbered code (M-### for virtual, P-### for physical).
            // Unique within (client_id, branch_id) — enforced via composite
            // index in the migration + controller-side allocateCode() for
            // generation. Not globally unique because two tenants can both
            // legitimately have M-001.
            $table->string('code', 30);

            $table->string('opp_id', 60)->nullable()->index();
            $table->string('customer', 255);
            $table->string('email', 191)->nullable();
            $table->string('contact', 50)->nullable();

            // Platform/Meeting Type — free text so custom platforms work
            // without enum migration. SPA validates against a known list
            // but accepts anything.
            $table->string('platform', 100)->nullable();

            $table->date('date');
            $table->time('start_time')->nullable();
            $table->time('end_time')->nullable();

            // Virtual → link populated, venue null. Physical → venue
            // populated, link null. Both nullable so partial saves work.
            $table->text('link')->nullable();
            $table->text('venue')->nullable();

            $table->text('agenda')->nullable();

            $table->string('status', 32)->default('In Progress')->index();
            $table->string('type', 16)->default('virtual')->index();  // 'virtual' | 'physical'

            $table->timestamps();
            $table->softDeletes();

            $table->unique(['client_id', 'branch_id', 'code'], 'sales_meetings_code_tenant_unique');
            $table->index(['client_id', 'branch_id', 'type', 'status']);
            $table->index(['created_by_user_id', 'status']);
            $table->index('date');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sales_meetings');
        Schema::dropIfExists('sales_reminders');
    }
};
