<?php

namespace App\Http\Controllers\Concerns;

use App\Models\ClmSegment;
use App\Models\Consignee;
use App\Models\Customer;
use App\Models\Product;
use App\Support\SegmentGuard;
use Illuminate\Http\JsonResponse;

trait EnforcesSegmentBuyerConsignee
{
    protected function segmentPartyBlockResponse(int $clientId, array $productIds, ?int $consigneeId): ?JsonResponse
    {
        $productIds = array_values(array_unique(array_filter($productIds)));
        if (empty($productIds)) {
            return null;
        }

        if (!$consigneeId) {
            return null;
        }
        $consignee = Consignee::where('client_id', $clientId)->find($consigneeId);
        if (!$consignee || $consignee->same_as_customer) {
            return null;
        }

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
            'message' => 'Customer and Consignee must be the SAME for the segment'
                . ($plural ? 's' : '') . ': ' . $blocked->implode(', ') . '. '
                . 'This segment does not allow a different Customer and Consignee — set the Consignee to '
                . '“Same as Customer” (Stage 1) for this opportunity before saving.',
        ], 422);
    }

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

        $customerIds = SegmentGuard::idsOf($customer);
        if (empty($customerIds)) {
            return null;
        }
        $customerNames = array_map(fn ($r) => self::segmentWithStatus($r['name'], $r['regulatory_status']), SegmentGuard::rowsFor($customerIds));

        $products = Product::where('client_id', $clientId)
            ->whereIn('id', $productIds)
            ->whereNotNull('segment_id')
            ->with('segment:id,name,regulatory_status')
            ->get(['id', 'name', 'product_code', 'segment_id']);

        $mismatches = [];
        foreach ($products as $p) {
            if (!$p->segment) {
                continue;
            }
            if (!in_array((int) $p->segment_id, $customerIds, true)) {
                $label = $p->product_code ? "{$p->name} ({$p->product_code})" : $p->name;
                $mismatches[$label] = self::segmentWithStatus($p->segment->name, $p->segment->regulatory_status);
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

    private static function segmentWithStatus(string $name, ?string $status): string
    {
        $tag = $status === 'highly' ? 'High Reg' : ($status === 'less' ? 'Low Reg' : null);
        return $tag ? "{$name} ({$tag})" : $name;
    }
}
