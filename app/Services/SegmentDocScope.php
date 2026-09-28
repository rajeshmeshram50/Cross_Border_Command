<?php

namespace App\Services;

use App\Models\ClmSegmentRule;
use App\Support\SegmentGuard;
use Illuminate\Database\Eloquent\Model;

/**
 * Which catalogue documents actually apply to one entity: its segments, narrowed
 * to the Domestic or International rule its address implies, then that rule's
 * doc_selections.
 *
 * The Evidence Vault and the PO submit gate both need this answer, and the gate
 * used to skip it — blocking a PO on expired paperwork no segment rule asked for
 * and the Vault therefore never listed, so there was nothing to go and renew.
 */
class SegmentDocScope
{
    /** India primary address → domestic; any other country, or none → international. */
    public function docType(Model $owner, string $type): string
    {
        $addr = $owner->primaryAddress ?? null;
        if (!$addr) return 'international';
        // Vendor addresses hold country_id; customer/consignee hold the name.
        $name = in_array($type, ['supplier', 'vendor'], true)
            ? optional($addr->country)->name
            : $addr->country;

        return trim((string) $name) === 'India' ? 'domestic' : 'international';
    }

    /** The entity's segment ids — a vendor unions its pivot, others their own. */
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

    /**
     * Per-category document codes the entity's rules select. A segment carrying
     * no rule of the matching document type falls back to whatever rule it has,
     * exactly as the Evidence Vault does, so a legacy single-rule segment keeps
     * its documents.
     *
     * @return array<string, array<int, string>>  ['kyc' => ['KYC-001', …], …]
     */
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
