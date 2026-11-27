<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ctc_contracts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            $table->string('code', 16);
            $table->string('title', 255);
            $table->string('agreement_type', 64)->nullable();

            $table->string('org_name', 255)->nullable();
            $table->string('org_short_code', 64)->nullable();
            $table->string('org_state', 128)->nullable();
            $table->string('org_country', 128)->nullable();

            $table->json('counterparties')->nullable();

            $table->date('eff_date')->nullable();
            $table->date('end_date')->nullable();
            $table->boolean('auto_renewal')->default(false);
            $table->string('renewal_type', 16)->nullable();

            $table->longText('content')->nullable();
            $table->json('header_config')->nullable();
            $table->json('footer_config')->nullable();

            $table->json('approvers')->nullable();
            $table->json('approver_emails')->nullable();
            $table->json('clarifications')->nullable();

            $table->unsignedTinyInteger('stage')->default(1);
            $table->string('approval_status', 24)->default('pending');
            $table->string('status', 24)->default('inprogress');
            $table->text('rejection_reason')->nullable();
            $table->unsignedSmallInteger('days_to_approve')->nullable();
            $table->unsignedSmallInteger('reminder_days')->nullable();
            $table->date('cp_signed_date')->nullable();

            $table->string('primary_approver_name', 255)->nullable();
            $table->string('primary_approver_email', 255)->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->string('created_by_name', 255)->nullable();
            $table->timestamp('submitted_at')->nullable();

            $table->timestamps();
            $table->softDeletes();
            $table->index(['client_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ctc_contracts');
    }
};
