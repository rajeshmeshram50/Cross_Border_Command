<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('clm_segments') || Schema::hasColumn('clm_segments', 'branch_id')) {
            return;
        }
        Schema::table('clm_segments', function (Blueprint $table) {
            $table->unsignedBigInteger('branch_id')->nullable()->after('client_id')->index();
        });
    }

    public function down(): void
    {
        if (Schema::hasTable('clm_segments') && Schema::hasColumn('clm_segments', 'branch_id')) {
            Schema::table('clm_segments', function (Blueprint $table) {
                $table->dropIndex(['branch_id']);
                $table->dropColumn('branch_id');
            });
        }
    }
};
