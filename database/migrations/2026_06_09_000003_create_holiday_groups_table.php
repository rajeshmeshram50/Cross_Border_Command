<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * HRMS — Holiday Groups (the "type" of holiday list). A group is a named
 * holiday calendar (e.g. "Indian Employees", "US Employees", "Maharashtra
 * Regional") that owns a set of holidays. Employees are assigned a group and
 * inherit its holidays; payroll credits those holidays as paid days.
 *
 * Same tenant + scoping conventions as holidays / announcements.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('holiday_groups', function (Blueprint $table) {
            $table->id();

            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();

            // HGRP-#### per tenant.
            $table->string('code', 20)->nullable()->index();

            $table->string('name', 191);
            $table->text('description')->nullable();
            $table->string('status', 20)->default('Active'); // Active | Inactive

            $table->timestamps();
            $table->softDeletes();

            $table->index(['client_id', 'branch_id'], 'holiday_groups_tenant_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('holiday_groups');
    }
};
