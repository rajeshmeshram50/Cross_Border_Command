<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The Policies & Agreements document set, chosen per employee.
 *
 * Before this, every onboarding template that matched an employee was counted
 * as required, so the completion % shifted whenever a template was added or
 * deprecated. HR now TICKS the documents a given hire actually needs and
 * FINALISES that set; the lock freezes the denominator the onboarding % is
 * measured against, and a finalised set accepts no new documents until it is
 * re-opened (allowed only while nothing in it has been signed yet).
 *
 *   hr_onboarding_doc_selections  one row per (employee, template) ticked
 *   hr_onboarding_docset_locks    one row per employee: the finalise state
 *
 * No FK constraints by project convention — ids are app-scoped.
 */
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

            $t->unique(['employee_id', 'template_id']);   // a template is ticked once per employee
            $t->index(['client_id', 'employee_id']);
        });

        Schema::create('hr_onboarding_docset_locks', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->nullable();
            $t->unsignedBigInteger('branch_id')->nullable();
            $t->unsignedBigInteger('employee_id')->unique();  // one lock row per employee
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
