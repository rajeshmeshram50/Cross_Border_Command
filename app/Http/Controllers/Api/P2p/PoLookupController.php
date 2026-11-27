<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Controller;
use App\Models\ShipmentOrder;
use App\Models\Vendor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PoLookupController extends Controller
{
    public function suppliers(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $docFilter = $request->validate([
            'document_type' => ['nullable', 'in:domestic,international'],
        ])['document_type'] ?? null;
        $indiaId = DB::table('master_countries')->whereRaw('LOWER(name) = ?', ['india'])->value('id');
        $rows = Vendor::query()
            ->forUser($user, $request->integer('branch_id') ?: null)
            ->with([
                'primaryAddress:id,vendor_id,country_id,state_id,city', 'primaryAddress.state:id,name',
                'vendorType:id,name', 'riskLevel:id,name', 'segments:id,name', 'segment:id,name',
            ])
            ->orderBy('company_name')
            ->get(['id', 'vendor_code', 'company_name', 'legal_name', 'vendor_type_id', 'supplier_category',
                'risk_level_id', 'segment_id'])
            ->map(function ($v) use ($indiaId) {
                $a = $v->primaryAddress;
                $cid = optional($a)->country_id;
                $docType = $cid ? (((int) $cid === (int) $indiaId) ? 'domestic' : 'international') : 'domestic';
                $segNames = $v->segments->pluck('name')->filter()->unique()->values()->all();
                if (empty($segNames) && $v->segment?->name) $segNames = [$v->segment->name];
                return [
                    'id' => $v->id,
                    'code' => $v->vendor_code,
                    'name' => $v->company_name ?: $v->legal_name,
                    'document_type' => $docType,
                    'supplier_type' => $v->vendorType?->name,
                    'supplier_category' => $v->supplier_category,
                    'segments' => $segNames,
                    'city' => $a?->city,
                    'state' => $a?->state?->name,
                    'risk' => $v->riskLevel?->name,
                ];
            });
        if ($docFilter) $rows = $rows->where('document_type', $docFilter)->values();
        return response()->json(['status' => true, 'data' => $rows]);
    }

    public function supplier(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $v = Vendor::with(['primaryAddress', 'vendorType', 'riskLevel', 'gstScrutiny' => fn($g) => $g->latest('id')])
            ->forUser($user, $request->integer('branch_id') ?: null)
            ->findOrFail($id);

        if ($request->boolean('refresh_currencies')) {
            app(\App\Services\ZohoBooksService::class)->forgetCurrencyCache();
        }

        $a = $v->primaryAddress;
        $g = $v->gstScrutiny->sortByDesc('id')->first();
        $country = $a && $a->country_id ? DB::table('master_countries')->where('id', $a->country_id)->value('name') : null;
        $state = $a && $a->state_id ? DB::table('master_states')->where('id', $a->state_id)->value('name') : null;

        $segNames = $v->segments()->pluck('clm_segments.name')->filter()->unique()->values()->all();
        if (empty($segNames) && $v->segment_id) {
            $segNames = ClmSegment::where('id', $v->segment_id)->pluck('name')->all();
        }

        return response()->json(['status' => true, 'data' => [
            'id' => $v->id,
            'code' => $v->vendor_code,
            'segments' => $segNames,
            'name' => $v->company_name ?: $v->legal_name,
            'legalName' => $v->legal_name,
            'type' => optional($v->vendorType)->name,
            'risk' => optional($v->riskLevel)->name,
            'category' => $v->supplier_category,
            'addr' => optional($a)->address_line,
            'country' => $country,
            'state' => $state,
            'stateCode' => optional($a)->state_code,
            'city' => optional($a)->city,
            'contact' => optional($a)->contact_name,
            'desig' => optional($a)->designation,
            'phone' => optional($a)->contact_no,
            'email' => optional($a)->email,
            'scrutiny' => $g ? optional($g->created_at)->toDateString() : null,
            'gstNo' => optional($g)->gst_number,
            'gstStatus' => optional($g)->status,
            'filing' => $g && $g->last_filing_date ? $g->last_filing_date->toDateString() : null,
            'remarks' => $g ? ($g->prev_non_gst_2a_invoice ?: $g->red_flags) : null,
            'mapped_product_ids' => app(\App\Services\P2p\PurchaseOrderService::class)->vendorProductIds((int) $v->id),
            'product_rates' => app(\App\Services\P2p\PurchaseOrderService::class)->vendorProductRates((int) $v->id),
            'zohoCurrency' => app(\App\Services\P2p\VendorCurrencyGuard::class)
                ->currencyInZoho((int) $v->client_id, (int) $v->id),
            'zohoCurrencySettled' => app(\App\Services\P2p\VendorCurrencyGuard::class)
                ->settledCurrency((int) $v->client_id, (int) $v->id) !== null,
            'zohoCurrencyPo' => app(\App\Services\P2p\VendorCurrencyGuard::class)
                ->settledByPo((int) $v->client_id, (int) $v->id),
            'zohoCurrencies' => app(\App\Services\ZohoBooksService::class)->enabledCurrencies(),
        ]]);
    }

    public function shipments(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = ShipmentOrder::query()->with(['lead.customer', 'lead.consignee', 'proformaInvoice'])->orderByDesc('id');
        $this->applyScope($q, $user, $request->integer('branch_id') ?: null);
        $shipments = $q->get();

        $pendingByPi = $this->pendingQtyByPi($shipments->pluck('proforma_invoice_id')->filter()->unique()->all(), $user->client_id);

        $rows = $shipments->map(function ($s) use ($pendingByPi) {
            $lead = $s->lead;
            $pid = $s->proforma_invoice_id;
            $hasPending = $pid !== null && array_key_exists($pid, $pendingByPi);
            return [
                'id' => $s->id,
                'code' => $s->shipment_code,
                'shipment_date' => $s->created_at?->toDateString(),
                'customer' => $lead && $lead->customer ? $lead->customer->company_name : null,
                'consignee' => $lead && $lead->consignee ? $lead->consignee->company_name : null,
                'opportunity_id' => $s->lead_id,
                'opportunity_code' => $lead->opp_code ?? null,
                'proforma_invoice_id' => $pid,
                'pi_number' => optional($s->proformaInvoice)->code,
                'pending_qty' => $hasPending ? round($pendingByPi[$pid], 3) : null,
                'fully_invoiced' => $hasPending && $pendingByPi[$pid] <= 0,
            ];
        });
        return response()->json(['status' => true, 'data' => $rows]);
    }

    private function pendingQtyByPi(array $piIds, ?int $clientId): array
    {
        if (!$piIds || !$clientId) return [];
        $items = DB::table('proforma_invoice_items')
            ->whereIn('proforma_invoice_id', $piIds)
            ->get(['id', 'proforma_invoice_id', 'quantity']);
        if ($items->isEmpty()) return [];

        $ordered = app(\App\Services\P2p\PurchaseOrderService::class)
            ->orderedByPiItem($clientId, $items->pluck('id')->all());

        $out = [];
        foreach ($items as $it) {
            $pending = max(0, (float) $it->quantity - (float) ($ordered[(int) $it->id] ?? 0));
            $pid = (int) $it->proforma_invoice_id;
            $out[$pid] = ($out[$pid] ?? 0) + $pending;
        }
        return $out;
    }

    private function applyScope($q, $user, ?int $branchFilter = null): void
    {
        if ($user->user_type === 'super_admin') {
            if ($branchFilter !== null) $q->where('branch_id', $branchFilter);
            return;
        }
        if (!$user->client_id) {
            $q->whereRaw('1 = 0');
            return;
        }
        $q->where('client_id', $user->client_id);
        if ($user->user_type !== 'branch_user' || !$user->branch_id) {
            if ($branchFilter !== null) {
                $ok = \App\Models\Branch::where('id', $branchFilter)->where('client_id', $user->client_id)->exists();
                if ($ok) $q->where('branch_id', $branchFilter);
            }
            return;
        }
        $q->where('branch_id', $user->branch_id);
    }
}
