<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * OB-03 — the (employee_id, document_key) unique index ignored soft-deletes, so
 * a soft-deleted document still occupied the slot and a clean re-upload tripped
 * a 23505 (the controller had to work around it with withTrashed()->restore()).
 *
 * Make it a PARTIAL unique index that only constrains live rows (deleted_at IS
 * NULL), so re-uploading after a soft delete just works.
 */
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
