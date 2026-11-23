<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payroll_periods', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            $table->unsignedTinyInteger('month');
            $table->unsignedSmallInteger('year');
            $table->string('label', 20);
            $table->date('period_start');
            $table->date('period_end');
            $table->unsignedTinyInteger('working_days')->default(26);

            $table->boolean('attendance_finalized')->default(false);
            $table->timestamp('attendance_finalized_at')->nullable();
            $table->unsignedBigInteger('attendance_finalized_by')->nullable();

            $table->enum('status', ['open', 'processing', 'locked'])->default('open');
            $table->timestamp('locked_at')->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['client_id', 'branch_id', 'month', 'year'], 'payroll_periods_unique_cycle');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_periods');
    }
};
