<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Lead;
use App\Models\ProformaInvoice;
use App\Models\ShipmentOrder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
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
            // Shipment IDs are sequenced per BRANCH. Use the opportunity's
            // branch (falling back to the creator's branch when the lead has
            // none) so the counter is scoped correctly.
            $branchId = Lead::where('id', $data['lead_id'])->value('branch_id') ?? $user->branch_id;
            // Allocate the code + insert inside a transaction that locks the
            // client row, so two concurrent saves can't read the same MAX and
            // collide or skip a number (mirrors Quotation/PI — CLAUDE rule #3).
            // This is what keeps the sequence gap-free and deterministic, so the
            // create-form preview and the saved code agree.
            $shipment = DB::transaction(function () use ($user, $branchId, $data, $paths) {
                DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
                return ShipmentOrder::create([
                'client_id'           => $user->client_id,
                'branch_id'           => $branchId,
                'shipment_code'       => $this->nextShipmentCode($user->client_id, $branchId),
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
            });
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
     * Next per-BRANCH sequential Shipment ID — SHP-001, SHP-002, … Derives the
     * highest existing numeric suffix for the branch and adds one. Postgres
     * `regexp_replace` strips non-digits so legacy/odd codes don't break it.
     * Each branch keeps its own SHP sequence (scoped within the client tenant).
     *
     * Purely `highest_code + 1` — deterministic and gap-free going forward.
     * (The old `max(highest_code, row_count)` term made the number jump ahead
     * whenever the branch had uncoded/legacy rows, so the create-form preview
     * and the saved code disagreed. `highest_code + 1` is always above every
     * existing code, so it can never collide.)
     */
    private function nextShipmentCode(int $clientId, ?int $branchId): string
    {
        $row = ShipmentOrder::query()
            ->where('client_id', $clientId)
            ->when($branchId !== null, fn ($q) => $q->where('branch_id', $branchId))
            ->when($branchId === null, fn ($q) => $q->whereNull('branch_id'))
            ->selectRaw("
                COALESCE(MAX(CAST(NULLIF(regexp_replace(COALESCE(shipment_code, ''), '\\D', '', 'g'), '') AS INTEGER)), 0) AS max_code
            ")
            ->first();

        $next = (int) ($row->max_code ?? 0) + 1;
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
        // Preview against the lead's branch when known (matches what store()
        // allocates), else the creator's branch.
        $branchId = $request->integer('lead_id')
            ? (Lead::where('id', $request->integer('lead_id'))->value('branch_id') ?? $user->branch_id)
            : $user->branch_id;
        return response()->json(['status' => true, 'code' => $this->nextShipmentCode($user->client_id, $branchId)]);
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

    /**
     * Business Task list — every shipment order for the tenant, newest first,
     * with the relations the table needs (opportunity owner, customer,
     * consignee, PI). Powers the Developers → Shipment page.
     */
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No client tenant on user'], 422);
        }

        $rows = ShipmentOrder::with([
            'lead:id,opp_code,query_time,salesperson_id,customer_id,consignee_id',
            'lead.salesperson:id,name',
            'lead.customer:id,company_name,customer_code',
            'lead.consignee:id,company_name,consignee_code',
            'proformaInvoice:id,code,created_at',
            'creator:id,name',
        ])
            ->where('client_id', $user->client_id)
            ->orderByDesc('id')
            ->get()
            ->map(function ($s) {
                return [
                    'id'                 => $s->id,
                    'shipment_code'      => $s->shipment_code,
                    'created_at'         => $s->created_at,
                    'owner_name'         => $s->lead?->salesperson?->name ?? $s->creator?->name ?? null,
                    'opp_code'           => $s->lead?->opp_code,
                    'opp_date'           => $s->lead?->query_time,
                    'customer_name'      => $s->lead?->customer?->company_name,
                    'consignee_name'     => $s->lead?->consignee?->company_name,
                    'pi_no'              => $s->proformaInvoice?->code,
                    'pi_date'            => $s->proformaInvoice?->created_at,
                    'shipping_liability' => $s->shipping_liability,
                    'cold_chain'         => (bool) $s->cold_chain,
                    'inco_term'          => $s->inco_term,
                    'port_of_loading'    => $s->port_of_loading,
                    'port_of_unloading'  => $s->port_of_unloading,
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
