<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

/**
 * HSN/SAC Code master used to store `gst_rate` as a literal enum string
 * ('0%','5%','12%','18%','28%'). Switching the field to a reference to the
 * gst_percentage master lets users add/edit slabs without code changes and
 * keeps a single source of truth for tax rates.
 *
 * Steps:
 *  1. Add `gst_rate_id` (unsignedBigInteger, nullable, indexed) after `description`.
 *  2. Best-effort backfill — for each existing HSN row that has a numeric
 *     match in master_gst_percentage (matched per-tenant when both rows
 *     have the same client_id/branch_id, falling back to a global match),
 *     copy that gst_percentage.id into gst_rate_id.
 *  3. Drop the legacy `gst_rate` enum column.
 *
 * down() restores the enum and best-effort copies labels back from the
 * referenced gst_percentage row.
 */
return new class extends Migration
{
    public function up(): void
    {
        // 1. New FK column. Nullable so existing rows survive the rename
        //    even if no matching gst_percentage row exists for backfill.
        Schema::table('master_hsn_codes', function (Blueprint $table) {
            if (!Schema::hasColumn('master_hsn_codes', 'gst_rate_id')) {
                $table->unsignedBigInteger('gst_rate_id')->nullable()->index()->after('description');
            }
        });

        // 2. Backfill — only if the legacy column still exists (the table
        //    may have been freshly created without it).
        if (Schema::hasColumn('master_hsn_codes', 'gst_rate')) {
            $hsnRows = DB::table('master_hsn_codes')
                ->select('id', 'client_id', 'branch_id', 'gst_rate')
                ->whereNotNull('gst_rate')
                ->get();

            foreach ($hsnRows as $row) {
                // 'gst_rate' looked like '5%' / '18%' — strip the % and cast.
                $num = (int) trim((string) $row->gst_rate, '% ');
                if ($num <= 0 && trim((string) $row->gst_rate, '% ') !== '0') {
                    continue;
                }
                // Tenant-scoped match first, then global fallback.
                $match = DB::table('master_gst_percentage')
                    ->where('percentage', $num)
                    ->where(function ($q) use ($row) {
                        $q->where(function ($q2) use ($row) {
                            $q2->where('client_id', $row->client_id)
                               ->where('branch_id', $row->branch_id);
                        })->orWhereNull('client_id');
                    })
                    ->orderByRaw('client_id IS NULL, branch_id IS NULL')
                    ->first();
                if ($match) {
                    DB::table('master_hsn_codes')
                        ->where('id', $row->id)
                        ->update(['gst_rate_id' => $match->id]);
                }
            }
        }

        // 3. Drop the legacy enum column.
        Schema::table('master_hsn_codes', function (Blueprint $table) {
            if (Schema::hasColumn('master_hsn_codes', 'gst_rate')) {
                $table->dropColumn('gst_rate');
            }
        });
    }

    public function down(): void
    {
        Schema::table('master_hsn_codes', function (Blueprint $table) {
            if (!Schema::hasColumn('master_hsn_codes', 'gst_rate')) {
                $table->enum('gst_rate', ['0%', '5%', '12%', '18%', '28%'])->nullable()->after('description');
            }
        });

        if (Schema::hasColumn('master_hsn_codes', 'gst_rate_id')) {
            $rows = DB::table('master_hsn_codes')
                ->select('id', 'gst_rate_id')
                ->whereNotNull('gst_rate_id')
                ->get();
            foreach ($rows as $row) {
                $gp = DB::table('master_gst_percentage')->where('id', $row->gst_rate_id)->first();
                if ($gp && in_array($gp->percentage, [0, 5, 12, 18, 28], true)) {
                    DB::table('master_hsn_codes')
                        ->where('id', $row->id)
                        ->update(['gst_rate' => ((int) $gp->percentage) . '%']);
                }
            }
            Schema::table('master_hsn_codes', function (Blueprint $table) {
                $table->dropColumn('gst_rate_id');
            });
        }
    }
};
