<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('DROP INDEX IF EXISTS employees_client_emp_code_unique');
        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS employees_client_branch_emp_code_unique
            ON employees (client_id, branch_id, emp_code)
            WHERE emp_code IS NOT NULL AND emp_code <> ''");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS employees_client_branch_emp_code_unique');
        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS employees_client_emp_code_unique
            ON employees (client_id, emp_code)
            WHERE emp_code IS NOT NULL AND emp_code <> ''");
    }
};
