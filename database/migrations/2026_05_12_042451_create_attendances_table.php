<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('attendances', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();

            $table->date('attendance_date')->index();

            $table->timestamp('check_in_at')->nullable();
            $table->timestamp('check_out_at')->nullable();

            $table->enum('check_in_method',  ['face', 'manual', 'auto'])->default('face')->nullable();
            $table->enum('check_out_method', ['face', 'manual', 'auto'])->default('face')->nullable();

            $table->decimal('check_in_match_distance', 5, 4)->nullable();
            $table->decimal('check_out_match_distance', 5, 4)->nullable();

            $table->string('check_in_ip', 64)->nullable();
            $table->string('check_out_ip', 64)->nullable();
            $table->decimal('check_in_lat',  10, 7)->nullable();
            $table->decimal('check_in_lng',  10, 7)->nullable();
            $table->decimal('check_out_lat', 10, 7)->nullable();
            $table->decimal('check_out_lng', 10, 7)->nullable();

            $table->enum('status', [
                'Present', 'Late', 'Half Day', 'Missing In', 'Missing Out',
                'Weekly Off', 'Holiday', 'On Duty', 'Work From Home',
                'Absent', 'Leave', 'Corrected',
            ])->default('Present');

            $table->text('notes')->nullable();

            $table->timestamps();
            $table->softDeletes();

            $table->unique(['employee_id', 'attendance_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('attendances');
    }
};
