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
     * The segments a CONSIGNEE is entitled to: the union of its mapped
     * customers' segments.
     *
     * A consignee never chooses its own segment — it works in whatever segments
     * the customers shipping through it work in. The modal reflects that (the
     * field is read-only, "Inherited from customer"), but until this existed the
     * value was assembled in the browser and posted, so the server took the
     * client's word for it: create trusted `$data['segment']` verbatim, and a
     * consignee whose inherit never fired saved with an empty segment against a
     * field the user had no control to fix.
     *
     * Union, not the primary customer's alone — a consignee can be mapped to
     * several customers (consignee_customer pivot) and must cover all of them.
     * De-duplicated case-insensitively; segment names are free text in the
     * master, so "Rice" and "rice" are the same segment.
     *
     * Returns the comma-joined string the `segment` COLUMN stores, so callers
     * write it straight to the column. It stays a real column rather than a
     * computed accessor because ClmSegmentController scans it directly for
     * usage-counts / delete-protection, and the list view filters on it.
     *
     * @param  int[] $customerIds
     */
    public static function forCustomers(array $customerIds): string
    {
        $ids = array_values(array_filter(array_map('intval', $customerIds)));
        if (empty($ids)) return '';

        $names = [];
        $seen  = [];
        foreach (\App\Models\Customer::whereIn('id', $ids)->pluck('segment') as $raw) {
            foreach (self::names($raw) as $name) {
                $key = mb_strtolower($name);
                if (isset($seen[$key])) continue;
                $seen[$key] = true;
                $names[] = $name;
            }
        }
        return implode(', ', $names);
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

            $keys = self::docKeys($clientId, $name);
            if (empty($keys)) continue;

            $hasUpload = SegmentDocUpload::query()
                ->where('uploadable_type', $uploadableType)
                ->where('uploadable_id', $uploadableId)
                ->where('client_id', $clientId)
                ->where(function ($q) use ($keys) {
                    foreach ($keys as $key) {
                        [$cat, $code] = explode('|', $key, 2);
                        $q->orWhere(fn ($w) => $w->where('category', $cat)->where('doc_code', $code));
                    }
                })
                ->exists();

            if ($hasUpload) $blocked[] = $name;
        }

        return $blocked;
    }

    /**
     * The (category, doc_code) documents a segment requires, as "cat|code" keys.
     *
     * Uploads are stored per (entity, category, doc_code) — NOT per segment — so
     * one file satisfies every segment that asks for that doc_code, and any
     * segment listing that code counts as "has uploads".
     *
     * @return string[]
     */
    private static function docKeys(int $clientId, string $segmentName): array
    {
        $name = trim($segmentName);
        if ($name === '') return [];

        // Resolve the segment id by name (tenant row first, else global).
        $segId = ClmSegment::query()
            ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
            ->where(fn ($q) => $q->where('client_id', $clientId)->orWhereNull('client_id'))
            ->value('id');
        if (!$segId) return [];

        $sel = ClmSegmentRule::query()
            ->where('client_id', $clientId)
            ->where('segment_id', $segId)
            ->value('doc_selections');
        $sel = is_array($sel) ? $sel : (json_decode((string) $sel, true) ?: []);

        $keys = [];
        foreach ($sel as $cat => $codes) {
            foreach (array_keys((array) $codes) as $code) {
                $keys[] = $cat . '|' . (string) $code;
            }
        }
        return array_values(array_unique($keys));
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

        /* A shared document counts for EVERY segment listing it, whether or not
         * another selected segment also requires it. Four segments sharing one
         * mandatory DD doc are therefore all locked by a single upload — the
         * document must be deleted before any of them can be dropped. (An
         * "orphan-only" variant that allowed removing all but the last was
         * tried and rejected: blocking 3-of-4 removals silently reads as
         * arbitrary.) */
        return self::segmentsWithUploads($uploadableType, $uploadableId, $clientId, $removed);
    }
}
