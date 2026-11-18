<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        foreach (['p2p_services' => 'gst_percentage', 'p2p_service_suppliers' => 'gst_percentage'] as $table => $after) {
            Schema::table($table, function (Blueprint $t) use ($table, $after) {
                if (! Schema::hasColumn($table, 'gst_id')) {
                    $t->unsignedBigInteger('gst_id')->nullable()->after($after)->index();
                }
            });
        }

        $rates = DB::table('master_gst_percentage')->whereNull('client_id')->whereRaw('LOWER(status) = ?', ['active'])
            ->orderBy('id')->get(['id', 'percentage']);
        foreach ($rates as $r) {
            DB::table('p2p_services')->whereNull('gst_id')->where('gst_percentage', $r->percentage)->update(['gst_id' => $r->id]);
            DB::table('p2p_service_suppliers')->whereNull('gst_id')->where('origin', 'domestic')
                ->where('gst_percentage', $r->percentage)->update(['gst_id' => $r->id]);
        }
    }

    public function down(): void
    {
        foreach (['p2p_services', 'p2p_service_suppliers'] as $table) {
            Schema::table($table, function (Blueprint $t) use ($table) {
                if (Schema::hasColumn($table, 'gst_id')) {
                    $t->dropColumn('gst_id');
                }
            });
        }
    }
};
