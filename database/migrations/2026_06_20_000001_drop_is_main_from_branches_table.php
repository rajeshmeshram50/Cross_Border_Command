<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            try {
                $table->dropIndex('branches_is_main_index');
            } catch (\Throwable $e) {
            }
        });

        if (Schema::hasColumn('branches', 'is_main')) {
            Schema::table('branches', function (Blueprint $table) {
                $table->dropColumn('is_main');
            });
        }
    }

    public function down(): void
    {
        if (!Schema::hasColumn('branches', 'is_main')) {
            Schema::table('branches', function (Blueprint $table) {
                $table->boolean('is_main')->nullable()->default(false)->after('country');
                $table->index('is_main');
            });
        }
    }
};
