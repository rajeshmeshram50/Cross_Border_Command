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
        $ownerIds = self::ownerIds($uploadableType, $uploadableId);

        foreach ($segmentNames as $name) {
            $name = trim($name);
            if ($name === '') continue;

            $keys = self::docKeys($clientId, $name, $ownerIds);
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
    public static function docKeys(int $clientId, string $segmentName, array $ownerIds = []): array
    {
        $name = trim($segmentName);
        if ($name === '') return [];

        // The owner's own segment(s) for this name first — two segments may share it.
        $segIds = self::resolveIds($clientId, null, [$name], $ownerIds);
        if (!$segIds) return [];

        $keys = [];
        foreach (ClmSegmentRule::query()->where('client_id', $clientId)->whereIn('segment_id', $segIds)->pluck('doc_selections') as $sel) {
            $sel = is_array($sel) ? $sel : (json_decode((string) $sel, true) ?: []);
            foreach ($sel as $cat => $codes) {
                foreach (array_keys((array) $codes) as $code) {
                    $keys[] = $cat . '|' . (string) $code;
                }
            }
        }
        return array_values(array_unique($keys));
    }

    /** Segment ids of an uploadable owner (customer / consignee), for docKeys(). */
    private static function ownerIds(string $uploadableType, int $uploadableId): array
    {
        if (!in_array($uploadableType, [\App\Models\Customer::class, \App\Models\Consignee::class], true)) return [];
        return self::idsOf($uploadableType::withoutGlobalScopes()->find($uploadableId));
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
     * Supplier-Purchase-Invoice statuses that count as committed (QA #94).
     *
     * The SPI branch of lockedSegmentNames() had NO status filter while the PO
     * branch beside it excluded drafts — so a supplier with nothing but a Draft
     * SPI had its segment locked and was told the segment was "used in a PO /
     * Invoice". Nothing had been issued; someone had merely started typing one.
     *
     * Vocabulary is Draft / Approved / Paid (see the `status` column comment in
     * 2026_07_09_000010_create_supplier_purchase_invoices_tables). Draft is the
     * default on insert, and is the one state that commits nothing.
     */
    public const SPI_COMMITTED = ['Approved', 'Paid'];

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
    /**
     * A supplier's locked segment names, kept SPLIT BY SOURCE (QA #94).
     *
     * lockedSegmentNames() merges these into one list, which is all the save
     * guard needs — but the edit form has to tell the user which document is
     * actually holding the segment. "used in a PO / Invoice" names two
     * different documents and leaves them hunting through both, when the server
     * knows perfectly well which one it found.
     *
     * @return array{po: string[], spi: string[]}
     */
    public static function vendorLockSources(int $vendorId, int $clientId): array
    {
        $po = \Illuminate\Support\Facades\DB::table('purchase_orders as po')
            ->join('purchase_order_items as poi', 'poi.purchase_order_id', '=', 'po.id')
            ->join('products as p', 'p.id', '=', 'poi.product_id')
            ->join('clm_segments as cs', 'cs.id', '=', 'p.segment_id')
            ->where('po.client_id', $clientId)
            ->where('po.vendor_id', $vendorId)
            ->whereIn('po.status', self::PO_COMMITTED)
            ->whereNull('po.deleted_at')
            ->distinct()
            ->pluck('cs.name')
            ->all();

        $spi = \Illuminate\Support\Facades\DB::table('supplier_purchase_invoices as spi')
            ->join('supplier_purchase_invoice_items as si', 'si.supplier_purchase_invoice_id', '=', 'spi.id')
            ->join('products as p', 'p.id', '=', 'si.product_id')
            ->join('clm_segments as cs', 'cs.id', '=', 'p.segment_id')
            ->where('spi.client_id', $clientId)
            ->where('spi.vendor_id', $vendorId)
            // Mirrors the PO_COMMITTED filter above — a Draft SPI commits
            // nothing and must not lock the segment (QA #94).
            ->whereIn('spi.status', self::SPI_COMMITTED)
            ->whereNull('spi.deleted_at')
            ->distinct()
            ->pluck('cs.name')
            ->all();

        return ['po' => array_values(array_unique($po)), 'spi' => array_values(array_unique($spi))];
    }

    public static function lockedSegmentNames(string $partyType, int $partyId, int $clientId): array
    {
        // Supplier/Vendor: segments of the products on an issued Purchase Order
        // OR a Supplier Purchase Invoice (a Direct SPI has no PO, so both count).
        if ($partyType === \App\Models\Vendor::class) {
            $src = self::vendorLockSources($partyId, $clientId);
            return array_values(array_unique(array_merge($src['po'], $src['spi'])));
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
        $ownerIds = self::ownerIds($uploadableType, $uploadableId);
        $removed = array_values(array_filter(array_map('trim', $removedNames), fn ($s) => $s !== ''));
        if (empty($removed)) return [];

        // Doc keys still required by a remaining segment survive (never orphaned).
        $keepKeys = [];
        foreach ($remainingNames as $name) {
            $keepKeys = array_merge($keepKeys, self::docKeys($clientId, trim((string) $name), $ownerIds));
        }
        $keepKeys = array_flip($keepKeys);

        $blocked = [];
        foreach ($removed as $name) {
            // Keys this segment requires that no remaining segment does.
            $orphan = array_values(array_filter(self::docKeys($clientId, $name, $ownerIds), fn ($k) => !isset($keepKeys[$k])));
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
        $ownerIds = self::ownerIds($uploadableType, $uploadableId);
        $removed = array_values(array_filter(array_map('trim', $removedNames), fn ($s) => $s !== ''));
        if (empty($removed)) return collect();

        // Doc keys still required by a remaining segment survive (never orphaned).
        $keepKeys = [];
        foreach ($remainingNames as $name) {
            $keepKeys = array_merge($keepKeys, self::docKeys($clientId, trim((string) $name), $ownerIds));
        }
        $keepKeys = array_flip($keepKeys);

        // Collect every orphan (category, doc_code) across all removed segments.
        $orphanKeys = [];
        foreach ($removed as $name) {
            foreach (self::docKeys($clientId, $name, $ownerIds) as $k) {
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
    /* ── Segment IDs ───────────────────────────────────────────────────────
     * Two segments may share a name (Less / Highly Regulated), so `segment_ids`
     * is the source of truth and the `segment` names string is derived from it. */

    /** @param mixed $ids @return int[] unique, in order */
    public static function ids($ids): array
    {
        if (is_string($ids)) $ids = json_decode($ids, true);
        return array_values(array_unique(array_filter(array_map('intval', (array) $ids))));
    }

    /** Comma-joined names for the given segment ids, in the same order. */
    public static function namesFor(array $ids): string
    {
        $ids = self::ids($ids);
        if (!$ids) return '';
        $byId = ClmSegment::withoutGlobalScopes()->whereIn('id', $ids)->pluck('name', 'id');
        return implode(', ', array_values(array_filter(array_map(fn ($id) => trim((string) ($byId[$id] ?? '')), $ids))));
    }

    /**
     * Map names to ids. A name already covered by `$prefer` keeps that id; otherwise
     * the same-branch row wins, then client-level, then the oldest.
     *
     * @param string[] $names @param int[] $prefer @return int[]
     */
    public static function resolveIds(?int $clientId, ?int $branchId, array $names, array $prefer = [], ?string $tier = null): array
    {
        $prefer = self::ids($prefer);
        $tier = mb_strtolower(trim((string) $tier));
        $preferByName = [];
        if ($prefer) {
            foreach (ClmSegment::withoutGlobalScopes()->whereIn('id', $prefer)->get(['id', 'name']) as $s) {
                $preferByName[mb_strtolower(trim($s->name))][] = (int) $s->id;
            }
        }
        $out = [];
        foreach ($names as $name) {
            $key = mb_strtolower(trim((string) $name));
            if ($key === '') continue;
            $ids = $preferByName[$key] ?? [];
            if (!$ids) {
                $id = ClmSegment::withoutGlobalScopes()
                    ->whereRaw('LOWER(TRIM(name)) = ?', [$key])
                    ->where(fn ($q) => $q->where('client_id', $clientId)->orWhereNull('client_id'))
                    ->when($tier !== '', fn ($q) => $q->whereRaw('LOWER(TRIM(regulatory_status)) = ?', [$tier]))
                    ->orderByRaw('CASE WHEN branch_id = ? THEN 0 WHEN branch_id IS NULL THEN 1 ELSE 2 END', [$branchId])
                    ->orderBy('id')
                    ->value('id');
                $ids = $id ? [(int) $id] : [];
            }
            foreach ($ids as $id) if (!in_array($id, $out, true)) $out[] = $id;
        }
        return $out;
    }

    /**
     * CLM document master rows for these codes. Codes restart per branch, so a known branch
     * keeps only its own + client-level rows (own first); callers keep the first row per code.
     */
    public static function branchCatalogue($query, int $clientId, array $codes, ?int $branchId)
    {
        $query->where('client_id', $clientId)->whereIn('code', $codes);
        if ($branchId) {
            $query->where(fn ($q) => $q->where('branch_id', $branchId)->orWhereNull('branch_id'))
                ->orderByRaw('CASE WHEN branch_id IS NULL THEN 1 ELSE 0 END');
        }
        return $query->orderBy('id');
    }

    /** Does a T&C library row apply to this segment? By stored ids; name + tier for rows not yet resolved. */
    public static function tncMatches($tnc, $segment): bool
    {
        $ids = self::ids($tnc->segment_ids ?? []);
        if ($ids) return in_array((int) $segment->id, $ids, true);
        if (mb_strtolower(trim((string) $tnc->regulatory)) !== mb_strtolower(trim((string) $segment->regulatory_status))) return false;
        return in_array(mb_strtolower(trim((string) $segment->name)), array_map('mb_strtolower', self::names($tnc->segment)), true);
    }

    /** Segment ids an owner carries — its stored ids, or its names resolved for rows saved before ids existed. */
    public static function idsOf($owner): array
    {
        if (!$owner) return [];
        $ids = self::ids($owner->segment_ids ?? []);
        if ($ids) return $ids;
        return self::resolveIds($owner->client_id ?? null, $owner->branch_id ?? null, self::names($owner->segment ?? null));
    }

    /** Union of the customers' segment ids — what a consignee inherits. @return int[] */
    public static function idsForCustomers(array $customerIds): array
    {
        $out = [];
        foreach (\App\Models\Customer::whereIn('id', array_filter(array_map('intval', $customerIds)))->get() as $c) {
            foreach (self::idsOf($c) as $id) if (!in_array($id, $out, true)) $out[] = $id;
        }
        return $out;
    }

    /**
     * A consignee's ids: its customers' union, plus any retained (locked) name the
     * union dropped, mapped back through the consignee's previous ids first.
     *
     * @param string[] $retainNames @return int[]
     */
    public static function consigneeIds(array $customerIds, array $retainNames, $consignee): array
    {
        $ids = self::idsForCustomers($customerIds);
        if (!$retainNames) return $ids;
        $covered = array_map('mb_strtolower', self::names(self::namesFor($ids)));
        $missing = array_values(array_filter($retainNames, fn ($n) => !in_array(mb_strtolower(trim($n)), $covered, true)));
        if (!$missing) return $ids;
        $extra = self::resolveIds($consignee->client_id ?? null, $consignee->branch_id ?? null, $missing, self::ids($consignee->segment_ids ?? []));
        foreach ($extra as $id) if (!in_array($id, $ids, true)) $ids[] = $id;
        return $ids;
    }

    /** @var array<int, array|null> rows already fetched this request — a list page shapes many owners */
    private static array $rowCache = [];

    /** {id, code, name, regulatory_status} rows for ids, in the same order. */
    public static function rowsFor(array $ids): array
    {
        $ids = self::ids($ids);
        if (!$ids) return [];
        $missing = array_values(array_filter($ids, fn ($id) => !array_key_exists($id, self::$rowCache)));
        if ($missing) {
            foreach ($missing as $id) self::$rowCache[$id] = null;
            foreach (ClmSegment::withoutGlobalScopes()->whereIn('id', $missing)->get(['id', 'code', 'name', 'regulatory_status']) as $s) {
                self::$rowCache[(int) $s->id] = ['id' => (int) $s->id, 'code' => $s->code, 'name' => $s->name, 'regulatory_status' => $s->regulatory_status];
            }
        }
        return array_values(array_filter(array_map(fn ($id) => self::$rowCache[$id] ?? null, $ids)));
    }

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
