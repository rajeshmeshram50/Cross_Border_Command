<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CtcContract;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * CLM Operations · Without Shipment ID → Case-to-Case (CTC) Contracts.
 *
 * One controller drives the add/drafting form plus the three views:
 *   index()         → Case to Case Contracts list
 *   sentIndex()     → Agreements We Sent      (created_by = me)
 *   toApproveIndex()→ Agreements To Approve   (my email is an approver)
 * Approver actions: approve / reject / clarify; sender: respond.
 *
 * Counterparties, page header/footer, approvers and the clarification thread
 * round-trip as JSON, so the response shapes match the SPA's CtcContract /
 * AwsContract / AtaContract types 1:1.
 */
class CtcContractController extends Controller
{
    /* ── shared helpers ── */

    private function fmt($d): string
    {
        if (!$d) return '—';
        try { return \Illuminate\Support\Carbon::parse($d)->format('d M Y'); }
        catch (\Throwable $e) { return '—'; }
    }

    /** Approval lifecycle → CTC-list bucket. */
    private function listStatus(CtcContract $c): string
    {
        if ($c->approval_status === 'rejected') return 'rejected';
        if ($c->stage >= 4 || $c->status === 'signed') return 'signed';
        return 'inprogress';
    }

    private function cpNames(CtcContract $c): array
    {
        return collect($c->counterparties ?? [])->map(fn ($x) => $x['name'] ?? '')->filter()->values()->all();
    }

    /** Case to Case Contracts list row. */
    private function shapeList(CtcContract $c): array
    {
        $approval = $c->approval_status === 'clarification' ? 'pending' : ($c->approval_status ?: 'pending');
        return [
            'id'           => $c->code,
            'dbId'         => $c->id,
            'title'        => $c->title,
            'cp'           => $this->cpNames($c) ?: ['—'],
            'org'          => $c->org_name ?: '—',
            'stage'        => $c->stage,
            'status'       => $this->listStatus($c),
            'date'         => $this->fmt($c->submitted_at ?: $c->created_at),
            'type'         => $c->agreement_type ?: '—',
            'effDate'      => $this->fmt($c->eff_date),
            'endDate'      => $this->fmt($c->end_date),
            'createdBy'    => $c->created_by_name ?: '—',
            'approval'     => $approval,
            'cpSignedDate' => $this->fmt($c->cp_signed_date),
        ];
    }

    /** Agreements We Sent row. */
    private function shapeSent(CtcContract $c): array
    {
        $statusMap = ['approved' => 'approved', 'rejected' => 'rejected', 'clarification' => 'clarify', 'pending' => 'pending'];
        $approval  = $c->approval_status === 'clarification' ? 'pending' : ($c->approval_status ?: 'pending');
        return [
            'id'        => $c->code,
            'dbId'      => $c->id,
            'title'     => $c->title,
            'cp'        => $this->cpNames($c) ?: ['—'],
            'org'       => $c->org_name ?: '—',
            'date'      => $this->fmt($c->submitted_at ?: $c->created_at),
            'effDate'   => $this->fmt($c->eff_date),
            'endDate'   => $this->fmt($c->end_date),
            'createdBy' => $c->created_by_name ?: '—',
            'approver'  => $c->primary_approver_name ?: '—',
            'approval'  => $approval,
            'status'    => $statusMap[$c->approval_status] ?? 'pending',
            'clarifications' => array_values($c->clarifications ?? []),
            'rejReason' => $c->rejection_reason,
            'expDate'   => $this->fmt($c->end_date),
        ];
    }

    /** Agreements To Approve row. */
    private function shapeApprove(CtcContract $c, string $approverName): array
    {
        return [
            'id'             => $c->code,
            'dbId'           => $c->id,
            'title'          => $c->title,
            'date'           => $this->fmt($c->submitted_at ?: $c->created_at),
            'createdBy'      => $c->created_by_name ?: '—',
            'approver'       => $c->primary_approver_name ?: $approverName,
            'status'         => $c->approval_status ?: 'pending',
            'clarifications' => array_values($c->clarifications ?? []),
            'expDate'        => $this->fmt($c->end_date),
            'rejReason'      => $c->rejection_reason,
        ];
    }

    /* ── Case to Case Contracts list ── */
    public function index(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $rows = CtcContract::where('client_id', $user->client_id)
            ->orderByDesc('id')->get()
            ->map(fn ($c) => $this->shapeList($c));
        return response()->json(['status' => true, 'data' => $rows]);
    }

    /* ── Agreements We Sent (mine) ── */
    public function sentIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $rows = CtcContract::where('client_id', $user->client_id)
            ->where('created_by', $user->id)
            ->orderByDesc('id')->get()
            ->map(fn ($c) => $this->shapeSent($c));
        return response()->json(['status' => true, 'data' => $rows]);
    }

    /* ── Agreements To Approve (I'm an approver) ── */
    public function toApproveIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $email = strtolower((string) $user->email);
        $rows = CtcContract::where('client_id', $user->client_id)
            ->where(function ($w) use ($email) {
                $w->whereJsonContains('approver_emails', $email)
                  ->orWhere('primary_approver_email', $email);
            })
            ->orderByDesc('id')->get()
            ->map(fn ($c) => $this->shapeApprove($c, $user->name ?? ''));
        return response()->json(['status' => true, 'data' => $rows]);
    }

    public function show(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        return response()->json(['status' => true, 'data' => $row]);
    }

    /* ── Create (Submit & Send for Approval from the add form) ── */
    public function store(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $request->validate([
            'title'              => 'required|string|max:255',
            'agreement_type'     => 'nullable|string|max:64',
            'org_name'           => 'nullable|string|max:255',
            'org_short_code'     => 'nullable|string|max:64',
            'org_state'          => 'nullable|string|max:128',
            'org_country'        => 'nullable|string|max:128',
            'counterparties'     => 'nullable|array',
            'eff_date'           => 'nullable|date',
            'end_date'           => 'nullable|date',
            'termination_notice' => 'nullable|integer',
            'auto_renewal'       => 'nullable|boolean',
            'renewal_type'       => 'nullable|string|max:16',
            'content'            => 'nullable|string',
            'header_config'      => 'nullable|array',
            'footer_config'      => 'nullable|array',
            'approvers'          => 'nullable|array',
            'days_to_approve'    => 'nullable|integer',
            'reminder_days'      => 'nullable|integer',
        ]);

        $approvers = collect($data['approvers'] ?? [])->map(fn ($a) => [
            'name'      => (string) ($a['name'] ?? ''),
            'email'     => strtolower((string) ($a['email'] ?? '')),
            'role'      => (string) ($a['role'] ?? ''),
            'mandatory' => (bool) ($a['mandatory'] ?? false),
        ])->values();
        $primary = $approvers->first();

        $row = DB::transaction(function () use ($user, $data, $approvers, $primary) {
            // Per-client sequential code under a row lock (same as Quotation/PI).
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $seq  = CtcContract::withTrashed()->where('client_id', $user->client_id)->count() + 1;
            $code = sprintf('CTC-%03d', $seq);

            return CtcContract::create([
                'client_id'          => $user->client_id,
                'branch_id'          => $user->branch_id ?? null,
                'code'               => $code,
                'title'              => $data['title'],
                'agreement_type'     => $data['agreement_type'] ?? null,
                'org_name'           => $data['org_name'] ?? null,
                'org_short_code'     => $data['org_short_code'] ?? null,
                'org_state'          => $data['org_state'] ?? null,
                'org_country'        => $data['org_country'] ?? null,
                'counterparties'     => $data['counterparties'] ?? [],
                'eff_date'           => $data['eff_date'] ?? null,
                'end_date'           => $data['end_date'] ?? null,
                'termination_notice' => $data['termination_notice'] ?? null,
                'auto_renewal'       => $data['auto_renewal'] ?? false,
                'renewal_type'       => $data['renewal_type'] ?? null,
                'content'            => $data['content'] ?? null,
                'header_config'      => $data['header_config'] ?? null,
                'footer_config'      => $data['footer_config'] ?? null,
                'approvers'          => $approvers->all(),
                'approver_emails'    => $approvers->pluck('email')->filter()->values()->all(),
                'clarifications'     => [],
                'stage'              => 2,                 // submitted → Internal Review
                'approval_status'    => 'pending',
                'status'             => 'inprogress',
                'days_to_approve'    => $data['days_to_approve'] ?? null,
                'reminder_days'      => $data['reminder_days'] ?? null,
                'primary_approver_name'  => $primary['name'] ?? null,
                'primary_approver_email' => $primary['email'] ?? null,
                'created_by'         => $user->id,
                'created_by_name'    => $user->name ?? null,
                'submitted_at'       => now(),
            ]);
        });

        return response()->json(['status' => true, 'data' => $this->shapeList($row), 'code' => $row->code], 201);
    }

    public function update(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'title'          => 'sometimes|string|max:255',
            'agreement_type' => 'nullable|string|max:64',
            'content'        => 'nullable|string',
            'header_config'  => 'nullable|array',
            'footer_config'  => 'nullable|array',
            'counterparties' => 'nullable|array',
            'eff_date'       => 'nullable|date',
            'end_date'       => 'nullable|date',
        ]);
        $row->update($data);
        return response()->json(['status' => true, 'data' => $this->shapeList($row->fresh())]);
    }

    public function destroy(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        $row->delete();
        return response()->json(['status' => true]);
    }

    /* ── Approver actions ── */
    public function approve(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        $row->update(['approval_status' => 'approved', 'stage' => max($row->stage, 3)]);
        return response()->json(['status' => true, 'data' => $this->shapeApprove($row->fresh(), $user->name ?? '')]);
    }

    public function reject(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        $data = $request->validate(['reason' => 'required|string|max:1000']);
        $row->update(['approval_status' => 'rejected', 'status' => 'rejected', 'rejection_reason' => $data['reason']]);
        return response()->json(['status' => true, 'data' => $this->shapeApprove($row->fresh(), $user->name ?? '')]);
    }

    public function clarify(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        $data = $request->validate(['query' => 'required|string|max:2000']);
        $thread = $row->clarifications ?? [];
        $thread[] = ['query' => $data['query'], 'date' => now()->format('d M Y'), 'response' => '', 'resolved' => false];
        $row->update(['approval_status' => 'clarification', 'clarifications' => $thread]);
        return response()->json(['status' => true, 'data' => $this->shapeApprove($row->fresh(), $user->name ?? '')]);
    }

    /** Sender responds to the latest open clarification. */
    public function respond(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        $data = $request->validate(['response' => 'required|string|max:2000']);
        $thread = $row->clarifications ?? [];
        for ($i = count($thread) - 1; $i >= 0; $i--) {
            if (empty($thread[$i]['response'])) { $thread[$i]['response'] = $data['response']; break; }
        }
        $row->update(['clarifications' => $thread]);
        return response()->json(['status' => true, 'data' => $this->shapeSent($row->fresh())]);
    }
}
