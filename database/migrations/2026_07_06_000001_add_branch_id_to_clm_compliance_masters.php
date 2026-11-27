<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private array $tables = [
        'clm_authorities',
        'clm_kyc_documents',
        'clm_dd_documents',
        'clm_qc_documents',
        'clm_trade_licenses',
    ];

    public function up(): void
    {
        foreach ($this->tables as $t) {
            if (!Schema::hasTable($t) || Schema::hasColumn($t, 'branch_id')) {
                continue;
            }
            Schema::table($t, function (Blueprint $table) {
                $table->unsignedBigInteger('branch_id')->nullable()->after('client_id')->index();
            });
        }

        $backfill = array_merge($this->tables, ['clm_segments']);
        $branchUsers = DB::table('users')->whereNotNull('branch_id')->pluck('branch_id', 'id');
        foreach ($backfill as $t) {
            if (!Schema::hasTable($t)
                || !Schema::hasColumn($t, 'branch_id')
                || !Schema::hasColumn($t, 'created_by')) {
                continue;
            }
            foreach ($branchUsers as $userId => $branchId) {
                DB::table($t)
                    ->whereNull('branch_id')
                    ->where('created_by', $userId)
                    ->update(['branch_id' => $branchId]);
            }
        }
    }

    public function down(): void
    {
        foreach ($this->tables as $t) {
            if (Schema::hasTable($t) && Schema::hasColumn($t, 'branch_id')) {
                Schema::table($t, function (Blueprint $table) {
                    $table->dropIndex(['branch_id']);
                    $table->dropColumn('branch_id');
                });
            }
        }
    }
};
