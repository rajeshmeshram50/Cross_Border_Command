<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('master_leave_plans', function (Blueprint $table) {
            $table->boolean('unlocked')->default(false)->after('is_default');
        });
    }

    public function down(): void
    {
        Schema::table('master_leave_plans', function (Blueprint $table) {
            $table->dropColumn('unlocked');
        });
    }
};
