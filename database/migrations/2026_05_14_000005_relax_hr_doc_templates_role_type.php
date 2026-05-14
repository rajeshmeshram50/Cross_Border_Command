<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The role_type column was originally an enum capped at four short labels
 * (Intern, Employee, Executive, HOD). The wizard now sources its options
 * directly from the Designation master's `level` field, which carries six
 * canonical values with friendly slashes/parens — too varied to keep as
 * a Postgres CHECK constraint. Drop the constraint so the column accepts
 * the new labels (validation happens in the controller).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('hr_document_templates')) return;

        // Postgres: enum() created a VARCHAR + CHECK; drop the CHECK so any
        // string fits. The constraint name follows Laravel's convention.
        DB::statement('ALTER TABLE hr_document_templates DROP CONSTRAINT IF EXISTS hr_document_templates_role_type_check');
    }

    public function down(): void
    {
        if (!Schema::hasTable('hr_document_templates')) return;

        // Restore the old CHECK so a rollback returns to the original enum
        // domain. Existing rows outside this set would block — but the
        // column is empty in environments that ran the create migration
        // straight through this rollback.
        DB::statement("ALTER TABLE hr_document_templates ADD CONSTRAINT hr_document_templates_role_type_check CHECK (role_type IS NULL OR role_type IN ('Intern','Employee','Executive','HOD'))");
    }
};
