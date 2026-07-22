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
     * Proforma-Invoice statuses that DON'T lock a segment. Any other PI status
     * (i.e. a PI that has merely been created) blocks segment removal — a
     * cancelled PI is void and is the only state that doesn't count.
     */
    public const PI_IGNORED = ['cancelled'];

    /**
     * Purchase-Order statuses that count as an issued/committed reference for a
     * supplier's segment (a Draft/Pending PO is not yet committed).
     */
    public const PO_COMMITTED = ['Sent for Sign', 'Signed', 'Approved'];

    /**
     * The segment NAMES present before the edit but not after (case-insensitive).
     *
     * @return string[]
     */
    public static function removedNames(?string $oldSegment, ?string $newSegment): array
    {
        $old = self::names($oldSegment);
        $new = array_map('mb_strtolower', self::names($newSegment));
        return array_values(array_filter($old, fn ($s) => !in_array(mb_strtolower($s), $new, true)));
    }

    /**
     * Is the party referenced by a COMPLETED downstream document that locks its
     * segments?  PIs/Shipments carry no segment of their own, so the link is
     * party-level: any qualifying document locks ALL of the party's segments.
     *   - Customer  → an approved/converted PI, or any Shipment through its PIs.
     *   - Consignee → same, matched on the PI's consignee_id.
     *   - Vendor    → an issued Purchase Order (Sent for Sign / Signed / Approved).
     *
     * @param  string $partyType  App\Models\Customer|Consignee|Vendor ::class
     */
    public static function hasCompletedReference(string $partyType, int $partyId, int $clientId): bool
    {
        // Supplier/Vendor: an issued Purchase Order.
        if ($partyType === \App\Models\Vendor::class) {
            return \Illuminate\Support\Facades\DB::table('purchase_orders')
                ->where('client_id', $clientId)
                ->where('vendor_id', $partyId)
                ->whereIn('status', self::PO_COMMITTED)
                ->whereNull('deleted_at')
                ->exists();
        }

        // Customer / Consignee: which PI column identifies the party.
        $piCol = $partyType === \App\Models\Consignee::class ? 'consignee_id'
            : ($partyType === \App\Models\Customer::class ? 'customer_id' : null);
        if ($piCol === null) return false;

        // Any Proforma Invoice created for this party (cancelled PIs excepted)…
        $piExists = \Illuminate\Support\Facades\DB::table('proforma_invoices')
            ->where('client_id', $clientId)
            ->where($piCol, $partyId)
            ->whereNotIn('status', self::PI_IGNORED)
            ->exists();
        if ($piExists) return true;

        // …or a Shipment (its mere existence = Stage-6 won) linked through the
        // party's PI.
        return \Illuminate\Support\Facades\DB::table('shipment_orders as so')
            ->join('proforma_invoices as pi', 'pi.id', '=', 'so.proforma_invoice_id')
            ->where('so.client_id', $clientId)
            ->where('pi.' . $piCol, $partyId)
            ->exists();
    }

    /**
     * Of the segments being removed from a party, return those blocked because
     * the party is referenced by a completed PI/Shipment (customer/consignee) or
     * an issued Purchase Order (vendor). Party-level, so it's all-or-nothing: any
     * completed reference blocks EVERY removed segment.
     *
     * @param  string[] $removedNames
     * @return string[] blocked segment names ([] = safe to proceed)
     */
    public static function blockedByCompletedDocs(string $partyType, int $partyId, int $clientId, array $removedNames): array
    {
        $removed = array_values(array_filter(array_map('trim', $removedNames), fn ($s) => $s !== ''));
        if (empty($removed)) return [];
        return self::hasCompletedReference($partyType, $partyId, $clientId) ? $removed : [];
    }

    /**
     * After segment(s) are removed from a party, delete the uploaded documents
     * required ONLY by the removed segment(s) — i.e. whose (category, doc_code)
     * is NOT required by any REMAINING segment. Documents shared with a segment
     * that stays are kept. Mirrors the manual doc delete: the stored file is
     * removed, then the row. Returns the number of documents deleted.
     *
     * @param  string   $partyType       App\Models\Customer|Consignee|Vendor ::class
     * @param  string[] $removedNames    segment names being removed
     * @param  string[] $remainingNames  segment names that stay
     */
    public static function cleanupOrphanedDocs(string $partyType, int $partyId, int $clientId, array $removedNames, array $remainingNames): int
    {
        $removed = array_values(array_filter(array_map('trim', $removedNames), fn ($s) => $s !== ''));
        if (empty($removed)) return 0;

        // (category|doc_code) keys required by the removed segment(s).
        $removedKeys = [];
        foreach ($removed as $name) {
            $removedKeys = array_merge($removedKeys, self::docKeys($clientId, $name));
        }
        $removedKeys = array_values(array_unique($removedKeys));
        if (empty($removedKeys)) return 0;

        // Keys still required by a remaining segment must survive.
        $keepKeys = [];
        foreach ($remainingNames as $name) {
            $keepKeys = array_merge($keepKeys, self::docKeys($clientId, trim((string) $name)));
        }
        $keepKeys = array_flip($keepKeys);

        // Orphaned = required by a removed segment, by no remaining one.
        $orphan = array_values(array_filter($removedKeys, fn ($k) => !isset($keepKeys[$k])));
        if (empty($orphan)) return 0;

        $rows = SegmentDocUpload::query()
            ->where('uploadable_type', $partyType)
            ->where('uploadable_id', $partyId)
            ->where('client_id', $clientId)
            ->where(function ($q) use ($orphan) {
                foreach ($orphan as $key) {
                    [$cat, $code] = explode('|', $key, 2);
                    $q->orWhere(fn ($w) => $w->where('category', $cat)->where('doc_code', $code));
                }
            })
            ->get();

        foreach ($rows as $row) {
            if ($row->attachment_path) {
                \Illuminate\Support\Facades\Storage::disk('public')->delete($row->attachment_path);
            }
            $row->delete();
        }
        return $rows->count();
    }

    /**
     * Merge names that must be RETAINED back into a derived segment string
     * (case-insensitive union), keeping the derived order first. Used where a
     * consignee's segment is derived from its customers: a segment locked by a
     * completed PI/Shipment must remain attached even if derivation dropped it.
     *
     * @param  string[] $retain
     */
    public static function mergeRetained(?string $derivedSegment, array $retain): string
    {
        $names = self::names($derivedSegment);
        $seen  = array_map('mb_strtolower', $names);
        foreach ($retain as $name) {
            $name = trim($name);
            if ($name === '' || in_array(mb_strtolower($name), $seen, true)) continue;
            $names[] = $name;
            $seen[]  = mb_strtolower($name);
        }
        return implode(', ', $names);
    }
}
