<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement('ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_gender_check');
        DB::statement(
            "ALTER TABLE employees ADD CONSTRAINT employees_gender_check "
            . "CHECK (gender IS NULL OR gender IN ('Male', 'Female', 'Other', 'Prefer not to say'))"
        );
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement("UPDATE employees SET gender = 'Other' WHERE gender = 'Prefer not to say'");

        DB::statement('ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_gender_check');
        DB::statement(
            "ALTER TABLE employees ADD CONSTRAINT employees_gender_check "
            . "CHECK (gender IS NULL OR gender IN ('Male', 'Female', 'Other'))"
        );
    }
};
