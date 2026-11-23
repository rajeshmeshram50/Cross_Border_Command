<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

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
    }
};
