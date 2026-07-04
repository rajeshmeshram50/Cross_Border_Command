<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Branch-isolate the Document Control Panel (segment rules). Adds branch_id so
 * the MasterVisibility read scope applies: a branch sees globals + client-level
 * rules + its own branch's rules; sibling branches stay hidden. Mirrors the
 * agreement-master branch isolation. Backfill stamps each row with its creator's
 * branch; client-level creators (branch_id NULL) stay shared.
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('clm_segment_rules', 'branch_id')) {
            Schema::table('clm_segment_rules', function (Blueprint $t) {
                $t->foreignId('branch_id')->nullable()->after('client_id')
                    ->constrained('branches')->nullOnDelete();
            });
        }

        DB::statement("
            UPDATE clm_segment_rules AS t
            SET branch_id = u.branch_id
            FROM users AS u
            WHERE t.created_by = u.id
              AND u.branch_id IS NOT NULL
              AND t.branch_id IS NULL
        ");
    }

    public function down(): void
    {
        if (Schema::hasColumn('clm_segment_rules', 'branch_id')) {
            Schema::table('clm_segment_rules', function (Blueprint $t) {
                $t->dropConstrainedForeignId('branch_id');
            });
        }
    }
};
