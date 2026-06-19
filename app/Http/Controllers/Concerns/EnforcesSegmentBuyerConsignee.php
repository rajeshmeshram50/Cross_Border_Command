<?php

namespace App\Http\Controllers\Concerns;

use App\Models\ClmSegment;
use App\Models\Consignee;
use App\Models\Customer;
use App\Models\Product;
use App\Support\SegmentGuard;
use Illuminate\Http\JsonResponse;

/**
 * Shared Quotation / PI guard for the segment "Buyer ≠ Consignee" rule.
 *
 * Each business segment carries a `buyer_consignee` flag (`allowed` /
 * `not_allowed`). When a quoted / invoiced product belongs to a segment that
 * is `not_allowed`, the buyer and consignee MUST be the same party — so a
 * distinct consignee (one that isn't flagged Same-as-Customer) is rejected.
 */
trait EnforcesSegmentBuyerConsignee
{
    /**
     * Returns a 422 JsonResponse when one of the doc's products belongs to a
     * segment that forbids a different Buyer and Consignee while a distinct
     * consignee is mapped — otherwise null (allowed).
     *
     * @param  array<int,int|string|null>  $productIds  product ids on the items
     */
    protected function segmentPartyBlockResponse(int $clientId, array $productIds, ?int $consigneeId): ?JsonResponse
    {
        $productIds = array_values(array_unique(array_filter($productIds)));
        if (empty($productIds)) {
            return null;
        }

        // The rule can only be violated by a DISTINCT consignee. With no
        // consignee, or a Same-as-Customer one, buyer == consignee already.
        if (!$consigneeId) {
            return null;
        }
        $consignee = Consignee::where('client_id', $clientId)->find($consigneeId);
        if (!$consignee || $consignee->same_as_customer) {
            return null;
        }

        // Products → their segments, then the segments that forbid B ≠ C.
        $segmentIds = Product::where('client_id', $clientId)
            ->whereIn('id', $productIds)
            ->whereNotNull('segment_id')
            ->pluck('segment_id')
            ->unique()
            ->values();
        if ($segmentIds->isEmpty()) {
            return null;
        }

        $blocked = ClmSegment::where('client_id', $clientId)
            ->whereIn('id', $segmentIds)
            ->where('buyer_consignee', 'not_allowed')
            ->orderBy('code')
            ->pluck('name');
        if ($blocked->isEmpty()) {
            return null;
        }

        $plural = $blocked->count() > 1;

        return response()->json([
            'status'  => false,
            'message' => 'Buyer and Consignee must be the SAME for the segment'
                . ($plural ? 's' : '') . ': ' . $blocked->implode(', ') . '. '
                . 'This segment does not allow a different Buyer and Consignee — set the Consignee to '
                . '“Same as Customer” (Stage 1) for this opportunity before saving.',
        ], 422);
    }

    /**
     * Returns a 422 JsonResponse when one of the lead's mapped products belongs
     * to a segment that the customer is NOT in — otherwise null (allowed).
     *
     * The product segment (via `products.segment_id` → clm_segments.name) must
     * be one of the customer's segments (the comma-joined `customers.segment`
     * list of names). This is the "Customer ↔ Product segment must match" rule
     * enforced at mapping time, regardless of the order the two were mapped:
     *   • mapping a product after a customer is set → product checked here, and
     *   • setting/changing the customer with products already mapped → all
     *     mapped products checked here.
     *
     * When either side has no segment, the rule can't be evaluated and we allow
     * (null) — the comparison is only meaningful when both carry a segment.
     *
     * @param  array<int,int|string|null>  $productIds  product ids to check
     */
    protected function segmentCustomerProductMismatchResponse(int $clientId, array $productIds, ?int $customerId): ?JsonResponse
    {
        $productIds = array_values(array_unique(array_filter($productIds)));
        if (empty($productIds) || !$customerId) {
            return null;
        }

        $customer = Customer::where('client_id', $clientId)->find($customerId);
        if (!$customer) {
            return null;
        }

        // Customer's segment list (comma-joined names) → lowercased set.
        $customerNames = SegmentGuard::names($customer->segment);
        if (empty($customerNames)) {
            return null; // no segment on the customer → nothing to match against
        }
        $customerSet = array_map('mb_strtolower', $customerNames);

        // Mapped products that carry a segment, with the segment name resolved.
        $products = Product::where('client_id', $clientId)
            ->whereIn('id', $productIds)
            ->whereNotNull('segment_id')
            ->with('segment:id,name')
            ->get(['id', 'name', 'product_code', 'segment_id']);

        $mismatches = [];
        foreach ($products as $p) {
            $segName = $p->segment?->name;
            if (!$segName) {
                continue; // segment row missing → can't evaluate, allow
            }
            if (!in_array(mb_strtolower($segName), $customerSet, true)) {
                $label = $p->product_code ? "{$p->name} ({$p->product_code})" : $p->name;
                $mismatches[$label] = $segName;
            }
        }

        if (empty($mismatches)) {
            return null;
        }

        $plural = count($mismatches) > 1;
        $details = [];
        foreach ($mismatches as $label => $segName) {
            $details[] = "“{$label}” belongs to segment “{$segName}”";
        }

        return response()->json([
            'status'  => false,
            'message' => 'Segment mismatch: ' . implode('; ', $details) . '. '
                . 'The product segment'
                . ($plural ? 's' : '')
                . ' must match the customer\'s segment'
                . (count($customerNames) > 1 ? 's' : '')
                . ': ' . implode(', ', $customerNames) . '. '
                . 'Map a product from the same segment as the customer (or update the customer\'s segment) before saving.',
        ], 422);
    }
}
