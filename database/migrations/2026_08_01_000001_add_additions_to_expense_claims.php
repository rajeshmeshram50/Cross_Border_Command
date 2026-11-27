<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('expense_claims', function (Blueprint $table) {
            $table->json('additions')->nullable()->after('deductions');
            $table->decimal('addition_amount', 18, 2)->default(0)->after('additions');
        });
    }

    public function down(): void
    {
        Schema::table('expense_claims', function (Blueprint $table) {
            $table->dropColumn(['additions', 'addition_amount']);
        });
    }
};
