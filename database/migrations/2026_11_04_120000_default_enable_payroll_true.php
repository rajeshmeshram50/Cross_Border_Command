<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // New rows default to on, so a record saved without the choice is in payroll.
        DB::statement('ALTER TABLE employees ALTER COLUMN enable_payroll SET DEFAULT true');

        // Legacy rows that never set it (NULL) are marked on — payroll already treats
        // NULL as on, this just makes the stored value match so old data can't break.
        DB::table('employees')->whereNull('enable_payroll')->update(['enable_payroll' => true]);
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE employees ALTER COLUMN enable_payroll DROP DEFAULT');
    }
};
