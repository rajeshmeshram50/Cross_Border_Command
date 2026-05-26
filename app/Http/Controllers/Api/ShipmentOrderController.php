<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Lead;
use App\Models\ProformaInvoice;
use App\Models\ShipmentOrder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * Sales Matrix → Stage 6 (Victory) → Shipment Order.
 *
 *  Ported from IDIMS's Business Task (BT) controller. Captures the
 *  shipping + logistics block that operations needs once a deal is won.
 *
 *  POST  /sales/shipment-orders                   create (multipart)
 *  GET   /sales/shipment-orders/{id}              show
 *  GET   /sales/leads/{leadId}/shipment-order     by lead (Stage 6 feed)
 *  POST  /sales/shipment-orders/{id}              update (multipart)
 */
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
            'cold_chain'          => 'nullable|boolean',
            'zip_code'            => 'nullable|string|max:32',
            'freight_cost'        => 'nullable|numeric|min:0',
            'shipping_mode'       => 'nullable|string|max:64',
            'inco_term'           => 'nullable|string|max:32',
            'port_of_loading'     => 'nullable|string|max:128',
            'port_of_unloading'   => 'nullable|string|max:128',
            'final_destination'   => 'nullable|string|max:128',
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

        // One-shipment-per-opportunity gate.
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

        $shipment = ShipmentOrder::create([
            'client_id'           => $user->client_id,
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

        return response()->json([
            'status' => true,
            'data'   => $shipment->load(['proformaInvoice:id,code', 'creator:id,name']),
        ], 201);
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
            'zip_code'            => 'nullable|string|max:32',
            'freight_cost'        => 'nullable|numeric|min:0',
            'shipping_mode'       => 'nullable|string|max:64',
            'inco_term'           => 'nullable|string|max:32',
            'port_of_loading'     => 'nullable|string|max:128',
            'port_of_unloading'   => 'nullable|string|max:128',
            'final_destination'   => 'nullable|string|max:128',
            'origin_country'      => 'nullable|string|max:64',
            'attachments'         => 'nullable|array',
            'attachments.*'       => 'file|mimes:jpg,jpeg,png,webp,pdf,doc,docx|max:5120',
            'remarks'             => 'nullable|string|max:2000',
        ]);

        // Append new attachments to existing list rather than replacing —
        // preserves history of uploaded shipping documents.
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
