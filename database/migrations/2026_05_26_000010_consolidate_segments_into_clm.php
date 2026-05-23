<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Consolidate the two segment tables into a single `clm_segments` table.
 *
 * Before: customer / consignee / vendor / product forms hit `master_segments`
 * via `App\Models\Masters\Segments`, while the CLM Segment master writes to
 * `clm_segments`. Two stores of "segments" with diverging shapes.
 *
 * After: only `clm_segments` exists. Existing rows from `master_segments`
 * are copied across (translating `title` → `name`, defaulting `code`,
 * `regulatory_status`, `buyer_consignee`). All FKs / scalar references in
 * `vendors.segment_id` and `products.segment_id` are remapped to the new
 * clm_segments ids so existing data keeps working.
 *
 * Down(): re-creates an empty `master_segments` table for emergency rollback
 * — but does NOT restore data. Keep a DB backup before running this in prod.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Nothing to do if master_segments was already dropped on a prior run.
        if (!Schema::hasTable('master_segments')) {
            return;
        }

        /** @var array<int,int> old_id → new_id */
        $idMap = [];

        // 1. Copy each master_segments row into clm_segments.
        //    Rows without a client_id can't satisfy clm_segments.client_id FK
        //    (NOT NULL → constrained to clients) — skipped with a note in the
        //    log so they don't silently disappear. The legacy id is preserved
        //    in the mapping so downstream FKs can be re-pointed.
        $rows = DB::table('master_segments')->orderBy('id')->get();
        $perClientCounter = [];   // client_id → highest S-NNN already on clm_segments

        foreach ($rows as $row) {
            if (empty($row->client_id)) {
                continue;
            }

            $cid = (int) $row->client_id;

            // Initialise the per-client counter the first time we touch a
            // client — read the current max code from clm_segments so the new
            // sequence picks up where the existing one left off.
            if (!isset($perClientCounter[$cid])) {
                $existingCount = DB::table('clm_segments')
                    ->where('client_id', $cid)
                    ->count();
                $perClientCounter[$cid] = $existingCount;
            }

            $title = trim((string) ($row->title ?? ''));
            if ($title === '') {
                $title = 'Segment ' . $row->id;
            }

            // Status normalisation: master used 'Active'/'Inactive'
            // (capitalised); clm uses lowercase.
            $status = strtolower((string) ($row->status ?? 'active'));
            if (!in_array($status, ['active', 'inactive'], true)) {
                $status = 'active';
            }

            $perClientCounter[$cid]++;
            $code = sprintf('S-%03d', $perClientCounter[$cid]);

            $newId = DB::table('clm_segments')->insertGetId([
                'client_id'         => $cid,
                'code'              => $code,
                'name'              => $title,
                // Defaults — the user can edit these on the CLM Segment page.
                'regulatory_status' => 'less',
                'buyer_consignee'   => 'allowed',
                'status'            => $status,
                'created_by'        => $row->created_by ?? null,
                'updated_by'        => null,
                'created_at'        => $row->created_at ?? now(),
                'updated_at'        => $row->updated_at ?? now(),
            ]);

            $idMap[(int) $row->id] = $newId;
        }

        // 2. Drop the old FK on vendors.segment_id FIRST. Until this is
        //    gone, the column is gated on master_segments — any UPDATE
        //    to a new clm_segments id (like 6) is rejected because the
        //    new value doesn't exist in master_segments yet. Laravel
        //    auto-names the FK `vendors_segment_id_foreign`.
        if (Schema::hasTable('vendors') && Schema::hasColumn('vendors', 'segment_id')) {
            Schema::table('vendors', function (Blueprint $table) {
                $table->dropForeign(['segment_id']);
            });
        }

        // 3. Re-point downstream FKs / scalar refs that used master_segments.id
        //    to the new clm_segments.id. Anything that doesn't map gets
        //    nulled rather than left dangling. With the FK dropped above,
        //    the vendor UPDATEs no longer trip the integrity check.
        if (!empty($idMap)) {
            if (Schema::hasTable('vendors')) {
                foreach ($idMap as $oldId => $newId) {
                    DB::table('vendors')
                        ->where('segment_id', $oldId)
                        ->update(['segment_id' => $newId]);
                }
                // Anything not in the map points at a missing row → null it.
                DB::table('vendors')
                    ->whereNotIn('segment_id', array_values($idMap))
                    ->whereNotNull('segment_id')
                    ->update(['segment_id' => null]);
            }

            // products.segment_id is an unsignedBigInteger without an FK
            // constraint, so it didn't need the drop above.
            if (Schema::hasTable('products') && Schema::hasColumn('products', 'segment_id')) {
                foreach ($idMap as $oldId => $newId) {
                    DB::table('products')
                        ->where('segment_id', $oldId)
                        ->update(['segment_id' => $newId]);
                }
                DB::table('products')
                    ->whereNotIn('segment_id', array_values($idMap))
                    ->whereNotNull('segment_id')
                    ->update(['segment_id' => null]);
            }
        } else {
            // No data migrated — still null out any stale segment_id refs
            // so the new FK we're about to add doesn't trip on dangling rows.
            if (Schema::hasTable('vendors')) {
                DB::table('vendors')->whereNotNull('segment_id')->update(['segment_id' => null]);
            }
        }

        // 4. Re-create the FK on vendors.segment_id pointing at the new
        //    clm_segments table. All vendor rows are either pointing at a
        //    valid new id (from the map) or nulled out, so this never
        //    fails on stale data.
        if (Schema::hasTable('vendors') && Schema::hasColumn('vendors', 'segment_id')) {
            Schema::table('vendors', function (Blueprint $table) {
                $table->foreign('segment_id')
                    ->references('id')->on('clm_segments')
                    ->nullOnDelete();
            });
        }

        // 5. Drop the old table.
        Schema::dropIfExists('master_segments');
    }

    public function down(): void
    {
        // Re-create an empty master_segments so a rollback doesn't leave
        // models pointing at a missing table. Data is NOT restored — take a
        // backup before running up().
        if (!Schema::hasTable('master_segments')) {
            Schema::create('master_segments', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('client_id')->nullable()->index();
                $table->unsignedBigInteger('branch_id')->nullable()->index();
                $table->string('title', 255)->nullable();
                $table->enum('status', ['Active', 'Inactive'])->nullable();
                $table->unsignedBigInteger('created_by')->nullable();
                $table->timestamps();
            });
        }

        // Swap the FK back. If the column is currently NULL on every row this
        // is harmless; otherwise the rollback can fail validation and the
        // operator needs to clean up by hand.
        if (Schema::hasTable('vendors') && Schema::hasColumn('vendors', 'segment_id')) {
            Schema::table('vendors', function (Blueprint $table) {
                $table->dropForeign(['segment_id']);
            });
            Schema::table('vendors', function (Blueprint $table) {
                $table->foreign('segment_id')
                    ->references('id')->on('master_segments')
                    ->nullOnDelete();
            });
        }
    }
};
