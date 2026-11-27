<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Lead;
use App\Models\LeadProduct;
use App\Models\Procurement;
use App\Models\ProcurementProduct;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ProcurementController extends Controller
{
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
            'attachments.*'                 => 'file|magic_mime:jpg,jpeg,png,webp,pdf|max:5120',
            'products'                      => 'required|array|min:1',
            'products.*.product_id'         => 'required|integer|exists:products,id',
            'products.*.lead_product_id'    => 'nullable|integer|exists:lead_products,id',
            'products.*.vendor_id'          => 'nullable|integer|exists:vendors,id',
            'products.*.qty'                => 'nullable|numeric|gt:0',
            'products.*.target_price'       => 'nullable|numeric|gt:0',
            'products.*.attachment'         => 'nullable|array',
            'products.*.attachment.*'       => 'file|magic_mime:jpg,jpeg,png,webp,pdf|max:5120',
        ]);

        if (!empty($data['lead_id'])) {
            $belongs = Lead::where('id', $data['lead_id'])->where('client_id', $user->client_id)->exists();
            if (!$belongs) {
                return response()->json(['status' => false, 'message' => 'Lead not in your tenant'], 403);
            }
        }

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

        $vendorIds = array_values(array_unique(array_filter(array_column($data['products'], 'vendor_id'))));
        if (!empty($vendorIds)) {
            $own = \App\Models\Vendor::whereIn('id', $vendorIds)->where('client_id', $user->client_id)->count();
            if ($own !== count($vendorIds)) {
                return response()->json([
                    'status'  => false,
                    'message' => 'One or more selected suppliers are not in your tenant',
                ], 403);
            }
        }

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

            $soleVendor = DB::table('vendor_product_mappings as vpm')
                ->join('vendors as v', 'v.id', '=', 'vpm.vendor_id')
                ->where('v.client_id', $user->client_id)
                ->whereNull('vpm.deleted_at')
                ->whereIn('vpm.product_id', array_column($data['products'], 'product_id'))
                ->groupBy('vpm.product_id')
                ->select('vpm.product_id', DB::raw('count(distinct vpm.vendor_id) as c'), DB::raw('min(vpm.vendor_id) as vendor_id'))
                ->get()
                ->mapWithKeys(fn ($r) => [(int) $r->product_id => ((int) $r->c === 1 ? (int) $r->vendor_id : null)]);

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
                    'vendor_id'       => $p['vendor_id'] ?? ($soleVendor[(int) $p['product_id']] ?? null),
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

        $vendorCount = \App\Models\ProductVendorMap::whereIn(
            'product_id',
            $proc->products->pluck('product_id')->filter()->unique()->values()
        )->count();

        $data = $proc->toArray();
        $data['vendor_count'] = (int) $vendorCount;

        return response()->json(['status' => true, 'data' => $data]);
    }

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
