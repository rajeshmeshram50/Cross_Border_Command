<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('master_hsn_codes', function (Blueprint $table) {
            if (!Schema::hasColumn('master_hsn_codes', 'gst_rate_id')) {
                $table->unsignedBigInteger('gst_rate_id')->nullable()->index()->after('description');
            }
        });

        if (Schema::hasColumn('master_hsn_codes', 'gst_rate')) {
            $hsnRows = DB::table('master_hsn_codes')
                ->select('id', 'client_id', 'branch_id', 'gst_rate')
                ->whereNotNull('gst_rate')
                ->get();

            foreach ($hsnRows as $row) {
                $num = (int) trim((string) $row->gst_rate, '% ');
                if ($num <= 0 && trim((string) $row->gst_rate, '% ') !== '0') {
                    continue;
                }
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
