<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Lead;
use App\Models\LeadProduct;
use App\Models\Procurement;
use App\Models\ProcurementProduct;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;


class ProcurementController extends Controller
{
    /* ─────────────────────────────────────────────────────────────────
     *  POST /procurements
     *
     *  Multipart body shape (mirrors IDIMS):
     *    lead_id              (nullable, exists:leads,id)
     *    procurement_date     (nullable, date)
     *    assign_id            (nullable, exists:users,id)
     *    status               (nullable, in:inprogress,done)
     *    attachments[]        (file)
     *    products[]
     *      [n][product_id]         required, exists:products,id
     *      [n][lead_product_id]    nullable, exists:lead_products,id
     *      [n][qty]                nullable, numeric ≥0
     *      [n][target_price]       nullable, numeric ≥0
     *      [n][attachment][]       file
     * ───────────────────────────────────────────────────────────────── */
    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No client tenant on user'], 422);
        }

        $data = $request->validate([
            'lead_id'                       => 'nullable|integer|exists:leads,id',
            'procurement_date'              => 'nullable|date',
            'assign_id'                     => 'nullable|integer|exists:users,id',
            'status'                        => 'nullable|in:inprogress,done',
            'notes'                         => 'nullable|string|max:2000',
            'attachments'                   => 'nullable|array',
            // B36: magic_mime checks the actual file signature, NOT the
            // client-supplied Content-Type (which a forged upload can lie
            // about). See AppServiceProvider for the rule definition.
            'attachments.*'                 => 'file|magic_mime:jpg,jpeg,png,webp,pdf|max:5120',
            'products'                      => 'required|array|min:1',
            'products.*.product_id'         => 'required|integer|exists:products,id',
            'products.*.lead_product_id'    => 'nullable|integer|exists:lead_products,id',
            // B10/B11: zero qty / zero target_price are nonsensical for
            // procurement (you can't "buy 0 units" or "buy at ₹0"). The
            // earlier `min:0` permitted them. Use `gt:0` so an explicit
            // null is the only way to leave the field blank.
            'products.*.qty'                => 'nullable|numeric|gt:0',
            'products.*.target_price'       => 'nullable|numeric|gt:0',
            'products.*.attachment'         => 'nullable|array',
            'products.*.attachment.*'       => 'file|magic_mime:jpg,jpeg,png,webp,pdf|max:5120',
        ]);

        // Tenant gate — if a lead is provided it must belong to the same client.
        if (!empty($data['lead_id'])) {
            $belongs = Lead::where('id', $data['lead_id'])->where('client_id', $user->client_id)->exists();
            if (!$belongs) {
                return response()->json(['status' => false, 'message' => 'Lead not in your tenant'], 403);
            }
        }

        // Cross-lead integrity: every products[].lead_product_id must belong
        // to the same lead as the procurement. Without this, a salesperson
        // could create a procurement that says "lead 144" but stitches in
        // lead_product rows from lead 200, scrambling the Stage 3 view.
        $lpIds = array_filter(array_column($data['products'], 'lead_product_id'));
        if (!empty($lpIds)) {
            if (empty($data['lead_id'])) {
                return response()->json([
                    'status'  => false,
                    'message' => 'lead_id is required when products reference lead_product_id',
                ], 422);
            }
            $mismatch = LeadProduct::whereIn('id', $lpIds)
                ->where('lead_id', '!=', $data['lead_id'])
                ->exists();
            if ($mismatch) {
                return response()->json([
                    'status'  => false,
                    'message' => 'One or more products reference a lead_product belonging to a different lead',
                ], 422);
            }
        }

        // Procurement-level attachments.
        $procAttachments = [];
        foreach ((array) $request->file('attachments') as $file) {
            $procAttachments[] = $file->storeAs(
                'procurements',
                time() . '_' . preg_replace('/[^A-Za-z0-9._-]/', '_', $file->getClientOriginalName()),
                'public',
            );
        }

        return DB::transaction(function () use ($user, $data, $procAttachments, $request) {
            $procurement = Procurement::create([
                'client_id'        => $user->client_id,
                'lead_id'          => $data['lead_id']          ?? null,
                'procurement_date' => $data['procurement_date'] ?? null,
                'assign_id'        => $data['assign_id']        ?? null,
                'status'           => $data['status']           ?? 'inprogress',
                'attachments'      => $procAttachments ?: null,
                'notes'            => $data['notes']            ?? null,
                'created_by'       => $user->id,
            ]);

            foreach ($data['products'] as $idx => $p) {
                $pAttachments = [];
                foreach ((array) $request->file("products.$idx.attachment") as $pFile) {
                    $pAttachments[] = $pFile->storeAs(
                        'procurements/products',
                        time() . '_' . preg_replace('/[^A-Za-z0-9._-]/', '_', $pFile->getClientOriginalName()),
                        'public',
                    );
                }

                ProcurementProduct::create([
                    'procurement_id'  => $procurement->id,
                    'lead_product_id' => $p['lead_product_id'] ?? null,
                    'product_id'      => $p['product_id'],
                    'qty'             => $p['qty']             ?? null,
                    'target_price'    => $p['target_price']    ?? null,
                    'attachments'     => $pAttachments ?: null,
                ]);
            }

            return response()->json([
                'status' => true,
                'data'   => $procurement->load(['products.product:id,product_code,name', 'assignee:id,name']),
            ], 201);
        });
    }

    /* ─────────────────────────────────────────────────────────────────
     *  GET /procurements?lead_id=...&status=...
     * ───────────────────────────────────────────────────────────────── */
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = Procurement::query()
            ->with(['assignee:id,name', 'products.product:id,product_code,name,status'])
            ->where('client_id', $user->client_id)
            ->orderByDesc('id');

        if ($request->filled('lead_id'))  $q->where('lead_id', $request->integer('lead_id'));
        if ($request->filled('status'))   $q->where('status', $request->string('status'));

        return response()->json(['status' => true, 'data' => $q->get()]);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  GET /procurements/{id}
     * ───────────────────────────────────────────────────────────────── */
    public function show(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $proc = Procurement::with([
            'assignee:id,name',
            'creator:id,name',
            'lead:id,opp_code,unique_query_id,query_time,created_at',
            'products.product:id,product_code,name,status',
            'products.leadProduct:id,quantity,target_price,currency',
        ])
            ->where('client_id', $user->client_id)
            ->findOrFail($id);

        // Vendor count across the procurement's products (product_vendor_maps)
        // — shown in the Procurement Details modal's "Vendor Count" row.
        $vendorCount = \App\Models\ProductVendorMap::whereIn(
            'product_id',
            $proc->products->pluck('product_id')->filter()->unique()->values()
        )->count();

        $data = $proc->toArray();
        $data['vendor_count'] = (int) $vendorCount;

        return response()->json(['status' => true, 'data' => $data]);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  GET /procurements/next-number
     *
     *  Tenant-scoped — each client gets its own PROC-### sequence based
     *  on the count of rows for that client. Approximate (race-prone
     *  during burst create) but matches IDIMS's "preview only" intent.
     * ───────────────────────────────────────────────────────────────── */
    public function nextNumber(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $next = Procurement::where('client_id', $user->client_id)->max('id');
        $next = ($next ?? 0) + 1;

        return response()->json(['status' => true, 'data' => [
            'next_id'   => $next,
            'next_code' => 'PROC-' . str_pad((string) $next, 3, '0', STR_PAD_LEFT),
        ]]);
    }
}
