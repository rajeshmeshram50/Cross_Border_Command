<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('master_segments')) {
            return;
        }

        $idMap = [];

        $rows = DB::table('master_segments')->orderBy('id')->get();
        $perClientCounter = [];
        $perClientCodes   = [];

        foreach ($rows as $row) {
            if (empty($row->client_id)) {
                continue;
            }

            $cid = (int) $row->client_id;

            if (!isset($perClientCounter[$cid])) {
                $existing = DB::table('clm_segments')
                    ->where('client_id', $cid)
                    ->pluck('code')
                    ->all();
                $perClientCodes[$cid] = array_fill_keys($existing, true);
                $maxN = 0;
                foreach ($existing as $c) {
                    if (preg_match('/^S-(\d+)$/', (string) $c, $m)) {
                        $n = (int) $m[1];
                        if ($n > $maxN) $maxN = $n;
                    }
                }
                $perClientCounter[$cid] = $maxN;
            }

            $title = trim((string) ($row->title ?? ''));
            if ($title === '') {
                $title = 'Segment ' . $row->id;
            }
            $existingByName = DB::table('clm_segments')
                ->where('client_id', $cid)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($title)])
                ->first();
            if ($existingByName) {
                $idMap[(int) $row->id] = (int) $existingByName->id;
                continue;
            }

            $status = strtolower((string) ($row->status ?? 'active'));
            if (!in_array($status, ['active', 'inactive'], true)) {
                $status = 'active';
            }

            do {
                $perClientCounter[$cid]++;
                $code = sprintf('S-%03d', $perClientCounter[$cid]);
            } while (isset($perClientCodes[$cid][$code]));
            $perClientCodes[$cid][$code] = true;

            $newId = DB::table('clm_segments')->insertGetId([
                'client_id'         => $cid,
                'code'              => $code,
                'name'              => $title,
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

        if (Schema::hasTable('vendors') && Schema::hasColumn('vendors', 'segment_id')) {
            Schema::table('vendors', function (Blueprint $table) {
                $table->dropForeign(['segment_id']);
            });
        }

        if (!empty($idMap)) {
            if (Schema::hasTable('vendors')) {
                foreach ($idMap as $oldId => $newId) {
                    DB::table('vendors')
                        ->where('segment_id', $oldId)
                        ->update(['segment_id' => $newId]);
                }
                DB::table('vendors')
                    ->whereNotIn('segment_id', array_values($idMap))
                    ->whereNotNull('segment_id')
                    ->update(['segment_id' => null]);
            }

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
            if (Schema::hasTable('vendors')) {
                DB::table('vendors')->whereNotNull('segment_id')->update(['segment_id' => null]);
            }
        }

        if (Schema::hasTable('vendors') && Schema::hasColumn('vendors', 'segment_id')) {
            Schema::table('vendors', function (Blueprint $table) {
                $table->foreign('segment_id')
                    ->references('id')->on('clm_segments')
                    ->nullOnDelete();
            });
        }

        Schema::dropIfExists('master_segments');
    }

    public function down(): void
    {
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
