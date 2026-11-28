<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * CredVault credential codes become a per-branch series (each branch gets its
 * own CRD-0001 onward). The code uniqueness therefore moves from
 * (client_id, code) to (client_id, branch_id, code). COALESCE(branch_id, 0)
 * keeps null-branch credentials grouped so they still can't collide.
 *
 * Safe on existing data: the old (client_id, code) uniqueness implies the new
 * (client_id, branch_id, code) uniqueness, so the new index builds without
 * conflict and no existing code is renumbered.
 */
return new class extends Migration
{
    public function up(): void
    {
        // The old uniqueness is a table CONSTRAINT; drop the constraint, then
        // add a per-branch unique INDEX (an expression index can't be a
        // constraint, so it lives as a unique index).
        DB::statement('ALTER TABLE credvault_credentials DROP CONSTRAINT IF EXISTS credvault_credentials_client_id_code_unique');
        DB::statement('DROP INDEX IF EXISTS credvault_credentials_client_branch_code_unique');
        DB::statement('CREATE UNIQUE INDEX credvault_credentials_client_branch_code_unique ON credvault_credentials (client_id, COALESCE(branch_id, 0), code)');
    }

    public function down(): void
    {
        // Note: rolls back only while no two branches share a code yet.
        DB::statement('DROP INDEX IF EXISTS credvault_credentials_client_branch_code_unique');
        DB::statement('ALTER TABLE credvault_credentials ADD CONSTRAINT credvault_credentials_client_id_code_unique UNIQUE (client_id, code)');
    }
};
