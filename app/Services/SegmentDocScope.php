<?php

namespace App\Services;

use App\Models\ClmSegmentRule;
use App\Support\SegmentGuard;
use Illuminate\Database\Eloquent\Model;

class SegmentDocScope
{
    public function docType(Model $owner, string $type): string
    {
        $addr = $owner->primaryAddress ?? null;
        if (!$addr) return 'international';
        $name = in_array($type, ['supplier', 'vendor'], true)
            ? optional($addr->country)->name
            : $addr->country;

        return trim((string) $name) === 'India' ? 'domestic' : 'international';
    }

    public function segmentIds(Model $owner, string $type): array
    {
        if (in_array($type, ['supplier', 'vendor'], true)) {
            $ids = $owner->segments()->pluck('clm_segments.id')->map(fn ($x) => (int) $x)->unique()->values()->all();
            if (!empty($ids)) return $ids;

            return $owner->segment_id ? [(int) $owner->segment_id] : [];
        }
        if ($type === 'product') {
            return $owner->segment_id ? [(int) $owner->segment_id] : [];
        }

        return SegmentGuard::idsOf($owner);
    }

    public function applicableCodes(Model $owner, string $type, int $cid): array
    {
        $segmentIds = $this->segmentIds($owner, $type);
        if (empty($segmentIds)) return [];

        $docType = $this->docType($owner, $type);
        $rules = ClmSegmentRule::query()
            ->where('client_id', $cid)
            ->whereIn('segment_id', $segmentIds)
            ->get()
            ->groupBy('segment_id')
            ->map(fn ($g) => $g->firstWhere('document_type', $docType) ?? $g->first())
            ->filter();

        $out = [];
        foreach ($rules as $rule) {
            foreach (($rule->doc_selections ?? []) as $cat => $entries) {
                if (!is_array($entries)) continue;
                foreach (array_keys($entries) as $code) {
                    $out[(string) $cat][(string) $code] = true;
                }
            }
        }

        return array_map(fn ($set) => array_keys($set), $out);
    }
}
