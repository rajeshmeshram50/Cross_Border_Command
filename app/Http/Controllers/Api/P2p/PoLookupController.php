<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Controller;
use App\Models\ShipmentOrder;
use App\Models\Vendor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * P2P · the supplier and shipment lookups the Create PO wizard fills its
 * Stage-1 dropdowns from.
 *
 * Lifted out of the legacy Api\PurchaseOrderController, which the new PO screen
 * reached across to for these three reads — the one thread that tied the two
 * Purchase Order modules together. They answer the same question for either
 * screen, so they belong to neither.
 */
class PoLookupController extends Controller
{
    /** All suppliers (vendors) for the Stage-1 "Select Supplier" dropdown. */
    public function suppliers(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        // India country id (once) → decide each supplier's document type: a supplier
        // whose primary address country is India is DOMESTIC, any other country is
        // INTERNATIONAL. This drives the Stage-1 gate (the PO's Document Type must
        // match the supplier's).
        $indiaId = DB::table('master_countries')->whereRaw('LOWER(name) = ?', ['india'])->value('id');
        $rows = Vendor::query()
            ->forUser($user, $request->integer('branch_id') ?: null)
            ->with(['primaryAddress:id,vendor_id,country_id', 'vendorType:id,name'])
            ->orderBy('company_name')
            ->get(['id', 'vendor_code', 'company_name', 'legal_name', 'vendor_type_id', 'supplier_category'])
            ->map(function ($v) use ($indiaId) {
                $cid = optional($v->primaryAddress)->country_id;
                // No country yet → treat as domestic (the pre-onboarding default).
                $docType = $cid ? (((int) $cid === (int) $indiaId) ? 'domestic' : 'international') : 'domestic';
                return [
                    'id' => $v->id,
                    'code' => $v->vendor_code,
                    'name' => $v->company_name ?: $v->legal_name,
                    'document_type' => $docType,
                    // Create PO lists only suppliers of the PO's type and locks blacklisted ones.
                    'supplier_type' => $v->vendorType?->name,
                    'supplier_category' => $v->supplier_category,
                ];
            });
        return response()->json(['status' => true, 'data' => $rows]);
    }

    /** Full supplier detail to auto-fill Stage 1 after a supplier is selected. */
    public function supplier(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $v = Vendor::with(['primaryAddress', 'vendorType', 'riskLevel', 'gstScrutiny' => fn($g) => $g->latest('id')])
            ->forUser($user, $request->integer('branch_id') ?: null)
            ->findOrFail($id);

        /* The currency list is cached for an hour, which is exactly wrong for
           someone who has just added one in Zoho and come back to try again. */
        if ($request->boolean('refresh_currencies')) {
            app(\App\Services\ZohoBooksService::class)->forgetCurrencyCache();
        }

        $a = $v->primaryAddress;
        // Newest scrutiny is the current GST status. The relation carries a
        // baked-in orderBy('id') ASC, so a `latest('id')` in the eager-load
        // closure only appends a redundant secondary sort and ->first() would
        // return the OLDEST row — sort the loaded collection to be order-safe.
        $g = $v->gstScrutiny->sortByDesc('id')->first();
        $country = $a && $a->country_id ? DB::table('master_countries')->where('id', $a->country_id)->value('name') : null;
        $state = $a && $a->state_id ? DB::table('master_states')->where('id', $a->state_id)->value('name') : null;

        // Vendor's onboarded segment NAMES — drives the Stage-2 product picker so
        // only products in a segment this supplier deals in can be selected
        // (QA #16). Vendors carry multiple segments via the pivot; fall back to
        // the legacy scalar segment_id.
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
            // Create PO: a product is orderable when its segment OR the product itself is mapped to this supplier.
            'mapped_product_ids' => app(\App\Services\P2p\PurchaseOrderService::class)->vendorProductIds((int) $v->id),
            // What this supplier charges per mapped product — a PO line takes it over the master price.
            'product_rates' => app(\App\Services\P2p\PurchaseOrderService::class)->vendorProductRates((int) $v->id),
            /* What Zoho Books shows for this supplier, so Stage 01 answers the
               currency as the supplier is picked rather than refusing the form
               once it is filled. `settled` means a transaction of ours put it
               there — only then is no other currency possible. Null = not in the
               books yet, everything still open. */
            'zohoCurrency' => app(\App\Services\P2p\VendorCurrencyGuard::class)
                ->currencyInZoho((int) $v->client_id, (int) $v->id),
            'zohoCurrencySettled' => app(\App\Services\P2p\VendorCurrencyGuard::class)
                ->settledCurrency((int) $v->client_id, (int) $v->id) !== null,
            // The order that settled it, so the form can say which one did.
            'zohoCurrencyPo' => app(\App\Services\P2p\VendorCurrencyGuard::class)
                ->settledByPo((int) $v->client_id, (int) $v->id),
            /* The currencies Zoho Books actually has enabled. A PO in any other
               cannot reach the books — SGD was offered here for months, was not
               enabled there, and its orders posted as rupees without a word.
               Empty when Zoho is unreachable, and the form falls back to ours. */
            'zohoCurrencies' => app(\App\Services\ZohoBooksService::class)->enabledCurrencies(),
        ]]);
    }

    /* ══════════════════════════ SHIPMENT DROPDOWN + PI PRODUCTS ══════════════════════════ */

    /** Shipments (With Shipment ID dropdown): shipment code + customer + linked PI/opportunity. */
    public function shipments(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = ShipmentOrder::query()->with(['lead.customer', 'lead.consignee', 'proformaInvoice'])->orderByDesc('id');
        $this->applyScope($q, $user, $request->integer('branch_id') ?: null);

        $rows = $q->get()->map(function ($s) {
            $lead = $s->lead;
            return [
                'id' => $s->id,
                'code' => $s->shipment_code,
                'customer' => $lead && $lead->customer ? $lead->customer->company_name : null,
                'consignee' => $lead && $lead->consignee ? $lead->consignee->company_name : null,
                'opportunity_id' => $s->lead_id,
                'opportunity_code' => $lead->opp_code ?? null,
                'proforma_invoice_id' => $s->proforma_invoice_id,
                'pi_number' => optional($s->proformaInvoice)->code,
            ];
        });
        return response()->json(['status' => true, 'data' => $rows]);
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
