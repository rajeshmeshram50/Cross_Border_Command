<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('candidates', function (Blueprint $table) {
            $table->id();

            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('created_by')->nullable();

            $table->unsignedBigInteger('recruitment_id')->index();

            $table->string('name', 150);
            $table->string('email', 191)->nullable()->index();
            $table->string('mobile', 30)->nullable();
            $table->string('current_address', 500)->nullable();
            $table->string('qualification', 191)->nullable();
            $table->decimal('experience_years', 5, 2)->default(0);
            $table->string('mode_of_transport', 30)->nullable();
            $table->decimal('distance_km', 7, 2)->nullable();

            $table->decimal('current_salary_lpa', 10, 2)->nullable();
            $table->decimal('expected_salary_lpa', 10, 2)->nullable();
            $table->string('notice_period', 30)->nullable();

            $table->string('source', 50)->nullable();

            $table->string('cv_path', 255)->nullable();
            $table->string('cv_original_name', 191)->nullable();

            $table->string('status', 30)->default('Applied');
            $table->string('rejection_reason', 100)->nullable();
            $table->text('status_notes')->nullable();

            $table->timestamps();
            $table->softDeletes();

            $table->index(['recruitment_id', 'status'], 'candidates_rec_status_idx');
            $table->index(['client_id', 'branch_id', 'status'], 'candidates_tenant_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('candidates');
    }
};
