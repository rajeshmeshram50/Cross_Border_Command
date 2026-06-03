<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\LeadAckReason;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;


class LeadAckReasonController extends Controller
{
    /**
     * GET /sales/lead-ack-reasons
     *
     * Returns the three opportunity buckets grouped — saves the page from
     * firing three round trips on mount. Each bucket is already sorted by
     * id ascending (matching the source design's display order).
     */
    public function index(Request $request)
    {
        $user = $request->user();

        if (!$user->client_id) {
            return response()->json([
                'qualified'       => [],
                'disqualified'    => [],
                'clarity_pending' => [],
            ]);
        }

        $rows = LeadAckReason::where('client_id', $user->client_id)
            ->orderBy('id')
            ->get();

        return response()->json([
            'qualified'       => $rows->where('opportunity_type', LeadAckReason::TYPE_QUALIFIED)->values(),
            'disqualified'    => $rows->where('opportunity_type', LeadAckReason::TYPE_DISQUALIFIED)->values(),
            'clarity_pending' => $rows->where('opportunity_type', LeadAckReason::TYPE_CLARITY_PENDING)->values(),
        ]);
    }

    /**
     * POST /sales/lead-ack-reasons
     */
    public function store(Request $request)
    {
        $user = $request->user();

        if (!$user->client_id) {
            return response()->json(['message' => 'No tenant context for this user'], 403);
        }

        $data = $request->validate([
            'opportunity_type' => ['required', Rule::in(LeadAckReason::TYPES)],
            'reason'           => ['required', 'string', 'max:500'],
            'status'           => ['nullable', Rule::in(LeadAckReason::STATUSES)],
            'dq_status'        => ['nullable', Rule::in(LeadAckReason::DQ_VALUES)],
        ]);

        // dq_status is only meaningful for disqualified rows. Reject a payload
        // that asks for one without the other — keeps the data clean.
        $isDisqualified = $data['opportunity_type'] === LeadAckReason::TYPE_DISQUALIFIED;
        if ($isDisqualified && empty($data['dq_status'])) {
            return response()->json(['message' => 'dq_status is required for disqualified opportunities'], 422);
        }

        $row = LeadAckReason::create([
            'client_id'        => $user->client_id,
            'opportunity_type' => $data['opportunity_type'],
            'reason'           => trim($data['reason']),
            'status'           => $data['status'] ?? LeadAckReason::STATUS_ACTIVE,
            'dq_status'        => $isDisqualified ? $data['dq_status'] : null,
            'created_by'       => $user->id,
            'updated_by'       => $user->id,
        ]);

        return response()->json($row, 201);
    }

    /**
     * PUT /sales/lead-ack-reasons/{id}
     *
     * Used for both "Edit" (reason/status/dq_status change) and the
     * "Mark Inactive" trash button (status only). opportunity_type is
     * intentionally immutable — moving a reason between tabs would corrupt
     * historical references on existing opportunities.
     */
    public function update(Request $request, $id)
    {
        $user = $request->user();
        $row  = LeadAckReason::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'reason'    => ['nullable', 'string', 'max:500'],
            'status'    => ['nullable', Rule::in(LeadAckReason::STATUSES)],
            'dq_status' => ['nullable', Rule::in(LeadAckReason::DQ_VALUES)],
        ]);

        $updates = [];
        if (array_key_exists('reason', $data) && $data['reason'] !== null) {
            $updates['reason'] = trim($data['reason']);
        }
        if (array_key_exists('status', $data) && $data['status'] !== null) {
            $updates['status'] = $data['status'];
        }
        // Only the disqualified type carries dq_status; silently drop the
        // field for the other two so a fat-fingered payload can't pollute them.
        if ($row->opportunity_type === LeadAckReason::TYPE_DISQUALIFIED
            && array_key_exists('dq_status', $data)
            && $data['dq_status'] !== null) {
            $updates['dq_status'] = $data['dq_status'];
        }

        if (empty($updates)) {
            return response()->json($row);
        }

        $updates['updated_by'] = $user->id;
        $row->update($updates);

        return response()->json($row);
    }

    /**
     * DELETE /sales/lead-ack-reasons/{id} — hard delete.
     *
     * The trash icon in the UI currently flips status to inactive via the
     * update endpoint (matching the source design's "mark inactive"). This
     * endpoint exists for true cleanup — e.g. an admin removing a duplicate
     * row that was created in error.
     */
    public function destroy(Request $request, $id)
    {
        $user = $request->user();
        $row  = LeadAckReason::where('client_id', $user->client_id)->findOrFail($id);
        $row->delete();

        return response()->json(['message' => 'Deleted']);
    }
}
