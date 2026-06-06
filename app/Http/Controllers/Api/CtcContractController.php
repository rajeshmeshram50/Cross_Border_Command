<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\HandlesDocxHtmlRoundtrip;
use App\Http\Controllers\Controller;
use App\Models\CtcContract;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

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
    use HandlesDocxHtmlRoundtrip;

    /* ── shared helpers ── */

    private function fmt($d): string
    {
        if (!$d) return '—';
        try { return \Illuminate\Support\Carbon::parse($d)->format('d M Y'); }
        catch (\Throwable $e) { return '—'; }
    }

    /** Append a content-snapshot version entry (append-only audit). */
    private function pushVersion(CtcContract $c, string $label, string $status, string $by, ?string $content = null, array $extra = []): void
    {
        $versions = array_values($c->versions ?? []);
        $versions[] = array_merge([
            'v'       => count($versions) + 1,
            'label'   => $label,
            'status'  => $status,
            'date'    => now()->format('d M Y H:i'),
            'by'      => $by,
            'content' => $content !== null ? $content : $c->content,
        ], $extra);
        $c->versions = $versions;
    }

    /**
     * Each approval round derived from the version audit, newest first. A
     * round opens on every "Under Review" submission (initial draft +
     * resubmissions) and closes on the approver's Rejected / Approved
     * decision — so a draft that was rejected, revised and approved yields
     * three persistent entries (Rejected → Pending → Approved) instead of a
     * single row whose status keeps flipping.
     */
    private function approvalRoundsShaped(CtcContract $c, string $approverName): array
    {
        $reasonFromLabel = function (string $label): ?string {
            return preg_match('/—\s*(.+)$/u', $label, $m) ? trim($m[1]) : null;
        };
        $rounds = [];
        $cur = null;
        foreach (array_values($c->versions ?? []) as $v) {
            $st = $v['status'] ?? '';
            if ($st === 'Under Review') {
                if ($cur) $rounds[] = $cur;
                $cur = ['status' => 'pending', 'date' => $v['date'] ?? null, 'reason' => null];
            } elseif ($st === 'Rejected') {
                $entry = ['status' => 'rejected', 'date' => $v['date'] ?? ($cur['date'] ?? null), 'reason' => $v['reason'] ?? $reasonFromLabel((string) ($v['label'] ?? ''))];
                $rounds[] = $cur ? array_merge($cur, $entry) : $entry;
                $cur = null;
            } elseif ($st === 'Approved') {
                $entry = ['status' => 'approved', 'date' => $v['date'] ?? ($cur['date'] ?? null), 'reason' => null];
                $rounds[] = $cur ? array_merge($cur, $entry) : $entry;
                $cur = null;
            }
            // 'Sent for Signing' / 'Signed' are post-approval — ignored here.
        }
        if ($cur) {
            // Open round — reflect a live clarification state if one is pending.
            if ($c->approval_status === 'clarification') $cur['status'] = 'clarification';
            $rounds[] = $cur;
        }
        if (empty($rounds)) return [$this->shapeApprove($c, $approverName)];  // legacy rows w/o audit

        return collect(array_reverse($rounds))->map(fn ($r) => [
            'id'             => $c->code,
            'dbId'           => $c->id,
            'title'          => $c->title,
            'date'           => $r['date'] ?: $this->fmt($c->submitted_at ?: $c->created_at),
            'createdBy'      => $c->created_by_name ?: '—',
            'approver'       => $c->primary_approver_name ?: $approverName,
            'status'         => $r['status'],
            'clarifications' => ($r['status'] === 'clarification') ? array_values($c->clarifications ?? []) : [],
            'expDate'        => $this->fmt($c->end_date),
            'rejReason'      => $r['reason'] ?? null,
        ])->all();
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

    /** Approval progress: [approvedCount, totalApprovers]. */
    private function approvalProgress(CtcContract $c): array
    {
        $approvers = array_values($c->approvers ?? []);
        $total     = count($approvers);
        $approved  = collect($approvers)->filter(fn ($a) => (($a['status'] ?? 'pending')) === 'approved')->count();
        return [$approved, $total];
    }

    /** Agreements We Sent row. */
    private function shapeSent(CtcContract $c): array
    {
        $statusMap = ['approved' => 'approved', 'rejected' => 'rejected', 'clarification' => 'clarify', 'pending' => 'pending'];
        $approval  = $c->approval_status === 'clarification' ? 'pending' : ($c->approval_status ?: 'pending');
        [$approvedCount, $approverCount] = $this->approvalProgress($c);
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
            'approvers'     => array_values($c->approvers ?? []),
            'approvedCount' => $approvedCount,
            'approverCount' => $approverCount,
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
            ->flatMap(fn ($c) => $this->approvalRoundsShaped($c, $user->name ?? ''));
        return response()->json(['status' => true, 'data' => $rows->values()]);
    }

    /** Branch (our-organisation) authorised-signatory image = signature + stamp combined. */
    private function orgSignatureUrl(CtcContract $c): ?string
    {
        $branch = $c->branch_id ? \App\Models\Branch::find($c->branch_id) : null;
        return $branch?->signature_url;
    }

    /** Same image as a data URI for dompdf (which can't fetch /storage URLs). */
    private function orgSignatureDataUri(CtcContract $c): ?string
    {
        $branch = $c->branch_id ? \App\Models\Branch::find($c->branch_id) : null;
        $path = $branch?->signature_path;
        if (!$path) return null;
        if (preg_match('#/storage/(.+)$#', (string) $path, $m)) $path = $m[1];
        try {
            if (!Storage::disk('public')->exists($path)) return null;
            $data = base64_encode(Storage::disk('public')->get($path));
            $ext  = strtolower(pathinfo($path, PATHINFO_EXTENSION) ?: 'png');
            $mime = in_array($ext, ['jpg', 'jpeg']) ? 'image/jpeg' : ($ext === 'webp' ? 'image/webp' : 'image/png');
            return "data:$mime;base64,$data";
        } catch (\Throwable $e) { return null; }
    }

    /**
     * GET /clm/ctc-contracts/contact-persons?type=buyer|consignee|supplier&id=...
     *
     * Contact persons captured on the counterparty's own form — the address /
     * contact rows of the Customer (buyer), Consignee or Vendor (supplier).
     * Drives the "Select contact persons to notify" picker in Send-for-Signing.
     */
    public function contactPersons(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $type = strtolower((string) $request->query('type'));
        $id   = $request->query('id');
        if ($id === null || $id === '') return response()->json(['status' => true, 'data' => []]);

        if ($type === 'buyer' || $type === 'customer') {
            $row = \App\Models\Customer::where('client_id', $user->client_id)->with('addresses')->find($id);
            return response()->json(['status' => true, 'data' => $this->mapCpAddresses($row)]);
        }
        if ($type === 'consignee') {
            $row = \App\Models\Consignee::where('client_id', $user->client_id)->with('addresses')->find($id);
            return response()->json(['status' => true, 'data' => $this->mapCpAddresses($row)]);
        }
        if ($type === 'supplier' || $type === 'vendor') {
            $q = \App\Models\Vendor::where('client_id', $user->client_id)->with('addresses');
            $row = is_numeric($id) ? $q->find($id) : $q->where('vendor_code', $id)->first();
            if (!$row) return response()->json(['status' => true, 'data' => []]);
            $contacts = collect($row->addresses ?? [])->map(fn ($a) => [
                'name'        => $a->contact_name,
                'email'       => $a->email,
                'designation' => $a->designation,
                'phone'       => $a->contact_no,
                'is_primary'  => (bool) $a->is_primary,
            ])->filter(fn ($c) => $c['name'] || $c['email'])->values()->all();
            return response()->json(['status' => true, 'data' => $contacts]);
        }
        return response()->json(['status' => true, 'data' => []]);
    }

    /** Customer/Consignee addresses → contact persons (shared cp_* columns). */
    private function mapCpAddresses($row): array
    {
        if (!$row) return [];
        return collect($row->addresses ?? [])->map(fn ($a) => [
            'name'        => $a->cp_name,
            'email'       => $a->cp_email,
            'designation' => $a->cp_designation,
            'phone'       => $a->cp_contact,
            'is_primary'  => (bool) $a->is_primary,
        ])->filter(fn ($c) => $c['name'] || $c['email'])->values()->all();
    }

    public function show(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        // Surface the branch signature+stamp so the SPA can drop it onto the
        // {{signature}} placeholder once the agreement is approved.
        $row->org_signature_url = $this->orgSignatureUrl($row);
        // Fully-signed PDF (from Zoho) once the signature request completed.
        $row->signed_document_url = $this->signedDocumentUrl($row);
        return response()->json(['status' => true, 'data' => $row]);
    }

    /** Public URL of the fully-signed PDF (from the linked signature request), or null. */
    private function signedDocumentUrl(CtcContract $c): ?string
    {
        if (!$c->signature_request_id) return null;
        $sr = \App\Models\ClmSignatureRequest::find($c->signature_request_id);
        $paths = is_array($sr?->signed_document_paths) ? $sr->signed_document_paths : [];
        $first = $paths[0] ?? null;
        if (!is_array($first)) return null;
        return $first['file_url'] ?? $first['url'] ?? (isset($first['path']) ? file_url($first['path']) : null);
    }

    /**
     * GET /clm/ctc-contracts/approver-candidates
     *
     * Internal people who can be picked as approvers for a CTC draft:
     * the client (client_admin), the branch (branch_user) and the employees
     * under the active branch. Scoped to the caller's client; when a
     * branch_id is present (auto-injected by the SPA), employees/branch users
     * are narrowed to that branch while the client admin stays tenant-wide.
     */
    public function approverCandidates(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $branchFilter = $request->integer('branch_id') ?: null;

        $query = User::where('client_id', $user->client_id)
            ->where('status', 'active')
            ->whereIn('user_type', ['client_admin', 'branch_user', 'employee'])
            ->with('branch:id,name');

        if ($branchFilter) {
            $query->where(function ($w) use ($branchFilter) {
                $w->where('user_type', 'client_admin')      // client stays tenant-wide
                  ->orWhere('branch_id', $branchFilter);    // branch + its employees
            });
        }

        // CLIENT first, then BRANCH, then employees — and alphabetical within each.
        $order = ['client_admin' => 0, 'branch_user' => 1, 'employee' => 2];
        $rows = $query->get(['id', 'name', 'email', 'user_type', 'client_id', 'branch_id'])
            ->sortBy(fn ($u) => [$order[$u->user_type] ?? 9, strtolower($u->name ?? '')])
            ->values()
            ->map(fn ($u) => [
                'id'          => $u->id,
                'name'        => $u->name,
                'email'       => $u->email,
                'user_type'   => $u->user_type,
                'branch_name' => $u->branch->name ?? null,
            ]);

        return response()->json(['status' => true, 'data' => $rows]);
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

        // Each approver carries its own decision so the contract only counts
        // as approved once EVERY selected approver has approved (see approve()).
        // `status` starts 'pending'; `acted_at` stamps when they decide.
        $approvers = collect($data['approvers'] ?? [])->map(fn ($a) => [
            'name'      => (string) ($a['name'] ?? ''),
            'email'     => strtolower((string) ($a['email'] ?? '')),
            'role'      => (string) ($a['role'] ?? ''),
            'mandatory' => (bool) ($a['mandatory'] ?? false),
            'status'    => 'pending',
            'acted_at'  => null,
        ])->values();
        $primary = $approvers->first();

        $row = DB::transaction(function () use ($user, $data, $approvers, $primary) {
            // Per-client sequential code under a row lock (same as Quotation/PI).
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $seq  = CtcContract::withTrashed()->where('client_id', $user->client_id)->count() + 1;
            $code = sprintf('CTC-%03d', $seq);

            $v1 = [[
                'v'       => 1,
                'label'   => 'Agreement drafted & submitted for internal review',
                'status'  => 'Under Review',
                'date'    => now()->format('d M Y H:i'),
                'by'      => $user->name ?? '',
                'content' => $data['content'] ?? null,
            ]];

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
                'versions'           => $v1,
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

    /**
     * Mark the caller's approval. The contract is only flagged `approved`
     * (which is what unlocks "Send for Signing" → Stage 3) once EVERY
     * selected approver has approved — a single approver's nod is no longer
     * enough. Each approver's decision is tracked inside the `approvers`
     * JSON so partial progress survives reloads and is queryable.
     *
     * Backward-compatible: drafts created before per-approver tracking (no
     * `status` keys, or an empty approver list) approve outright on one nod.
     */
    public function approve(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);

        $email     = strtolower((string) $user->email);
        $approvers = array_values($row->approvers ?? []);

        // Legacy / no approver list → single approval approves outright.
        if (empty($approvers)) {
            $row->approval_status = 'approved';
            $row->rejection_reason = null;
            $this->pushVersion($row, 'Approved by ' . ($user->name ?? 'approver'), 'Approved', $user->name ?? '');
            $row->save();
            return response()->json(['status' => true, 'data' => $this->shapeApprove($row->fresh(), $user->name ?? '')]);
        }

        // Stamp this approver's decision (match by email; fall back to the
        // primary-approver slot for legacy rows that only stored the primary).
        $matched = false;
        foreach ($approvers as &$a) {
            if (strtolower((string) ($a['email'] ?? '')) === $email && $email !== '') {
                $a['status']   = 'approved';
                $a['acted_at'] = now()->format('d M Y H:i');
                $matched = true;
            }
        }
        unset($a);
        if (!$matched && $email !== '' && strtolower((string) $row->primary_approver_email) === $email) {
            $approvers[0]['status']   = 'approved';
            $approvers[0]['acted_at'] = now()->format('d M Y H:i');
            $matched = true;
        }
        if (!$matched) {
            return response()->json(['status' => false, 'message' => 'You are not an approver for this agreement.'], 403);
        }

        $row->approvers = $approvers;

        $total    = count($approvers);
        $approved = collect($approvers)->filter(fn ($a) => ($a['status'] ?? 'pending') === 'approved')->count();

        if ($approved >= $total) {
            // Everyone has approved → contract is approved (stays at Stage 2;
            // the sender then chooses "Send for Signing & Negotiation").
            $row->approval_status  = 'approved';
            $row->rejection_reason = null;
            $this->pushVersion($row, 'Approved by all ' . $total . ' approver' . ($total > 1 ? 's' : ''), 'Approved', $user->name ?? '');
        } else {
            // Still waiting on others → keep the round open. The audit note uses
            // a non-round status so approvalRoundsShaped() doesn't close it early.
            $row->approval_status = 'pending';
            $this->pushVersion($row, ($user->name ?? 'Approver') . ' approved (' . $approved . ' of ' . $total . ') — awaiting remaining approvers', 'Approving', $user->name ?? '');
        }
        $row->save();
        return response()->json(['status' => true, 'data' => $this->shapeApprove($row->fresh(), $user->name ?? '')]);
    }

    public function reject(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        $data = $request->validate(['reason' => 'required|string|max:1000']);

        // One rejection blocks the whole agreement — record which approver
        // declined, then flip the contract to rejected. Rejected → sender can
        // revise & resubmit (multiple times), so the row stays workable
        // (status 'inprogress'); only approval_status flips.
        $email = strtolower((string) $user->email);
        $approvers = array_values($row->approvers ?? []);
        foreach ($approvers as &$a) {
            if (strtolower((string) ($a['email'] ?? '')) === $email && $email !== '') {
                $a['status']   = 'rejected';
                $a['acted_at'] = now()->format('d M Y H:i');
            }
        }
        unset($a);
        if (!empty($approvers)) $row->approvers = $approvers;

        $row->approval_status = 'rejected';
        $row->status = 'inprogress';
        $row->rejection_reason = $data['reason'];
        $this->pushVersion($row, 'Rejected by ' . ($user->name ?? 'approver') . ' — ' . $data['reason'], 'Rejected', $user->name ?? '', null, ['reason' => $data['reason']]);
        $row->save();
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

    /* ── Lifecycle transitions (sender side, from the add/edit form) ── */

    /**
     * POST /clm/ctc-contracts/{id}/resubmit
     * Revise the draft and re-send for internal review — used both after an
     * internal rejection AND after a counterparty declined the e-sign. Either
     * way the contract re-enters Stage 2 approval (a decline cannot go straight
     * back to Zoho), so any live signing request is cleared. Repeatable.
     */
    public function resubmit(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'content'       => 'nullable|string',
            'title'         => 'sometimes|string|max:255',
            'header_config' => 'nullable|array',
            'footer_config' => 'nullable|array',
        ]);

        if (array_key_exists('content', $data))       $row->content = $data['content'];
        if (array_key_exists('title', $data))         $row->title = $data['title'];
        if (array_key_exists('header_config', $data)) $row->header_config = $data['header_config'];
        if (array_key_exists('footer_config', $data)) $row->footer_config = $data['footer_config'];

        $wasDeclined = collect($row->signing_recipients ?? [])->contains(fn ($r) => !empty($r['declined']));

        // Fresh approval round → clear every approver's previous decision so the
        // all-must-approve gate starts over.
        $row->approvers = collect($row->approvers ?? [])->map(function ($a) {
            $a = (array) $a;
            $a['status']   = 'pending';
            $a['acted_at'] = null;
            return $a;
        })->values()->all();

        $row->approval_status = 'pending';
        $row->status = 'inprogress';
        $row->stage = 2;
        $row->rejection_reason = null;
        $row->submitted_at = now();
        // Re-entering the approval cycle → drop the previous signing request so
        // it can't be reused; a fresh one is created after the new approval.
        $row->signing_recipients   = [];
        $row->zoho_request_id      = null;
        $row->signature_request_id = null;
        $row->signature_declined_at = null;
        $label = $wasDeclined
            ? 'Draft revised after counterparty decline & resubmitted for internal review'
            : 'Revised draft resubmitted for internal review';
        $this->pushVersion($row, $label, 'Under Review', $user->name ?? '');
        $row->save();

        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    /**
     * POST /clm/ctc-contracts/{id}/send-for-signing
     * Approved → send to counterparties for signature & negotiation (Stage 3).
     */
    public function sendForSigning(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);

        if ($row->approval_status !== 'approved') {
            return response()->json(['status' => false, 'message' => 'Agreement must be approved before sending for signing.'], 422);
        }

        $data = $request->validate([
            'recipients'             => 'required|array|min:1',
            'recipients.*.name'      => 'required|string|max:255',
            'recipients.*.email'     => 'nullable|string|max:255',
            'recipients.*.role'      => 'nullable|string|max:128',
            'recipients.*.contact'   => 'nullable|string|max:255',
            'days_to_sign'           => 'nullable|integer|min:1|max:365',
        ]);

        $recipients = collect($data['recipients'])->map(fn ($r) => [
            'name'      => (string) ($r['name'] ?? ''),
            'email'     => strtolower((string) ($r['email'] ?? '')),
            'role'      => (string) ($r['role'] ?? ''),
            'contact'   => (string) ($r['contact'] ?? ''),
            'signed'    => false,
            'signed_at' => null,
        ])->values()->all();

        $row->signing_recipients = $recipients;
        $row->days_to_sign = $data['days_to_sign'] ?? null;
        $row->stage = 3;
        $row->status = 'inprogress';
        $this->pushVersion($row, 'Agreement sent to counterparty for signature & negotiation', 'Sent for Signing', $user->name ?? '');
        $row->save();

        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    /**
     * POST /clm/ctc-contracts/{id}/record-signature
     * Mark one recipient (by index/email) signed, or all at once.
     * When every recipient has signed, a "signed by all parties" version is added.
     */
    public function recordSignature(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'index' => 'nullable|integer|min:0',
            'email' => 'nullable|string|max:255',
            'all'   => 'nullable|boolean',
        ]);

        $recipients = array_values($row->signing_recipients ?? []);
        if (!count($recipients)) {
            return response()->json(['status' => false, 'message' => 'No signing recipients to mark.'], 422);
        }

        $stamp = now()->format('d M Y H:i');
        if (!empty($data['all'])) {
            foreach ($recipients as &$r) { if (empty($r['signed'])) { $r['signed'] = true; $r['signed_at'] = $stamp; } }
            unset($r);
        } elseif (array_key_exists('index', $data) && $data['index'] !== null && isset($recipients[$data['index']])) {
            $recipients[$data['index']]['signed'] = true;
            $recipients[$data['index']]['signed_at'] = $stamp;
        } elseif (!empty($data['email'])) {
            $email = strtolower($data['email']);
            foreach ($recipients as &$r) { if (($r['email'] ?? '') === $email) { $r['signed'] = true; $r['signed_at'] = $stamp; } }
            unset($r);
        } else {
            return response()->json(['status' => false, 'message' => 'Specify which recipient signed.'], 422);
        }

        $row->signing_recipients = $recipients;
        $allSigned = collect($recipients)->every(fn ($r) => !empty($r['signed']));
        if ($allSigned) {
            $row->cp_signed_date = now();
            $this->pushVersion($row, 'Agreement signed by all parties', 'Signed', $user->name ?? '');
        }
        $row->save();

        return response()->json(['status' => true, 'data' => $row->fresh(), 'allSigned' => $allSigned]);
    }

    /**
     * POST /clm/ctc-contracts/{id}/move-to-repository
     * All parties signed → store in the Final Contract Repository (Stage 4).
     */
    public function moveToRepository(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);

        $recipients = array_values($row->signing_recipients ?? []);
        $allSigned  = count($recipients) > 0 && collect($recipients)->every(fn ($r) => !empty($r['signed']));
        if (!$allSigned) {
            return response()->json(['status' => false, 'message' => 'All parties must sign before moving to the repository.'], 422);
        }

        $row->stage = 4;
        $row->status = 'signed';
        if (!$row->cp_signed_date) $row->cp_signed_date = now();
        $this->pushVersion($row, 'Agreement stored in final contract repository', 'Signed', $user->name ?? '');
        $row->save();

        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    /** GET /clm/ctc-contracts/{id}/versions — version history list. */
    public function versions(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        return response()->json(['status' => true, 'data' => array_values($row->versions ?? [])]);
    }

    /**
     * GET /clm/ctc-contracts/{id}/versions/{v}/download
     * Render a specific version's content snapshot to PDF (page-shell + footer
     * page numbers), reusing the shared signature-document blade + dompdf.
     */
    public function downloadVersion(Request $request, int $id, int $v)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);

        $versions = array_values($row->versions ?? []);
        $entry = collect($versions)->firstWhere('v', $v);
        if (!$entry) abort(404);

        $html = trim((string) ($entry['content'] ?? $row->content));
        if ($html === '') $html = '<p><em>No content saved for this version.</em></p>';
        $processedHtml = $this->normaliseEditorHtml($html);

        // Once approved, the {{signature}} placeholder (receiving-party / our
        // organisation) is filled with the branch's signature + stamp image.
        $approved = $row->approval_status === 'approved' || (int) $row->stage >= 3;
        $sigUri = $approved ? $this->orgSignatureDataUri($row) : null;
        $sigHtml = $sigUri
            ? '<img src="' . $sigUri . '" alt="Authorised Signatory" style="max-height:80px;max-width:210px;object-fit:contain;" />'
            : '';
        $processedHtml = preg_replace('/\{\{\s*signature\s*\}\}/i', $sigHtml, $processedHtml);

        $headerConfig = is_array($row->header_config) ? $row->header_config : [];
        $footerConfig = is_array($row->footer_config) ? $row->footer_config : [];
        $client = \App\Models\Client::find($row->client_id);

        $urlPath = (isset($headerConfig['logo_url']) && preg_match('#/storage/(.+)$#', (string) $headerConfig['logo_url'], $m)) ? $m[1] : null;
        $headerLogoBase64 = '';
        foreach (array_filter([$headerConfig['logo_path'] ?? null, $urlPath, $client?->logo]) as $path) {
            try {
                if (Storage::disk('public')->exists($path)) { $headerLogoBase64 = base64_encode(Storage::disk('public')->get($path)); break; }
            } catch (\Throwable $e) { /* try next candidate */ }
        }

        // Make the document title reflect the version for the blade heading.
        $row->title = ($row->title ?: 'Agreement') . ' — v' . $v;

        $pdf = \Barryvdh\DomPDF\Facade\Pdf::loadView('pdf.clm-signature-document', [
            'document'         => $row,
            'party'            => null,
            'modelName'        => '',
            'processedHtml'    => $processedHtml,
            'generatedDate'    => now()->format('d/m/Y'),
            'requestId'        => $row->code ?: 'CTC',
            'signers'          => [],
            'client'           => $client,
            'headerConfig'     => $headerConfig,
            'footerConfig'     => $footerConfig,
            'headerLogoBase64' => $headerLogoBase64,
        ])->setPaper('a4')->setOption('isPhpEnabled', true);

        return $pdf->download(($row->code ?: 'CTC') . '-v' . $v . '.pdf');
    }
}
