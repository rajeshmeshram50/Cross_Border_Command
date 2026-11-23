<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE employees ALTER COLUMN enable_payroll SET DEFAULT true');

        DB::table('employees')->whereNull('enable_payroll')->update(['enable_payroll' => true]);
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE employees ALTER COLUMN enable_payroll DROP DEFAULT');
    }
};
