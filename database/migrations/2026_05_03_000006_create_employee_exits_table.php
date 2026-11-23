<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('employee_exits', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('employee_id')->unique();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            $table->string('exit_type', 40)->nullable();
            $table->string('initiated_by', 40)->nullable();
            $table->string('reason_for_exit', 60)->nullable();
            $table->string('other_reason', 255)->nullable();
            $table->date('notice_date')->nullable();
            $table->date('last_working_day')->nullable();
            $table->unsignedBigInteger('reporting_manager_id')->nullable();
            $table->text('comments')->nullable();

            $table->string('business_impact', 20)->nullable();
            $table->string('replacement_required', 60)->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('employee_exits');
    }
};
