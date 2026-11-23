<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('salary_structures', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('employee_id')->index();

            $table->unsignedInteger('version')->default(1);
            $table->date('effective_from');

            $table->enum('status', ['draft', 'active', 'superseded'])->default('active');

            $table->json('earnings')->nullable();
            $table->json('deductions')->nullable();

            $table->decimal('monthly_gross', 14, 2)->default(0);
            $table->decimal('monthly_ctc', 14, 2)->default(0);

            $table->boolean('pf_applicable')->default(false);
            $table->boolean('esi_applicable')->default(false);
            $table->boolean('pt_applicable')->default(true);

            $table->enum('approval_status', ['draft', 'approved'])->default('approved');
            $table->unsignedBigInteger('approved_by')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->text('revision_note')->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['client_id', 'employee_id', 'status'], 'salary_structures_emp_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('salary_structures');
    }
};
