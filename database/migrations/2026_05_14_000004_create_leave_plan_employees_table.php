<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('leave_plan_employees', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('leave_plan_id')->index();
            $table->unsignedBigInteger('employee_id')->unique();
            $table->timestamp('assigned_at')->nullable();
            $table->unsignedBigInteger('assigned_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('leave_plan_employees');
    }
};
