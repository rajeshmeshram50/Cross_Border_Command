<?php

namespace App\Support;

use App\Models\ClmSegment;
use App\Models\ClmSegmentRule;
use App\Models\SegmentDocUpload;

/**
 * Protects segments that already have uploaded documents.
 *
 * A customer/consignee's `segment` column is a comma-joined list of segment
 * NAMES. Each segment maps (via ClmSegmentRule.doc_selections) to a set of
 * (category, doc_code) required documents. If any of those documents have been
 * uploaded for the entity, that segment must NOT be removed during an edit —
 * otherwise the uploaded evidence would be orphaned.
 */
class SegmentGuard
{
    /** Split a comma-joined segment string into trimmed, non-empty names. */
    public static function names(?string $segment): array
    {
        if (!$segment) return [];
        return array_values(array_filter(
            array_map('trim', explode(',', $segment)),
            fn ($s) => $s !== ''
        ));
    }

    /**
     * Of the given segment names, return those that have at least one uploaded
     * document for the entity — i.e. segments that may NOT be removed.
     *
     * @param  string   $uploadableType  e.g. App\Models\Customer::class
     * @param  string[] $segmentNames
     * @return string[] segment names that have uploads
     */
    public static function segmentsWithUploads(string $uploadableType, int $uploadableId, int $clientId, array $segmentNames): array
    {
        $blocked = [];

        foreach ($segmentNames as $name) {
            $name = trim($name);
            if ($name === '') continue;

            // Resolve the segment id by name (tenant row first, else global).
            $segId = ClmSegment::query()
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
                ->where(fn ($q) => $q->where('client_id', $clientId)->orWhereNull('client_id'))
                ->value('id');
            if (!$segId) continue;

            // The segment's required (category, doc_code) document set.
            $sel = ClmSegmentRule::query()
                ->where('client_id', $clientId)
                ->where('segment_id', $segId)
                ->value('doc_selections');
            $sel = is_array($sel) ? $sel : (json_decode((string) $sel, true) ?: []);

            $pairs = [];
            foreach ($sel as $cat => $codes) {
                foreach (array_keys((array) $codes) as $code) {
                    $pairs[] = [$cat, (string) $code];
                }
            }
            if (empty($pairs)) continue;

            $hasUpload = SegmentDocUpload::query()
                ->where('uploadable_type', $uploadableType)
                ->where('uploadable_id', $uploadableId)
                ->where('client_id', $clientId)
                ->where(function ($q) use ($pairs) {
                    foreach ($pairs as [$cat, $code]) {
                        $q->orWhere(fn ($w) => $w->where('category', $cat)->where('doc_code', $code));
                    }
                })
                ->exists();

            if ($hasUpload) $blocked[] = $name;
        }

        return $blocked;
    }

    /**
     * Given the row's current segment string and the incoming one, return the
     * REMOVED segments that still have uploads (so the edit must be rejected).
     *
     * @return string[] blocked segment names ([] = safe to proceed)
     */
    public static function blockedRemovals(string $uploadableType, int $uploadableId, int $clientId, ?string $oldSegment, ?string $newSegment): array
    {
        $old = self::names($oldSegment);
        $new = array_map('mb_strtolower', self::names($newSegment));

        // Segments present before but not after (case-insensitive compare).
        $removed = array_values(array_filter($old, fn ($s) => !in_array(mb_strtolower($s), $new, true)));
        if (empty($removed)) return [];

        return self::segmentsWithUploads($uploadableType, $uploadableId, $clientId, $removed);
    }
}
