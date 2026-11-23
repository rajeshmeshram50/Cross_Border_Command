<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Lead;
use App\Models\Masters\Incoterms;
use App\Models\Product;
use App\Models\ProformaInvoice;
use App\Models\ShipmentOrder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

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
            'zip_code'            => 'nullable|string|max:12|regex:/^[A-Za-z0-9\s\-]+$/',
            'freight_cost'        => 'nullable|numeric|gt:0',
            'shipping_mode'       => 'nullable|string|max:64',
            'inco_term'           => 'nullable|string|max:100',
            'inco_term_id'        => 'nullable|integer|exists:master_incoterms,id',
            'port_of_loading'     => 'nullable|string|max:128',
            'port_of_unloading'   => 'nullable|string|max:128',
            'final_destination'   => 'nullable|string|max:128',
            'origin_country'      => 'nullable|string|max:64',

            'pin_code'            => 'nullable|string|max:12|regex:/^\d{6}$/',
            'shipping_cost'       => 'nullable|numeric|gt:0',
            'place_of_dispatch'   => 'nullable|string|max:128',
            'place_of_delivery'   => 'nullable|string|max:128',

            'attachments'         => 'nullable|array|max:1',
            'attachments.*'       => 'file|mimes:jpg,jpeg,png,webp,pdf,doc,docx|max:2048',
            'remarks'             => 'nullable|string|max:20000',
        ]);

        $belongs = Lead::where('id', $data['lead_id'])->where('client_id', $user->client_id)->exists();
        if (!$belongs) {
            return response()->json(['status' => false, 'message' => 'Lead not in your tenant'], 403);
        }

        if (!empty($data['inco_term_id']) && !$this->incoTermInTenant($data['inco_term_id'], $user->client_id)) {
            return response()->json(['status' => false, 'message' => 'INCO term not in your tenant'], 403);
        }

        if (ShipmentOrder::where('lead_id', $data['lead_id'])->exists()) {
            return response()->json([
                'status'  => false,
                'message' => 'This opportunity already has a shipment order. Edit it instead of creating a new one.',
            ], 409);
        }

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
            $branchId = Lead::where('id', $data['lead_id'])->value('branch_id') ?? $user->branch_id;
            $domestic = $this->isDomesticShipment(
                $data['proforma_invoice_id'] ?? null,
                $data['lead_id'] ?? null,
            );

            $shipment = DB::transaction(function () use ($user, $branchId, $data, $paths, $domestic) {
                DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();

                $attrs = [
                    'client_id'           => $user->client_id,
                    'branch_id'           => $branchId,
                    'shipment_code'       => $this->nextShipmentCode($user->client_id, $branchId, $domestic),
                    'lead_id'             => $data['lead_id'],
                    'proforma_invoice_id' => $data['proforma_invoice_id']  ?? null,
                    'shipping_liability'  => $data['shipping_liability']   ?? null,
                    'cold_chain'          => (bool) ($data['cold_chain']   ?? false),
                    'shipping_mode'       => $data['shipping_mode']        ?? null,
                    'attachments'         => $paths ?: null,
                    'remarks'             => $data['remarks']              ?? null,
                    'created_by'          => $user->id,
                ];

                if ($domestic) {
                    $attrs += [
                        'pin_code'          => $data['pin_code']          ?? null,
                        'shipping_cost'     => $data['shipping_cost']     ?? null,
                        'place_of_dispatch' => $data['place_of_dispatch'] ?? null,
                        'place_of_delivery' => $data['place_of_delivery'] ?? null,
                    ];
                } else {
                    $attrs += [
                        'zip_code'          => $data['zip_code']          ?? null,
                        'freight_cost'      => $data['freight_cost']      ?? null,
                        'inco_term'         => $data['inco_term']         ?? null,
                        'inco_term_id'      => $data['inco_term_id']      ?? null,
                        'port_of_loading'   => $data['port_of_loading']   ?? null,
                        'port_of_unloading' => $data['port_of_unloading'] ?? null,
                        'final_destination' => $data['final_destination'] ?? null,
                        'origin_country'    => $data['origin_country']    ?? null,
                    ];
                }

                return ShipmentOrder::create($attrs);
            });
        } catch (\Illuminate\Database\UniqueConstraintViolationException $e) {
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

    private function incoTermInTenant(int $incoTermId, int $clientId): bool
    {
        return Incoterms::where('id', $incoTermId)
            ->where(fn ($q) => $q->whereNull('client_id')->orWhere('client_id', $clientId))
            ->exists();
    }

    private function shipmentPrefix(bool $domestic): string
    {
        return $domestic ? 'DSHP-' : 'SHP-';
    }

    private function isDomesticShipment(?int $proformaInvoiceId, ?int $leadId): bool
    {
        $docType = null;
        if ($proformaInvoiceId) {
            $docType = ProformaInvoice::where('id', $proformaInvoiceId)->value('doc_type');
        }
        if ($docType === null && $leadId) {
            $docType = ProformaInvoice::where('opp_id', $leadId)
                ->orderByDesc('id')
                ->value('doc_type');
        }
        return strtolower(trim((string) $docType)) === 'domestic';
    }

    private function nextShipmentCode(int $clientId, ?int $branchId, bool $domestic = false): string
    {
        $prefix = $this->shipmentPrefix($domestic);

        $row = ShipmentOrder::query()
            ->where('client_id', $clientId)
            ->when($branchId !== null, fn ($q) => $q->where('branch_id', $branchId))
            ->when($branchId === null, fn ($q) => $q->whereNull('branch_id'))
            ->where('shipment_code', 'like', $prefix . '%')
            ->selectRaw("
                COALESCE(MAX(CAST(NULLIF(regexp_replace(COALESCE(shipment_code, ''), '\\D', '', 'g'), '') AS INTEGER)), 0) AS max_code
            ")
            ->first();

        $next = (int) ($row->max_code ?? 0) + 1;
        return $prefix . str_pad((string) $next, 3, '0', STR_PAD_LEFT);
    }

    public function nextCode(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No client tenant on user'], 422);
        }
        $branchId = $request->integer('lead_id')
            ? (Lead::where('id', $request->integer('lead_id'))->value('branch_id') ?? $user->branch_id)
            : $user->branch_id;
        $domestic = $this->isDomesticShipment(
            $request->integer('proforma_invoice_id') ?: null,
            $request->integer('lead_id') ?: null,
        );
        return response()->json([
            'status' => true,
            'code'   => $this->nextShipmentCode($user->client_id, $branchId, $domestic),
        ]);
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
            'incoterm:id,code,full_name',
        ])
            ->where('client_id', $user->client_id)
            ->findOrFail($id);

        $row->inco_term = $row->incoTermLabel();
        $this->attachAttachmentUrls($row);

        return response()->json(['status' => true, 'data' => $row]);
    }

    private function attachAttachmentUrls(ShipmentOrder $row): void
    {
        $paths = is_array($row->attachments) ? $row->attachments : [];
        $row->setAttribute('attachments_url', array_map(fn ($p) => file_url($p), $paths));
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
            'incoterm:id,code,full_name',
        ])
            ->where('client_id', $user->client_id)
            ->where('lead_id', $leadId)
            ->first();

        if ($row) {
            $row->inco_term = $row->incoTermLabel();
            $this->attachAttachmentUrls($row);
        }

        return response()->json(['status' => true, 'data' => $row]);
    }

    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No client tenant on user'], 422);
        }

        $rows = ShipmentOrder::with([
            'lead:id,opp_code,query_time,customer_id,consignee_id',
            'lead.customer:id,company_name,customer_code',
            'lead.consignee:id,company_name,consignee_code',
            'proformaInvoice:id,code,created_at,doc_type',
            'proformaInvoice.items:id,proforma_invoice_id,product_id',
            'incoterm:id,code,full_name',
        ])
            ->where('client_id', $user->client_id)
            ->orderByDesc('id')
            ->get();

        $productIds = $rows
            ->flatMap(fn ($s) => $s->proformaInvoice?->items?->pluck('product_id') ?? collect())
            ->filter()
            ->unique()
            ->values();

        $hazProductIds = $productIds->isEmpty()
            ? collect()
            : Product::where('client_id', $user->client_id)
                ->whereIn('id', $productIds)
                ->whereRaw('LOWER(TRIM(haz_type)) = ?', ['haz'])
                ->pluck('id')
                ->flip();

        $hazByPi = [];
        foreach ($rows as $s) {
            $pi = $s->proformaInvoice;
            if (!$pi) continue;
            $ids = $pi->items->pluck('product_id')->filter();
            $hazByPi[$pi->id] = $ids->isEmpty() ? null : $ids->contains(fn ($id) => $hazProductIds->has($id));
        }

        $rows = $rows
            ->map(function ($s) use ($hazByPi) {
                $domestic = strtolower(trim((string) $s->proformaInvoice?->doc_type)) === 'domestic';
                return [
                    'id'                 => $s->id,
                    'shipment_code'      => $s->shipment_code,
                    'created_at'         => $s->created_at,
                    'opp_code'           => $s->lead?->opp_code,
                    'opp_date'           => $s->lead?->query_time,
                    'customer_name'      => $s->lead?->customer?->company_name,
                    'consignee_name'     => $s->lead?->consignee?->company_name,
                    'pi_no'              => $s->proformaInvoice?->code,
                    'pi_date'            => $s->proformaInvoice?->created_at,
                    'shipping_liability' => $s->shipping_liability,
                    'cold_chain'         => (bool) $s->cold_chain,
                    'hazardous'          => $s->proformaInvoice
                        ? ($hazByPi[$s->proformaInvoice->id] ?? null)
                        : null,
                    'shipping_mode'      => $s->shipping_mode,
                    'doc_type'           => $domestic ? 'Domestic' : 'International',
                    'is_domestic'        => $domestic,
                    'inco_term'          => $s->incoTermLabel(),
                    'inco_term_id'       => $s->inco_term_id,
                    'port_of_loading'    => $s->port_of_loading,
                    'port_of_unloading'  => $s->port_of_unloading,
                    'freight_cost'       => $s->freight_cost,
                    'zip_code'           => $s->zip_code,
                    'place_of_dispatch'  => $s->place_of_dispatch,
                    'place_of_delivery'  => $s->place_of_delivery,
                    'shipping_cost'      => $s->shipping_cost,
                    'pin_code'           => $s->pin_code,
                ];
            });

        return response()->json(['status' => true, 'data' => $rows]);
    }

    public function update(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $row = ShipmentOrder::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'shipping_liability'  => 'nullable|string|max:64',
            'cold_chain'          => 'nullable|boolean',
            'zip_code'            => 'nullable|string|max:12|regex:/^[A-Za-z0-9\s\-]+$/',
            'freight_cost'        => 'nullable|numeric|gt:0',
            'shipping_mode'       => 'nullable|string|max:64',
            'inco_term'           => 'nullable|string|max:100',
            'inco_term_id'        => 'nullable|integer|exists:master_incoterms,id',
            'port_of_loading'     => 'nullable|string|max:128',
            'port_of_unloading'   => 'nullable|string|max:128',
            'final_destination'   => 'nullable|string|max:128',
            'origin_country'      => 'nullable|string|max:64',
            'pin_code'            => 'nullable|string|max:12|regex:/^\d{6}$/',
            'shipping_cost'       => 'nullable|numeric|gt:0',
            'place_of_dispatch'   => 'nullable|string|max:128',
            'place_of_delivery'   => 'nullable|string|max:128',
            'attachments'         => 'nullable|array|max:1',
            'attachments.*'       => 'file|mimes:jpg,jpeg,png,webp,pdf,doc,docx|max:2048',
            'remarks'             => 'nullable|string|max:20000',
        ]);

        if (!empty($data['inco_term_id']) && !$this->incoTermInTenant($data['inco_term_id'], $user->client_id)) {
            return response()->json(['status' => false, 'message' => 'INCO term not in your tenant'], 403);
        }

        $domesticRow  = $this->isDomesticShipment($row->proforma_invoice_id, $row->lead_id);
        $exportOnly   = ['zip_code', 'freight_cost', 'inco_term', 'inco_term_id', 'port_of_loading',
                         'port_of_unloading', 'final_destination', 'origin_country'];
        $domesticOnly = ['pin_code', 'shipping_cost', 'place_of_dispatch', 'place_of_delivery'];
        foreach ($domesticRow ? $exportOnly : $domesticOnly as $k) {
            unset($data[$k]);
        }

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
