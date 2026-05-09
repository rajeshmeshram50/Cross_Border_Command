<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('clients', function (Blueprint $table) {
            $table->string('profile_photo', 500)->nullable()->after('favicon');
        });

        Schema::table('branches', function (Blueprint $table) {
            $table->string('profile_photo', 500)->nullable()->after('logo');
        });
    }

    public function down(): void
    {
        Schema::table('clients', function (Blueprint $table) {
            $table->dropColumn('profile_photo');
        });

        Schema::table('branches', function (Blueprint $table) {
            $table->dropColumn('profile_photo');
        });
    }
};
