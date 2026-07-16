<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Per-branch supplier (vendor) code sequences — mirrors what
 * 2026_07_04_000001 did for customers / consignees.
 *
 * Previously vendor_code was unique per CLIENT (S-001, S-002 … shared across
 * every branch), so Branch 2's first supplier continued the client-wide counter
 * (e.g. S-004) instead of starting its own run. Each branch should own its
 * numbering (Branch 1 → S-001…, Branch 2 → S-001…), so the uniqueness key moves
 * from (client_id, vendor_code) to (client_id, branch_id, vendor_code).
 *
 * COALESCE(branch_id, 0) is used — as on customers — so rows with a NULL branch
 * (client-admin, no branch) share one bucket and stay unique among themselves.
 * A plain NULL column in a unique index treats every NULL as distinct, which
 * would let two NULL-branch suppliers both take S-001.
 *
 * The old key was built with Blueprint's $table->unique(), which on Postgres is
 * an ALTER TABLE … ADD CONSTRAINT — not a bare index. It therefore has to be
 * dropped as a CONSTRAINT; a plain DROP INDEX fails with "cannot drop index …
 * because constraint … requires it".
 *
 * Unlike the customers index this one is deliberately NOT partial. Customers
 * exclude soft-deleted rows (WHERE deleted_at IS NULL), but nextVendorCode()
 * scans withTrashed() so a soft-deleted supplier keeps its code reserved
 * forever. Leaving the index non-partial enforces that same reservation at the
 * DB level and preserves the vendors table's existing semantics exactly.
 *
 * The new key is strictly more permissive than the old one, so no existing row
 * can violate it.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_client_id_vendor_code_unique');
        // Belt-and-braces for any environment where it landed as a bare index.
        DB::statement('DROP INDEX IF EXISTS vendors_client_id_vendor_code_unique');

        DB::statement(
            'CREATE UNIQUE INDEX vendors_client_branch_vendor_code_unique '
            . 'ON vendors (client_id, COALESCE(branch_id, 0), vendor_code)'
        );
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS vendors_client_branch_vendor_code_unique');
        DB::statement(
            'CREATE UNIQUE INDEX vendors_client_id_vendor_code_unique '
            . 'ON vendors (client_id, vendor_code)'
        );
    }
};
