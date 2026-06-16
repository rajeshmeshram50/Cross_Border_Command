<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Lead;
use App\Models\ProformaInvoice;
use App\Models\ShipmentOrder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;


class ShipmentOrderController extends Controller
{
    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No client tenant on user'], 422);
        }

        $data = $request->validate([
            'lead_id'             => 'required|integer|exists:leads,id',
            'proforma_invoice_id' => 'nullable|integer|exists:proforma_invoices,id',
            'shipping_liability'  => 'nullable|string|max:64',
            // B18: explicit boolean validation so payloads like
            // cold_chain='invalid' don't silently truecast to true via
            // (bool) inside the create() call below.
            'cold_chain'          => 'nullable|boolean',
            // B15: real postal codes are at most ~10 chars + a hyphen.
            // Regex permits letters (UK, CA), digits, dashes and spaces.
            'zip_code'            => 'nullable|string|max:12|regex:/^[A-Za-z0-9\s\-]+$/',
            // B14: freight_cost of 0 makes no business sense — a real
            // shipment always has a non-zero cost. nullable still allowed
            // for early drafts that haven't priced freight yet.
            'freight_cost'        => 'nullable|numeric|gt:0',
            'shipping_mode'       => 'nullable|string|max:64',
            'inco_term'           => 'nullable|string|max:100',
            // B17: port_of_loading is required — a shipment without an
            // origin port is operationally meaningless and breaks the
            // logistics handoff (carriers ask for it first).
            'port_of_loading'     => 'required|string|max:128',
            'port_of_unloading'   => 'nullable|string|max:128',
            'final_destination'   => 'nullable|string|max:128',
            // origin_country accepts either a full name (e.g. "India") or
            // an ISO code — the field is free-text on the frontend so the
            // strict ISO-2 rule blocked perfectly valid input. Carriers
            // receive a downstream normalisation step elsewhere.
            'origin_country'      => 'nullable|string|max:64',
            'attachments'         => 'nullable|array',
            'attachments.*'       => 'file|mimes:jpg,jpeg,png,webp,pdf,doc,docx|max:5120',
            'remarks'             => 'nullable|string|max:2000',
        ]);

        // Tenant gate — lead must belong to caller's client.
        $belongs = Lead::where('id', $data['lead_id'])->where('client_id', $user->client_id)->exists();
        if (!$belongs) {
            return response()->json(['status' => false, 'message' => 'Lead not in your tenant'], 403);
        }

        // One-shipment-per-opportunity gate. The exists() check below is
        // not atomic — two concurrent POSTs can both pass it before either
        // INSERT lands. The DB unique constraint on (lead_id) catches the
        // second insert and raises a UniqueConstraintViolationException,
        // which we map to a friendly 409 below instead of bubbling a 500.
        if (ShipmentOrder::where('lead_id', $data['lead_id'])->exists()) {
            return response()->json([
                'status'  => false,
                'message' => 'This opportunity already has a shipment order. Edit it instead of creating a new one.',
            ], 409);
        }

        // Tenant-scope the PI if provided.
        if (!empty($data['proforma_invoice_id'])) {
            $piBelongs = ProformaInvoice::where('id', $data['proforma_invoice_id'])
                ->where('client_id', $user->client_id)->exists();
            if (!$piBelongs) {
                return response()->json(['status' => false, 'message' => 'PI not in your tenant'], 403);
            }
        }

        $paths = [];
        foreach ((array) $request->file('attachments') as $file) {
            $paths[] = $file->storeAs(
                'shipment_orders',
                time() . '_' . preg_replace('/[^A-Za-z0-9._-]/', '_', $file->getClientOriginalName()),
                'public',
            );
        }

        try {
            $shipment = ShipmentOrder::create([
                'client_id'           => $user->client_id,
                'shipment_code'       => $this->nextShipmentCode($user->client_id),
                'lead_id'             => $data['lead_id'],
                'proforma_invoice_id' => $data['proforma_invoice_id']  ?? null,
                'shipping_liability'  => $data['shipping_liability']   ?? null,
                'cold_chain'          => (bool) ($data['cold_chain']   ?? false),
                'zip_code'            => $data['zip_code']             ?? null,
                'freight_cost'        => $data['freight_cost']         ?? null,
                'shipping_mode'       => $data['shipping_mode']        ?? null,
                'inco_term'           => $data['inco_term']            ?? null,
                'port_of_loading'     => $data['port_of_loading']      ?? null,
                'port_of_unloading'   => $data['port_of_unloading']    ?? null,
                'final_destination'   => $data['final_destination']    ?? null,
                'origin_country'      => $data['origin_country']       ?? null,
                'attachments'         => $paths ?: null,
                'remarks'             => $data['remarks']              ?? null,
                'created_by'          => $user->id,
            ]);
        } catch (\Illuminate\Database\UniqueConstraintViolationException $e) {
            // B21: covers the race where two concurrent POSTs both pass
            // the exists() pre-check above. Returning 409 keeps the
            // client UX consistent regardless of which path tripped.
            return response()->json([
                'status'  => false,
                'message' => 'This opportunity already has a shipment order. Edit it instead of creating a new one.',
            ], 409);
        }

        return response()->json([
            'status' => true,
            'data'   => $shipment->load(['proformaInvoice:id,code', 'creator:id,name']),
        ], 201);
    }

    /**
     * Next per-client sequential Shipment ID — SHP-001, SHP-002, … Derives the
     * highest existing numeric suffix for the tenant and adds one. Postgres
     * `regexp_replace` strips non-digits so legacy/odd codes don't break it.
     */
    private function nextShipmentCode(int $clientId): string
    {
        // Take the GREATER of (highest existing code number) and (row count) so
        // legacy rows with a NULL shipment_code (created before the column
        // existed) are still counted — e.g. 2 un-coded rows ⇒ next is SHP-003.
        $row = ShipmentOrder::query()
            ->where('client_id', $clientId)
            ->selectRaw("
                COALESCE(MAX(CAST(NULLIF(regexp_replace(COALESCE(shipment_code, ''), '\\D', '', 'g'), '') AS INTEGER)), 0) AS max_code,
                COUNT(*) AS cnt
            ")
            ->first();

        $next = max((int) ($row->max_code ?? 0), (int) ($row->cnt ?? 0)) + 1;
        return 'SHP-' . str_pad((string) $next, 3, '0', STR_PAD_LEFT);
    }

    /** GET /sales/shipment-orders/next-code — preview the next Shipment ID for
     *  the create form's header (the actual code is allocated on store). */
    public function nextCode(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No client tenant on user'], 422);
        }
        return response()->json(['status' => true, 'code' => $this->nextShipmentCode($user->client_id)]);
    }

    public function show(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $row = ShipmentOrder::with([
            'lead:id,opp_code,unique_query_id,query_time,sender_country_iso,customer_id,consignee_id',
            'lead.customer:id,company_name,customer_code',
            'lead.consignee:id,company_name,consignee_code',
            'proformaInvoice:id,code,created_at,opp_id,grand_total,currency',
            'creator:id,name',
        ])
            ->where('client_id', $user->client_id)
            ->findOrFail($id);

        return response()->json(['status' => true, 'data' => $row]);
    }

    public function getByLead(Request $request, int $leadId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $row = ShipmentOrder::with([
            'lead:id,opp_code,unique_query_id,query_time,sender_country_iso,customer_id,consignee_id',
            'lead.customer:id,company_name,customer_code',
            'lead.consignee:id,company_name,consignee_code',
            'proformaInvoice:id,code,created_at,opp_id,grand_total,currency',
            'creator:id,name',
        ])
            ->where('client_id', $user->client_id)
            ->where('lead_id', $leadId)
            ->first();

        return response()->json(['status' => true, 'data' => $row]);
    }

    public function update(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $row = ShipmentOrder::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'shipping_liability'  => 'nullable|string|max:64',
            'cold_chain'          => 'nullable|boolean',
            // Same B14/B15/B16/B17/B18 fixes as in store() — keep validators
            // symmetrical so update() can't accept what store() rejects.
            'zip_code'            => 'nullable|string|max:12|regex:/^[A-Za-z0-9\s\-]+$/',
            'freight_cost'        => 'nullable|numeric|gt:0',
            'shipping_mode'       => 'nullable|string|max:64',
            'inco_term'           => 'nullable|string|max:100',
            'port_of_loading'     => 'sometimes|required|string|max:128',
            'port_of_unloading'   => 'nullable|string|max:128',
            'final_destination'   => 'nullable|string|max:128',
            'origin_country'      => 'nullable|string|max:64',
            'attachments'         => 'nullable|array',
            'attachments.*'       => 'file|mimes:jpg,jpeg,png,webp,pdf,doc,docx|max:5120',
            'remarks'             => 'nullable|string|max:2000',
        ]);

        
        if ($request->hasFile('attachments')) {
            $existing = (array) ($row->attachments ?? []);
            foreach ((array) $request->file('attachments') as $file) {
                $existing[] = $file->storeAs(
                    'shipment_orders',
                    time() . '_' . preg_replace('/[^A-Za-z0-9._-]/', '_', $file->getClientOriginalName()),
                    'public',
                );
            }
            $data['attachments'] = $existing;
        } else {
            unset($data['attachments']);
        }

        $row->update($data);

        return response()->json([
            'status' => true,
            'data'   => $row->fresh(['proformaInvoice:id,code', 'creator:id,name']),
        ]);
    }
}
