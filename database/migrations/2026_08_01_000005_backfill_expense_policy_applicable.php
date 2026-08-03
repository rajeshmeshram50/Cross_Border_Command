<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Backfill existing employees so the Expense Details tab keeps showing for
 * records created before the Expense Policy field existed. Any employee whose
 * expense_policy is NULL or blank is treated as "Applicable" (the previous
 * implicit behaviour where every employee had the expense surface).
 * Rows already set to "Not Applicable" are left untouched.
 */
return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasColumn('employees', 'expense_policy')) {
            return;
        }

        DB::table('employees')
            ->where(function ($q) {
                $q->whereNull('expense_policy')
                  ->orWhere('expense_policy', '');
            })
            ->update(['expense_policy' => 'Applicable']);
    }

    public function down(): void
    {
        // Non-destructive backfill — nothing to reverse.
    }
};
