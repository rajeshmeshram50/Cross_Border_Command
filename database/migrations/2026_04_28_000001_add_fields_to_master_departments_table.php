<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('master_departments', function (Blueprint $table) {
            if (!Schema::hasColumn('master_departments', 'code')) {
                $table->string('code', 50)->nullable()->after('name');
            }
            if (!Schema::hasColumn('master_departments', 'parent_id')) {
                $table->unsignedBigInteger('parent_id')->nullable()->index()->after('code');
            }
            if (!Schema::hasColumn('master_departments', 'head')) {
                $table->string('head', 255)->nullable()->after('parent_id');
            }
            if (!Schema::hasColumn('master_departments', 'email')) {
                $table->string('email', 255)->nullable()->after('head');
            }
        });
    }

    public function down(): void
    {
        Schema::table('master_departments', function (Blueprint $table) {
            foreach (['code', 'parent_id', 'head', 'email'] as $col) {
                if (Schema::hasColumn('master_departments', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
