<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->json('ancillary_role_ids')->nullable()->after('ancillary_role_id');
        });

        DB::table('employees')
            ->whereNotNull('ancillary_role_id')
            ->update([
                'ancillary_role_ids' => DB::raw("CAST(CONCAT('[', ancillary_role_id, ']') AS JSON)"),
            ]);
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn('ancillary_role_ids');
        });
    }
};
