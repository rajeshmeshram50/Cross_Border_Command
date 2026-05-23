<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmSegment;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;

/**
 * Central CLM → Segment master CRUD.
 *
 * Tenant-scoped via $user->client_id (mirrors LeadAckReasonController).
 * super_admin without a client_id gets an empty list — the module hides
 * for them at the sidebar level, but the endpoints stay consistent
 * instead of 403'ing.
 *
 * The `code` field follows S-001 / S-002 / … sequence per client. It's
 * allocated inside a row-lock on the parent client row at insert time so
 * two concurrent POSTs don't end up with the same code; the composite
 * UNIQUE (client_id, code) is the second line of defence.
 */
class ClmSegmentController extends Controller
{
    /**
     * GET /clm/segments
     */
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $rows = $user->client_id
            ? ClmSegment::where('client_id', $user->client_id)
                ->orderBy('id')
                ->get()
            : collect();

        return response()->json([
            'status' => true,
            'data'   => $rows,
            'counts' => [
                'all'    => $rows->count(),
                'highly' => $rows->where('regulatory_status', ClmSegment::REG_HIGHLY)->count(),
                'less'   => $rows->where('regulatory_status', ClmSegment::REG_LESS)->count(),
            ],
        ]);
    }

    /**
     * POST /clm/segments
     */
    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No tenant context for this user'], 403);
        }

        $data = $request->validate([
            'name'              => 'required|string|max:255',
            'regulatory_status' => ['required', Rule::in(ClmSegment::REG_VALUES)],
            'buyer_consignee'   => ['required', Rule::in(ClmSegment::BC_VALUES)],
            'status'            => ['nullable', Rule::in(ClmSegment::STATUSES)],
        ]);

        // Reject duplicate segment name per client (case-insensitive).
        $name = trim($data['name']);
        $exists = ClmSegment::where('client_id', $user->client_id)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
            ->exists();
        if ($exists) {
            return response()->json([
                'status'  => false,
                'message' => "A segment named \"{$name}\" already exists. Pick a different name.",
            ], 409);
        }

        $row = DB::transaction(function () use ($user, $data) {
            return ClmSegment::create([
                'client_id'         => $user->client_id,
                'code'              => $this->nextCode($user->client_id),
                'name'              => trim($data['name']),
                'regulatory_status' => $data['regulatory_status'],
                'buyer_consignee'   => $data['buyer_consignee'],
                'status'            => $data['status'] ?? ClmSegment::STATUS_ACTIVE,
                'created_by'        => $user->id,
                'updated_by'        => $user->id,
            ]);
        });

        return response()->json(['status' => true, 'data' => $row], 201);
    }

    /**
     * PUT /clm/segments/{id}
     *
     * The `code` is immutable — once allocated, downstream references
     * (rules in the Document Control Panel etc.) should keep resolving
     * stably. Name + regulatory_status + buyer_consignee + status can
     * all be edited.
     */
    public function update(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row  = ClmSegment::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'name'              => 'sometimes|required|string|max:255',
            'regulatory_status' => ['sometimes', 'required', Rule::in(ClmSegment::REG_VALUES)],
            'buyer_consignee'   => ['sometimes', 'required', Rule::in(ClmSegment::BC_VALUES)],
            'status'            => ['nullable', Rule::in(ClmSegment::STATUSES)],
        ]);

        if (isset($data['name'])) $data['name'] = trim($data['name']);

        // Reject rename to a duplicate (case-insensitive, excluding self).
        if (isset($data['name'])) {
            $clash = ClmSegment::where('client_id', $user->client_id)
                ->where('id', '!=', $row->id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($data['name'])])
                ->exists();
            if ($clash) {
                return response()->json([
                    'status'  => false,
                    'message' => "Another segment named \"{$data['name']}\" already exists. Pick a different name.",
                ], 409);
            }
        }

        $data['updated_by'] = $user->id;
        $row->update($data);

        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    /**
     * DELETE /clm/segments/{id} — hard delete.
     */
    public function destroy(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row  = ClmSegment::where('client_id', $user->client_id)->findOrFail($id);

        // Block delete if this segment is referenced anywhere else in the
        // project. Each check is guarded by Schema::hasTable so the endpoint
        // doesn't crash in environments that haven't run a particular
        // migration yet (e.g. staging without consolidate-segments).
        $usedIn = [];
        if (Schema::hasTable('clm_segment_rules')
            && DB::table('clm_segment_rules')->where('segment_id', $row->id)->exists()) {
            $usedIn[] = 'Segment Rules';
        }
        if (Schema::hasTable('vendors')
            && Schema::hasColumn('vendors', 'segment_id')
            && DB::table('vendors')->where('segment_id', $row->id)->exists()) {
            $usedIn[] = 'Vendors';
        }
        if (Schema::hasTable('products')
            && Schema::hasColumn('products', 'segment_id')
            && DB::table('products')->where('segment_id', $row->id)->exists()) {
            $usedIn[] = 'Products';
        }
        if (Schema::hasTable('customers')
            && Schema::hasColumn('customers', 'segment_id')
            && DB::table('customers')->where('segment_id', $row->id)->exists()) {
            $usedIn[] = 'Customers';
        }
        // Some legacy tables store segment as a string (name or id-as-string).
        if (Schema::hasTable('master_vendor_directory')
            && Schema::hasColumn('master_vendor_directory', 'segment_id')
            && DB::table('master_vendor_directory')
                ->where(function ($q) use ($row) {
                    $q->where('segment_id', (string) $row->id)
                      ->orWhere('segment_id', $row->name);
                })
                ->exists()) {
            $usedIn[] = 'Vendor Directory';
        }

        // String-typed `segment` columns — these store the segment NAME
        // (case-sensitive match — the segment name itself is the canonical
        // string key these tables capture).
        $nameStringTables = [
            ['table' => 'customers',              'col' => 'segment', 'label' => 'Customers'],
            ['table' => 'consignees',             'col' => 'segment', 'label' => 'Consignees'],
            ['table' => 'clm_tnc_library',        'col' => 'segment', 'label' => 'T&C Library'],
            ['table' => 'clm_agreement_library',  'col' => 'segment', 'label' => 'Agreement Library'],
        ];
        foreach ($nameStringTables as $t) {
            if (Schema::hasTable($t['table'])
                && Schema::hasColumn($t['table'], $t['col'])
                && DB::table($t['table'])->where($t['col'], $row->name)->exists()) {
                $usedIn[] = $t['label'];
            }
        }

        if (!empty($usedIn)) {
            return response()->json([
                'status'  => false,
                'message' => 'This segment is in use by ' . implode(', ', $usedIn) . '. Remove or reassign those records before deleting.',
                'used_in' => $usedIn,
            ], 409);
        }

        $row->delete();

        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    /**
     * Allocate the next per-tenant code. Row-locks the parent client row
     * so two concurrent inserts can't pick the same number (Postgres
     * rejects FOR UPDATE on aggregates so we can't lock count(*) itself).
     * The composite UNIQUE on (client_id, code) is the second guard.
     *
     * Uses MAX(numeric suffix) + 1 rather than count() so deleted rows in
     * the middle of the sequence don't cause the next allocation to clash
     * with an existing code.
     */
    private function nextCode(int $clientId): string
    {
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        // Don't rely on count(+1) — the sequence can have gaps (e.g. after
        // the consolidate-segments migration merged rows from the legacy
        // master_segments table, or when a user has deleted+re-added).
        // Pull the actual max S-NNN and increment past it; skip any
        // collisions just to be doubly safe.
        $codes = ClmSegment::where('client_id', $clientId)->pluck('code')->all();
        $maxN  = 0;
        $taken = [];
        foreach ($codes as $c) {
            if (preg_match('/^S-(\d+)$/', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $maxN) $maxN = $n;
            }
            $taken[(string) $c] = true;
        }
        $n = $maxN;
        do {
            $n++;
            $code = sprintf('S-%03d', $n);
        } while (isset($taken[$code]));
        return $code;
    }
}
