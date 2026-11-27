<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE employee_documents DROP CONSTRAINT IF EXISTS employee_documents_emp_key_unique');
        DB::statement('DROP INDEX IF EXISTS employee_documents_emp_key_unique');
        DB::statement('CREATE UNIQUE INDEX employee_documents_emp_key_unique
            ON employee_documents (employee_id, document_key)
            WHERE deleted_at IS NULL');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS employee_documents_emp_key_unique');
        DB::statement('CREATE UNIQUE INDEX employee_documents_emp_key_unique
            ON employee_documents (employee_id, document_key)');
    }
};
