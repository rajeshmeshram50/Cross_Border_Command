<?php

namespace App\Http\Controllers\Concerns;

use App\Models\ClmSegment;
use App\Models\Consignee;
use App\Models\Product;
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
}
