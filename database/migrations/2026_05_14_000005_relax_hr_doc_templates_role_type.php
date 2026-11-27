<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('hr_document_templates')) return;

        DB::statement('ALTER TABLE hr_document_templates DROP CONSTRAINT IF EXISTS hr_document_templates_role_type_check');
    }

    public function down(): void
    {
        if (!Schema::hasTable('hr_document_templates')) return;

        DB::statement("ALTER TABLE hr_document_templates ADD CONSTRAINT hr_document_templates_role_type_check CHECK (role_type IS NULL OR role_type IN ('Intern','Employee','Executive','HOD'))");
    }
};
