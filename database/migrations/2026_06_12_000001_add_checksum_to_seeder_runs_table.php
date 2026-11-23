<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('seeder_runs')) {
            return;
        }
        Schema::table('seeder_runs', function (Blueprint $table) {
            if (!Schema::hasColumn('seeder_runs', 'checksum')) {
                $table->string('checksum', 64)->nullable()->after('seeder');
            }
        });
    }

    public function down(): void
    {
        if (Schema::hasTable('seeder_runs') && Schema::hasColumn('seeder_runs', 'checksum')) {
            Schema::table('seeder_runs', function (Blueprint $table) {
                $table->dropColumn('checksum');
            });
        }
    }
};
