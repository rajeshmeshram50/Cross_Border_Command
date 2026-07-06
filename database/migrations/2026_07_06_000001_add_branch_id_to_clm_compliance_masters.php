<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Branch-isolate the CLM compliance masters (Authority, KYC, DD, QC, Trade
 * License). Each already carries `client_id`; adding a nullable `branch_id`
 * lets a branch own its own rows so sibling branches can't see or manage them
 * (CBC-430/431/432/434/435). A NULL branch_id means "client-level / shared"
 * (created by a client admin) and stays visible to every branch, mirroring the
 * Trade Document / Segment masters. `clm_segments` already has the column.
 */
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

        // Backfill existing rows so pre-existing branch-created data stops
        // leaking. A row's branch is inferred from its creator: if created_by
        // is a BRANCH user, stamp that user's branch_id; rows created by a
        // client admin/user (no branch) stay NULL = client-level / shared.
        // `clm_segments` is included even though its column predates this
        // migration — it was never populated, so its rows are all NULL too.
        // Done per-branch-user in plain query builder so it's portable across
        // Postgres / MySQL.
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
