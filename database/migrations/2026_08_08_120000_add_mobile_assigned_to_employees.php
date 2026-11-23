<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('employees', 'mobile_assigned')) {
            return;
        }
        Schema::table('employees', function (Blueprint $table) {
            $table->string('mobile_assigned', 20)->nullable()->after('mobile_device');
        });

        DB::table('employees')
            ->where(function ($q) {
                $q->whereNotNull('mobile_master_asset_id')
                  ->orWhere(function ($q2) {
                      $q2->whereNotNull('mobile_device')->where('mobile_device', '<>', '');
                  });
            })
            ->update(['mobile_assigned' => 'Yes']);
    }

    public function down(): void
    {
        if (Schema::hasColumn('employees', 'mobile_assigned')) {
            Schema::table('employees', fn (Blueprint $t) => $t->dropColumn('mobile_assigned'));
        }
    }
};
