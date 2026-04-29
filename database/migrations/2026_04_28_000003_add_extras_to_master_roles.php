<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('master_roles', function (Blueprint $table) {
            if (!Schema::hasColumn('master_roles', 'code')) {
                $table->string('code', 32)->nullable()->after('name');
            }
            if (!Schema::hasColumn('master_roles', 'role_type')) {
                $table->string('role_type', 64)->nullable()->after('code');
            }
            if (!Schema::hasColumn('master_roles', 'department_id')) {
                $table->unsignedBigInteger('department_id')->nullable()->after('role_type')->index();
            }
            if (!Schema::hasColumn('master_roles', 'role_category')) {
                $table->string('role_category', 64)->nullable()->after('department_id');
            }
            if (!Schema::hasColumn('master_roles', 'description')) {
                $table->text('description')->nullable()->after('role_category');
            }
        });
    }

    public function down(): void
    {
        Schema::table('master_roles', function (Blueprint $table) {
            $table->dropColumn(['code', 'role_type', 'department_id', 'role_category', 'description']);
        });
    }
};
