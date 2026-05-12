<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_leave_plans', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('plan_name', 255)->nullable();
            $table->string('calendar_year', 20)->nullable();
            // 'Calendar' = pick a fixed month (from_month is set).
            // 'If Joining' = year starts from each employee's joining date.
            $table->enum('from_month_type', ['Calendar', 'If Joining'])->nullable();
            $table->enum('from_month', [
                'January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December',
            ])->nullable();
            $table->enum('status', ['Active', 'Inactive'])->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_leave_plans');
    }
};
