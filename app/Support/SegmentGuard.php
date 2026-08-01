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
    public static function docKeys(int $clientId, string $segmentName): array
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
     * The (category|doc_code) keys of every document ACTUALLY uploaded for a
     * party — the exact shape docKeys() returns, so the removal guard can match
     * "required by X" against "uploaded" without reconstructing it on the client.
     *
     * @return string[]
     */
    public static function uploadedDocKeys(string $uploadableType, int $uploadableId, int $clientId): array
    {
        return SegmentDocUpload::query()
            ->where('uploadable_type', $uploadableType)
            ->where('uploadable_id', $uploadableId)
            ->where('client_id', $clientId)
            ->get(['category', 'doc_code'])
            ->map(fn ($r) => $r->category . '|' . $r->doc_code)
            ->unique()->values()->all();
    }

    /**
     * Proforma-Invoice statuses that DON'T lock a segment. Any other PI status
     * (i.e. a PI that has merely been created) blocks segment removal — a
     * cancelled PI is void and is the only state that doesn't count.
     */
    public const PI_IGNORED = ['cancelled'];

    /**
     * Quotation statuses that DON'T lock a segment. A quotation is soft-deleted
     * by setting status = 'cancelled' (rows are never hard-deleted), so a
     * cancelled quote is void and is the only state that doesn't count.
     */
    public const QT_IGNORED = ['cancelled'];

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
     * segments?  The link is per-segment via the document's PRODUCTS — a segment
     * is locked only when a product on a qualifying document belongs to it:
     *   - Customer  → a product on a non-cancelled PI, or a PI that has a Shipment.
     *   - Consignee → same, matched on the PI's consignee_id.
     *   - Vendor    → a product on an issued PO (Sent for Sign / Signed / Approved).
     *
     * Returns the SEGMENT NAMES locked for the party (a segment the party carries
     * but that is NOT among these can be removed freely).
     *
     * @param  string $partyType  App\Models\Customer|Consignee|Vendor ::class
     * @return string[]
     */
    public static function lockedSegmentNames(string $partyType, int $partyId, int $clientId): array
    {
        // Supplier/Vendor: segments of the products on an issued Purchase Order
        // OR a Supplier Purchase Invoice (a Direct SPI has no PO, so both count).
        if ($partyType === \App\Models\Vendor::class) {
            $poNames = \Illuminate\Support\Facades\DB::table('purchase_orders as po')
                ->join('purchase_order_items as poi', 'poi.purchase_order_id', '=', 'po.id')
                ->join('products as p', 'p.id', '=', 'poi.product_id')
                ->join('clm_segments as cs', 'cs.id', '=', 'p.segment_id')
                ->where('po.client_id', $clientId)
                ->where('po.vendor_id', $partyId)
                ->whereIn('po.status', self::PO_COMMITTED)
                ->whereNull('po.deleted_at')
                ->distinct()
                ->pluck('cs.name')
                ->all();
            $spiNames = \Illuminate\Support\Facades\DB::table('supplier_purchase_invoices as spi')
                ->join('supplier_purchase_invoice_items as si', 'si.supplier_purchase_invoice_id', '=', 'spi.id')
                ->join('products as p', 'p.id', '=', 'si.product_id')
                ->join('clm_segments as cs', 'cs.id', '=', 'p.segment_id')
                ->where('spi.client_id', $clientId)
                ->where('spi.vendor_id', $partyId)
                ->whereNull('spi.deleted_at')
                ->distinct()
                ->pluck('cs.name')
                ->all();
            return array_values(array_unique(array_merge($poNames, $spiNames)));
        }

        // Customer / Consignee: which party column identifies the party (same
        // column name on both quotations and proforma_invoices).
        $partyCol = $partyType === \App\Models\Consignee::class ? 'consignee_id'
            : ($partyType === \App\Models\Customer::class ? 'customer_id' : null);
        if ($partyCol === null) return [];

        // Segments of the products on this party's PIs — a PI counts if it is not
        // cancelled OR it has a Shipment (Stage-6 won).
        $piNames = \Illuminate\Support\Facades\DB::table('proforma_invoices as pi')
            ->join('proforma_invoice_items as pii', 'pii.proforma_invoice_id', '=', 'pi.id')
            ->join('products as p', 'p.id', '=', 'pii.product_id')
            ->join('clm_segments as cs', 'cs.id', '=', 'p.segment_id')
            ->where('pi.client_id', $clientId)
            ->where('pi.' . $partyCol, $partyId)
            ->where(function ($q) {
                $q->whereNotIn('pi.status', self::PI_IGNORED)
                  ->orWhereExists(function ($s) {
                      $s->selectRaw('1')->from('shipment_orders as so')->whereColumn('so.proforma_invoice_id', 'pi.id');
                  });
            })
            ->distinct()
            ->pluck('cs.name')
            ->all();

        // Segments of the products on this party's QUOTATIONS — a quotation locks
        // the segment too (a Stage-5 quote already commits the product/segment,
        // before any PI/Shipment). Cancelled quotes are ignored (soft-delete).
        $qtNames = \Illuminate\Support\Facades\DB::table('quotations as q')
            ->join('quotation_items as qi', 'qi.quotation_id', '=', 'q.id')
            ->join('products as p', 'p.id', '=', 'qi.product_id')
            ->join('clm_segments as cs', 'cs.id', '=', 'p.segment_id')
            ->where('q.client_id', $clientId)
            ->where('q.' . $partyCol, $partyId)
            ->whereNotIn('q.status', self::QT_IGNORED)
            ->distinct()
            ->pluck('cs.name')
            ->all();

        return array_values(array_unique(array_merge($piNames, $qtNames)));
    }

    /**
     * Of the segments being removed from a party, return those blocked because a
     * product on a completed PI/Shipment (customer/consignee) or an issued
     * Purchase Order (vendor) belongs to that segment. Per-segment: only the
     * segments actually used downstream are blocked; the rest remove freely.
     *
     * @param  string[] $removedNames
     * @return string[] blocked segment names ([] = safe to proceed)
     */
    public static function blockedByCompletedDocs(string $partyType, int $partyId, int $clientId, array $removedNames): array
    {
        $removed = array_values(array_filter(array_map('trim', $removedNames), fn ($s) => $s !== ''));
        if (empty($removed)) return [];
        $locked = array_map('mb_strtolower', self::lockedSegmentNames($partyType, $partyId, $clientId));
        if (empty($locked)) return [];
        return array_values(array_filter($removed, fn ($s) => in_array(mb_strtolower($s), $locked, true)));
    }

    /**
     * Segments the party is linked to through the PRODUCT layer, BEFORE any
     * completed transaction exists — the "Product Directory" (customer/consignee)
     * or "Product mapping" (supplier) dependency:
     *   - Customer  → a product on one of the customer's leads  (lead_products).
     *   - Consignee → a product on one of the consignee's leads (lead_products).
     *   - Vendor    → a product mapped to the supplier          (vendor_product_mappings).
     *
     * A product carries a segment (products.segment_id); the party is "using" a
     * segment as soon as a product of that segment is attached here, even with no
     * PI/Shipment/PO/SPI yet.
     *
     * @param  string $partyType  App\Models\Customer|Consignee|Vendor ::class
     * @return string[] segment names the party is linked to via products
     */
    public static function productMappingSegmentNames(string $partyType, int $partyId, int $clientId): array
    {
        // Supplier: products mapped directly to the vendor.
        if ($partyType === \App\Models\Vendor::class) {
            return \Illuminate\Support\Facades\DB::table('vendor_product_mappings as vpm')
                ->join('products as p', 'p.id', '=', 'vpm.product_id')
                ->join('clm_segments as cs', 'cs.id', '=', 'p.segment_id')
                ->where('vpm.vendor_id', $partyId)
                ->whereNull('vpm.deleted_at')
                ->whereNull('p.deleted_at')
                ->distinct()
                ->pluck('cs.name')
                ->all();
        }

        // Customer / Consignee: products selected on the party's leads.
        $leadCol = $partyType === \App\Models\Consignee::class ? 'consignee_id'
            : ($partyType === \App\Models\Customer::class ? 'customer_id' : null);
        if ($leadCol === null) return [];

        return \Illuminate\Support\Facades\DB::table('lead_products as lp')
            ->join('leads as l', 'l.id', '=', 'lp.lead_id')
            ->join('products as p', 'p.id', '=', 'lp.product_id')
            ->join('clm_segments as cs', 'cs.id', '=', 'p.segment_id')
            ->where('l.client_id', $clientId)
            ->where('l.' . $leadCol, $partyId)
            ->whereNull('l.deleted_at')
            ->whereNull('p.deleted_at')
            ->distinct()
            ->pluck('cs.name')
            ->all();
    }

    /**
     * Of the segments being removed, return those blocked because a product of
     * that segment is attached to the party via the Product Directory (a lead,
     * for customer/consignee) or Product mapping (for supplier) — independent of
     * any completed PI/Shipment/PO/SPI. Per-segment: only the segments actually
     * used are blocked.
     *
     * @param  string[] $removedNames
     * @return string[] blocked segment names ([] = safe to proceed)
     */
    public static function blockedByProductMapping(string $partyType, int $partyId, int $clientId, array $removedNames): array
    {
        $removed = array_values(array_filter(array_map('trim', $removedNames), fn ($s) => $s !== ''));
        if (empty($removed)) return [];
        $used = array_map('mb_strtolower', self::productMappingSegmentNames($partyType, $partyId, $clientId));
        if (empty($used)) return [];
        return array_values(array_filter($removed, fn ($s) => in_array(mb_strtolower($s), $used, true)));
    }

    /**
     * Of the segments being removed, return those blocked because they have an
     * uploaded document UNIQUE to them — a (category, doc_code) the segment
     * requires, that is uploaded, and that NO remaining segment also requires
     * (so removing the segment would orphan it). A document shared with a segment
     * that stays does NOT block (it survives on that segment).
     *
     * @param  string[] $removedNames
     * @param  string[] $remainingNames
     * @return string[] blocked segment names ([] = safe to proceed)
     */
    public static function blockedByOrphanDocs(string $uploadableType, int $uploadableId, int $clientId, array $removedNames, array $remainingNames): array
    {
        $removed = array_values(array_filter(array_map('trim', $removedNames), fn ($s) => $s !== ''));
        if (empty($removed)) return [];

        // Doc keys still required by a remaining segment survive (never orphaned).
        $keepKeys = [];
        foreach ($remainingNames as $name) {
            $keepKeys = array_merge($keepKeys, self::docKeys($clientId, trim((string) $name)));
        }
        $keepKeys = array_flip($keepKeys);

        $blocked = [];
        foreach ($removed as $name) {
            // Keys this segment requires that no remaining segment does.
            $orphan = array_values(array_filter(self::docKeys($clientId, $name), fn ($k) => !isset($keepKeys[$k])));
            if (empty($orphan)) continue;
            // Blocked only if one of those orphan docs is actually uploaded.
            $hasUpload = SegmentDocUpload::query()
                ->where('uploadable_type', $uploadableType)
                ->where('uploadable_id', $uploadableId)
                ->where('client_id', $clientId)
                ->where(function ($q) use ($orphan) {
                    foreach ($orphan as $key) {
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
     * The actual uploaded document records that would be ORPHANED by removing
     * these segments — i.e. docs unique to a removed segment (a (category,
     * doc_code) that no remaining segment requires) that are actually uploaded.
     * Returned so the caller can list them in a confirmation dialog and delete
     * them on confirm, instead of hard-blocking the removal. Empty = nothing to
     * confirm; the segment can be removed cleanly (all docs shared / none).
     *
     * @param  string[] $removedNames
     * @param  string[] $remainingNames
     * @return \Illuminate\Support\Collection<int,\App\Models\SegmentDocUpload>
     */
    public static function orphanUploads(string $uploadableType, int $uploadableId, int $clientId, array $removedNames, array $remainingNames)
    {
        $removed = array_values(array_filter(array_map('trim', $removedNames), fn ($s) => $s !== ''));
        if (empty($removed)) return collect();

        // Doc keys still required by a remaining segment survive (never orphaned).
        $keepKeys = [];
        foreach ($remainingNames as $name) {
            $keepKeys = array_merge($keepKeys, self::docKeys($clientId, trim((string) $name)));
        }
        $keepKeys = array_flip($keepKeys);

        // Collect every orphan (category, doc_code) across all removed segments.
        $orphanKeys = [];
        foreach ($removed as $name) {
            foreach (self::docKeys($clientId, $name) as $k) {
                if (!isset($keepKeys[$k])) $orphanKeys[$k] = true;
            }
        }
        if (empty($orphanKeys)) return collect();

        return SegmentDocUpload::query()
            ->where('uploadable_type', $uploadableType)
            ->where('uploadable_id', $uploadableId)
            ->where('client_id', $clientId)
            ->where(function ($q) use ($orphanKeys) {
                foreach (array_keys($orphanKeys) as $key) {
                    [$cat, $code] = explode('|', $key, 2);
                    $q->orWhere(fn ($w) => $w->where('category', $cat)->where('doc_code', $code));
                }
            })
            ->get();
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
