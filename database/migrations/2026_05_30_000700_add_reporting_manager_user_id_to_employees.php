<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->unsignedBigInteger('reporting_manager_user_id')
                ->nullable()
                ->after('reporting_manager_id')
                ->index();
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropIndex(['reporting_manager_user_id']);
            $table->dropColumn('reporting_manager_user_id');
        });
    }
};
