<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Personal profile photo, primarily for super_admin who has no
            // tenant row to attach a photo to. Tenant users still keep their
            // photo on the client/branch row (see clients/branches.profile_photo).
            $table->string('profile_photo', 500)->nullable()->after('avatar');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('profile_photo');
        });
    }
};
