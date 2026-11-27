<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('hr_onboarding_doc_selections', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->nullable();
            $t->unsignedBigInteger('branch_id')->nullable();
            $t->unsignedBigInteger('employee_id');
            $t->unsignedBigInteger('template_id');
            $t->unsignedBigInteger('created_by')->nullable();
            $t->timestamps();

            $t->unique(['employee_id', 'template_id']);
            $t->index(['client_id', 'employee_id']);
        });

        Schema::create('hr_onboarding_docset_locks', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->nullable();
            $t->unsignedBigInteger('branch_id')->nullable();
            $t->unsignedBigInteger('employee_id')->unique();
            $t->timestamp('finalized_at')->nullable();
            $t->unsignedBigInteger('finalized_by')->nullable();
            $t->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('hr_onboarding_docset_locks');
        Schema::dropIfExists('hr_onboarding_doc_selections');
    }
};
