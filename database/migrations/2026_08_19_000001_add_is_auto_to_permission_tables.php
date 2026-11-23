<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('permissions', function (Blueprint $table) {
            $table->boolean('is_auto')->default(false)->after('can_approve');
        });

        Schema::table('department_permissions', function (Blueprint $table) {
            $table->boolean('is_auto')->default(false)->after('can_approve');
        });
    }

    public function down(): void
    {
        Schema::table('permissions', function (Blueprint $table) {
            $table->dropColumn('is_auto');
        });

        Schema::table('department_permissions', function (Blueprint $table) {
            $table->dropColumn('is_auto');
        });
    }
};
