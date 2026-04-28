<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('master_designations', function (Blueprint $table) {
            if (!Schema::hasColumn('master_designations', 'code')) {
                $table->string('code', 32)->nullable()->after('name');
            }
            if (!Schema::hasColumn('master_designations', 'department_id')) {
                $table->unsignedBigInteger('department_id')->nullable()->after('code')->index();
            }
            if (!Schema::hasColumn('master_designations', 'level')) {
                $table->string('level', 64)->nullable()->after('department_id');
            }
            if (!Schema::hasColumn('master_designations', 'reports_to_id')) {
                $table->unsignedBigInteger('reports_to_id')->nullable()->after('level')->index();
            }
        });
    }

    public function down(): void
    {
        Schema::table('master_designations', function (Blueprint $table) {
            $table->dropColumn(['code', 'department_id', 'level', 'reports_to_id']);
        });
    }
};
