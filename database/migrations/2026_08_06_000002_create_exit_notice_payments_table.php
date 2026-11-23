<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('exit_notice_payments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('employee_id')->index();
            $table->unsignedBigInteger('employee_exit_id')->nullable()->index();

            $table->decimal('amount_due', 12, 2)->default(0);
            $table->decimal('amount', 12, 2);
            $table->string('payment_mode', 40)->nullable();
            $table->string('bank_name', 120)->nullable();
            $table->string('utr_cheque_number', 40)->nullable();
            $table->date('payment_date')->nullable();

            $table->string('attachment_path', 1024)->nullable();
            $table->string('attachment_name', 255)->nullable();
            $table->string('employee_note', 500)->nullable();

            $table->string('status', 20)->default('Pending')->index();
            $table->unsignedBigInteger('verified_by')->nullable();
            $table->timestamp('verified_at')->nullable();
            $table->string('verification_remarks', 500)->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('exit_notice_payments');
    }
};
