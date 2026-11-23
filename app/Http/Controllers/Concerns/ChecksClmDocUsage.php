<?php

namespace App\Http\Controllers\Concerns;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

trait ChecksClmDocUsage
{
    protected static function clmBranchKey($branchId): string
    {
        return $branchId === null ? 'shared' : (string) (int) $branchId;
    }

    protected static function clmUsageHas(array $byBranch, $branchId, string $key): bool
    {
        if ($branchId === null) {
            foreach ($byBranch as $set) {
                if (isset($set[$key])) return true;
            }
            return false;
        }
        return isset($byBranch[self::clmBranchKey($branchId)][$key])
            || isset($byBranch['shared'][$key]);
    }

    protected static function clmUploadOwnerTables(): array
    {
        return [
            \App\Models\Customer::class  => 'customers',
            \App\Models\Consignee::class => 'consignees',
            \App\Models\Vendor::class    => 'vendors',
            \App\Models\Product::class   => 'products',
        ];
    }

    protected function clmDocUsageSets(?int $clientId): array
    {
        $build = fn (): array => $this->buildClmDocUsageSets($clientId);

        try {
            return \Illuminate\Support\Facades\Cache::remember(
                'clm:docusage:v1:' . ($clientId ?? 0),
                now()->addSeconds(60),
                $build
            );
        } catch (\Throwable $e) {
            return $build();
        }
    }

    protected function buildClmDocUsageSets(?int $clientId): array
    {
        $rules = $uploads = [];

        if (Schema::hasTable('clm_segment_rules') && Schema::hasColumn('clm_segment_rules', 'doc_selections')) {
            $q = DB::table('clm_segment_rules');
            if ($clientId) $q->where('client_id', $clientId);

            $segNames = [];
            if (Schema::hasTable('clm_segments')) {
                $sq = DB::table('clm_segments');
                if ($clientId) $sq->where('client_id', $clientId);
                foreach ($sq->get(['id', 'name']) as $s) $segNames[(int) $s->id] = (string) $s->name;
            }

            foreach ($q->get(['branch_id', 'doc_selections', 'segment_id']) as $r) {
                $arr = is_array($r->doc_selections) ? $r->doc_selections : (json_decode((string) $r->doc_selections, true) ?: []);
                $bk  = self::clmBranchKey($r->branch_id);
                $where = $segNames[(int) ($r->segment_id ?? 0)] ?? null;
                foreach ($arr as $bucket) {
                    if (is_array($bucket)) {
                        foreach (array_keys($bucket) as $code) {
                            $code = (string) $code;
                            if (!isset($rules[$bk][$code])) $rules[$bk][$code] = [];
                            if ($where !== null && $where !== '') $rules[$bk][$code][$where] = true;
                        }
                    }
                }
            }
        }

        if (Schema::hasTable('segment_doc_uploads') && Schema::hasColumn('segment_doc_uploads', 'doc_code')) {
            $owners = self::clmUploadOwnerTables();
            foreach ($owners as $class => $table) {
                $q = DB::table('segment_doc_uploads as u')
                    ->leftJoin("{$table} as o", 'o.id', '=', 'u.uploadable_id')
                    ->where('u.uploadable_type', $class)
                    ->whereNotNull('u.doc_code')
                    ->distinct();
                if ($clientId) $q->where('u.client_id', $clientId);
                foreach ($q->get(['o.branch_id', 'u.doc_code']) as $r) {
                    $uploads[self::clmBranchKey($r->branch_id)][(string) $r->doc_code] = true;
                }
            }
            $q = DB::table('segment_doc_uploads')
                ->whereNotIn('uploadable_type', array_keys($owners))
                ->whereNotNull('doc_code')
                ->distinct();
            if ($clientId) $q->where('client_id', $clientId);
            foreach ($q->pluck('doc_code') as $c) $uploads['shared'][(string) $c] = true;
        }

        return ['rules' => $rules, 'uploads' => $uploads];
    }

    protected function clmDocUsageLabels(array $sets, ?string $code, $branchId): array
    {
        if (!$code) return [];
        $labels = [];
        if (self::clmUsageHas($sets['rules'], $branchId, $code)) {
            $where = self::clmUsageWhere($sets['rules'], $branchId, $code);
            $labels[] = $where ? 'Segment Rules for ' . implode(', ', $where) : 'Segment Rules';
        }
        if (self::clmUsageHas($sets['uploads'], $branchId, $code)) $labels[] = 'Segment Doc Uploads';
        return $labels;
    }

    protected static function clmUsageWhere(array $byBranch, $branchId, string $code): array
    {
        $buckets = $branchId === null
            ? array_values($byBranch)
            : [$byBranch[self::clmBranchKey($branchId)] ?? [], $byBranch['shared'] ?? []];

        $names = [];
        foreach ($buckets as $set) {
            foreach (array_keys(is_array($set[$code] ?? null) ? $set[$code] : []) as $n) {
                $n = (string) $n;
                $names[mb_strlen($n) > 30 ? mb_substr($n, 0, 30) . '…' : $n] = true;
            }
        }

        $names = array_keys($names);
        if (count($names) > 3) {
            $rest  = count($names) - 3;
            $names = array_slice($names, 0, 3);
            $names[] = '+' . $rest . ' more';
        }
        return $names;
    }
}
