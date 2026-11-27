<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fnf_settlements', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('employee_id')->index();
            $table->unsignedBigInteger('employee_exit_id')->nullable()->index();

            $table->string('employee_code', 50)->nullable();
            $table->string('employee_name', 255)->nullable();
            $table->date('last_working_day')->nullable();
            $table->string('exit_type', 100)->nullable();

            $table->json('inputs')->nullable();
            $table->json('breakdown')->nullable();

            $table->decimal('total_earnings', 14, 2)->default(0);
            $table->decimal('total_deductions', 14, 2)->default(0);
            $table->decimal('net_settlement', 14, 2)->default(0);

            $table->string('status', 20)->default('draft')->index();
            $table->text('notes')->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('approved_by')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->unsignedBigInteger('paid_by')->nullable();
            $table->timestamp('paid_at')->nullable();

            $table->timestamps();
            $table->softDeletes();

            $table->index(['client_id', 'employee_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fnf_settlements');
    }
};
