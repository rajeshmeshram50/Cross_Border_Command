<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('announcements');

        Schema::create('announcements', function (Blueprint $table) {
            $table->id();

            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();

            $table->string('code', 20)->nullable()->index();

            $table->string('title', 191)->nullable();
            $table->text('description')->nullable();
            $table->string('type', 30)->nullable()->default('General');
            $table->string('priority', 20)->nullable()->default('Normal');

            $table->string('attachment_path', 255)->nullable();
            $table->string('attachment_original_name', 191)->nullable();

            $table->string('audience_type', 30)->nullable()->default('all_employees');
            $table->json('audience_role_ids')->nullable();
            $table->json('audience_designation_ids')->nullable();
            $table->json('exclude_employee_ids')->nullable();
            $table->unsignedInteger('audience_count')->nullable()->default(0);

            $table->string('publish_type', 20)->nullable()->default('immediate');
            $table->dateTime('publish_at')->nullable();
            $table->dateTime('expires_at')->nullable();

            $table->boolean('ack_required')->nullable()->default(false);
            $table->string('ack_mode', 20)->nullable()->default('Mandatory');
            $table->string('ack_reminder_frequency', 20)->nullable()->default('Weekly');
            $table->unsignedInteger('ack_escalation_days')->nullable()->default(3);

            $table->boolean('notify_email')->nullable()->default(true);
            $table->boolean('notify_in_app')->nullable()->default(true);
            $table->boolean('notify_sms')->nullable()->default(false);
            $table->boolean('notify_whatsapp')->nullable()->default(false);

            $table->string('status', 20)->nullable()->default('Draft');

            $table->timestamps();
            $table->softDeletes();

            $table->index(['client_id', 'branch_id', 'status'], 'announcements_tenant_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('announcements');
    }
};
