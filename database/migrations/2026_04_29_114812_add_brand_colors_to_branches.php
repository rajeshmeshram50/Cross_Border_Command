<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            // Hex strings like #4F46E5. Nullable so a branch can opt to inherit
            // from its client (handled at the API layer via fallback in formatUser
            // and on the frontend by branch → client → app default chain).
            $table->string('primary_color', 7)->nullable()->after('logo');
            $table->string('secondary_color', 7)->nullable()->after('primary_color');
        });
    }

    public function down(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            $table->dropColumn(['primary_color', 'secondary_color']);
        });
    }
};
