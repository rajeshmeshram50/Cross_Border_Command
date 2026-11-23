<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\LeadAckReason;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class LeadAckReasonController extends Controller
{
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

        $branchId = $this->effectiveBranchId($request, $user);
        $rows = LeadAckReason::where('client_id', $user->client_id)
            ->where(fn ($q) => $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId))
            ->orderBy('id')
            ->get();

        return response()->json([
            'qualified'       => $rows->where('opportunity_type', LeadAckReason::TYPE_QUALIFIED)->values(),
            'disqualified'    => $rows->where('opportunity_type', LeadAckReason::TYPE_DISQUALIFIED)->values(),
            'clarity_pending' => $rows->where('opportunity_type', LeadAckReason::TYPE_CLARITY_PENDING)->values(),
        ]);
    }

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

        $isDisqualified = $data['opportunity_type'] === LeadAckReason::TYPE_DISQUALIFIED;
        if ($isDisqualified && empty($data['dq_status'])) {
            return response()->json(['message' => 'dq_status is required for disqualified opportunities'], 422);
        }

        $row = LeadAckReason::create([
            'client_id'        => $user->client_id,
            'branch_id'        => $this->effectiveBranchId($request, $user),
            'opportunity_type' => $data['opportunity_type'],
            'reason'           => trim($data['reason']),
            'status'           => $data['status'] ?? LeadAckReason::STATUS_ACTIVE,
            'dq_status'        => $isDisqualified ? $data['dq_status'] : null,
            'created_by'       => $user->id,
            'updated_by'       => $user->id,
        ]);

        return response()->json($row, 201);
    }

    public function update(Request $request, $id)
    {
        $user = $request->user();
        $branchId = $this->effectiveBranchId($request, $user);
        $row  = LeadAckReason::where('client_id', $user->client_id)
            ->where(fn ($q) => $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId))
            ->findOrFail($id);

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

    public function destroy(Request $request, $id)
    {
        $user = $request->user();
        $branchId = $this->effectiveBranchId($request, $user);
        $row  = LeadAckReason::where('client_id', $user->client_id)
            ->where(fn ($q) => $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId))
            ->findOrFail($id);
        $row->delete();

        return response()->json(['message' => 'Deleted']);
    }

    private function effectiveBranchId(Request $request, $user): ?int
    {
        $b = $request->input('branch_id');
        if ($b !== null && $b !== '') {
            return (int) $b;
        }
        return $user->branch_id !== null ? (int) $user->branch_id : null;
    }
}
