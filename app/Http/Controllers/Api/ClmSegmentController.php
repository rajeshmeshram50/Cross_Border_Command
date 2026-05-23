<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmSegment;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
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

        $maxNum = (int) ClmSegment::where('client_id', $clientId)
            ->where('code', 'like', 'S-%')
            ->selectRaw("COALESCE(MAX(CAST(SUBSTRING(code FROM 3) AS INTEGER)), 0) AS max_num")
            ->value('max_num');

        return sprintf('S-%03d', $maxNum + 1);
    }
}
