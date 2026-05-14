<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\HrDocumentSignature;
use App\Models\HrDocumentTemplate;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Document signing workflow runtime. Each row in `hr_document_signatures`
 * is one "send" of a template against one employee. Per-signer state lives
 * in the JSON `signers` column; the audit trail is a JSON array of events
 * appended to the row on every action.
 *
 * Endpoints:
 *   POST   /hr-document-signatures                       send a template into its workflow
 *   GET    /hr-document-signatures                       list (?employee_id, ?status)
 *   GET    /hr-document-signatures/inbox                 my pending signature tasks
 *   GET    /hr-document-signatures/{id}                  one row + audit log + resolved HTML
 *   POST   /hr-document-signatures/{id}/action           current signer signs / approves / acknowledges
 *   POST   /hr-document-signatures/{id}/reject           current signer rejects
 *   POST   /hr-document-signatures/{id}/cancel           sender cancels the run
 */
class HrDocumentSignatureController extends Controller
{
    private const WITH = [
        'template:id,code,name,doc_type',
        'employee:id,first_name,last_name,display_name,emp_code,department_id,designation_id,reporting_manager_id,user_id',
        'employee.department:id,name',
        'employee.designation:id,name,level',
        'creator:id,name',
    ];

    private const STATUSES = ['Pending', 'In Progress', 'Completed', 'Rejected', 'Cancelled'];
    private const ACTIONS  = ['Sign', 'Approve', 'Review & Acknowledge'];

    /* ───── LIST / INBOX / SHOW ───── */

    public function index(Request $request)
    {
        $q = HrDocumentSignature::query()->with(self::WITH);
        $this->applyScope($q, $request->user());

        if ($empId  = $request->integer('employee_id'))   $q->where('employee_id', $empId);
        if ($status = $request->query('status'))          $q->where('status', $status);
        if ($tplId  = $request->integer('template_id'))   $q->where('template_id', $tplId);

        return response()->json($q->orderByDesc('id')->get());
    }

    /**
     * Inbox = signature runs where the CURRENT user is the next signer.
     * Returned shape mirrors `index` so the same row component renders both.
     */
    public function inbox(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = HrDocumentSignature::query()->with(self::WITH)
            ->whereIn('status', ['Pending', 'In Progress']);
        $this->applyScope($q, $user);

        // Filter in PHP since signer matching is JSON-shape-specific.
        $rows = $q->orderByDesc('id')->get()->filter(function ($row) use ($user) {
            $signers = is_array($row->signers) ? $row->signers : [];
            $idx     = (int) $row->current_index;
            $current = $signers[$idx] ?? null;
            if (!$current) return false;
            return (int) ($current['user_id'] ?? 0) === (int) $user->id
                && ($current['status'] ?? 'Pending') !== 'Done';
        })->values();

        return response()->json($rows);
    }

    public function show(Request $request, $id)
    {
        $q = HrDocumentSignature::query()->with(self::WITH);
        $this->applyScope($q, $request->user());
        return response()->json($q->findOrFail((int) $id));
    }

    /* ───── SEND ───── */

    public function store(Request $request)
    {
        $data = $request->validate([
            'template_id' => 'required|integer|exists:hr_document_templates,id',
            'employee_id' => 'required|integer|exists:employees,id',
        ]);

        return DB::transaction(function () use ($request, $data) {
            $user = $request->user();

            $tpl = HrDocumentTemplate::findOrFail((int) $data['template_id']);
            $emp = Employee::with(['department', 'designation'])->findOrFail((int) $data['employee_id']);

            // Resolve workflow signers against real users at SEND time so a
            // later re-org of reporting lines doesn't retroactively change
            // who's on the hook for an in-flight document.
            $signersTpl = is_array($tpl->signers) ? $tpl->signers : [];
            $resolved = [];
            foreach ($signersTpl as $i => $s) {
                $roleName = (string) ($s['role_name'] ?? '');
                [$userId, $displayName] = $this->resolveSignerUser($roleName, $emp);
                $resolved[] = [
                    'index'        => $i,
                    'role_name'    => $roleName,
                    'action'       => (string) ($s['action'] ?? 'Sign'),
                    'days'         => (int)    ($s['days']   ?? 3),
                    'user_id'      => $userId,
                    'name'         => $displayName,
                    'status'       => 'Pending',           // Pending | Done | Skipped
                    'acted_at'     => null,
                    'signed_name'  => null,                // typed name for Sign
                    'note'         => null,
                ];
            }

            // Resolve placeholders to lock the body text at send time.
            $hrTplController = new HrDocumentTemplateController();
            $ref = new \ReflectionClass($hrTplController);
            $buildCtx = $ref->getMethod('buildTokenContext'); $buildCtx->setAccessible(true);
            $resolve  = $ref->getMethod('resolveTokens');     $resolve->setAccessible(true);
            $ctx = $buildCtx->invoke($hrTplController, $emp->loadMissing(['client']), $signersTpl);
            $frozenHtml = $resolve->invoke($hrTplController, (string) $tpl->content_html, $ctx);

            $row = HrDocumentSignature::create([
                'client_id'      => $emp->client_id,
                'branch_id'      => $emp->branch_id,
                'template_id'    => $tpl->id,
                'employee_id'    => $emp->id,
                'code'           => $tpl->code,
                'content_html'   => $frozenHtml,
                'header_config'  => $tpl->header_config,
                'footer_config'  => $tpl->footer_config,
                'signers'        => $resolved,
                'current_index'  => 0,
                'status'         => 'Pending',
                'audit_log'      => [$this->event($user, 'sent', "Document {$tpl->code} sent for signing")],
                'created_by'     => $user?->id,
            ]);
            $row->load(self::WITH);
            return response()->json($row, 201);
        });
    }

    /* ───── TAKE ACTION ───── */

    public function action(Request $request, $id)
    {
        $data = $request->validate([
            'action'      => ['required', Rule::in(['Sign', 'Approve', 'Acknowledge'])],
            'signed_name' => 'nullable|string|max:120',
            'note'        => 'nullable|string|max:500',
        ]);

        return DB::transaction(function () use ($request, $data, $id) {
            $user = $request->user();
            $row  = $this->loadForAction($request, (int) $id);
            $idx  = (int) $row->current_index;
            $signers = $row->signers;
            $current = $signers[$idx] ?? null;
            if (!$current) abort(404, 'No pending signer on this document.');
            if ((int) ($current['user_id'] ?? 0) !== (int) $user->id) {
                abort(403, "You're not the current signer on this document.");
            }

            // For Sign rows we require a typed name and fill the
            // {{SignerNSign}} token so the next viewer sees the signature.
            if (($current['action'] ?? '') === 'Sign') {
                $name = trim((string) ($data['signed_name'] ?? ''));
                if ($name === '') abort(422, 'Typed signature is required for Sign step.');
                $current['signed_name'] = $name;
                $rowHtml = $row->content_html ?: '';
                $n = $idx + 1;
                $signMarker = sprintf('<span style="font-family: \'Brush Script MT\', cursive; font-size: 22px; color: #1d4ed8;">%s</span>', htmlspecialchars($name, ENT_QUOTES));
                $rowHtml = str_replace("{{Signer{$n}Sign}}", $signMarker, $rowHtml);
                $rowHtml = str_replace("{{Signer{$n}Date}}", date('d M Y'), $rowHtml);
                $row->content_html = $rowHtml;
            } else {
                $current['note'] = $data['note'] ?? null;
            }

            $current['status']   = 'Done';
            $current['acted_at'] = now()->toIso8601String();
            $signers[$idx] = $current;
            $row->signers = $signers;

            // Advance to the next signer; if none left, the workflow is done.
            $next = $idx + 1;
            if ($next >= count($signers)) {
                $row->status = 'Completed';
            } else {
                $row->current_index = $next;
                $row->status = 'In Progress';
            }

            $row->audit_log = array_merge($row->audit_log ?? [], [
                $this->event($user, strtolower(($current['action'] ?? 'action')) , sprintf(
                    '%s by %s%s',
                    $current['action'] ?? 'Action taken',
                    $user?->name ?? '(unknown)',
                    !empty($data['signed_name']) ? " (signed: {$data['signed_name']})" : ''
                )),
            ]);
            $row->save();
            $row->load(self::WITH);

            return response()->json($row);
        });
    }

    public function reject(Request $request, $id)
    {
        $data = $request->validate(['reason' => 'required|string|max:500']);
        return DB::transaction(function () use ($request, $data, $id) {
            $user = $request->user();
            $row  = $this->loadForAction($request, (int) $id);
            $idx  = (int) $row->current_index;
            $signers = $row->signers;
            $current = $signers[$idx] ?? null;
            if (!$current) abort(404);
            if ((int) ($current['user_id'] ?? 0) !== (int) $user->id) abort(403);

            $current['status']   = 'Rejected';
            $current['acted_at'] = now()->toIso8601String();
            $current['note']     = $data['reason'];
            $signers[$idx] = $current;
            $row->signers = $signers;
            $row->status  = 'Rejected';
            $row->audit_log = array_merge($row->audit_log ?? [], [
                $this->event($user, 'rejected', "Rejected by {$user?->name}: {$data['reason']}"),
            ]);
            $row->save();
            $row->load(self::WITH);
            return response()->json($row);
        });
    }

    public function cancel(Request $request, $id)
    {
        $row = $this->loadForAction($request, (int) $id);
        $user = $request->user();
        if ($row->created_by !== $user?->id && $user?->user_type !== 'super_admin' && $user?->user_type !== 'client_admin') {
            abort(403, 'Only the sender or an admin can cancel this workflow.');
        }
        $row->status = 'Cancelled';
        $row->audit_log = array_merge($row->audit_log ?? [], [
            $this->event($user, 'cancelled', "Cancelled by {$user?->name}"),
        ]);
        $row->save();
        $row->load(self::WITH);
        return response()->json($row);
    }

    /* ───── HELPERS ───── */

    private function loadForAction(Request $request, int $id): HrDocumentSignature
    {
        $q = HrDocumentSignature::query();
        $this->applyScope($q, $request->user());
        return $q->findOrFail($id);
    }

    /**
     * Map a template signer role to a real user_id + display name.
     * Falls back to null user_id with a placeholder name so the admin can
     * still send the doc and re-assign manually later.
     */
    private function resolveSignerUser(string $roleName, Employee $emp): array
    {
        $r = strtolower(trim($roleName));
        if (str_contains($r, 'reporting')) {
            $mgr = $emp->reporting_manager_id
                ? Employee::with('user')->find($emp->reporting_manager_id)
                : null;
            return [$mgr?->user_id ?? null, $mgr?->display_name ?? 'Reporting Manager (unassigned)'];
        }
        if (str_contains($r, 'employee')) {
            return [$emp->user_id ?? null, $emp->display_name ?? 'Employee'];
        }
        if (str_contains($r, 'ceo') || str_contains($r, 'client')) {
            // Pick the first client_admin in this client as the CEO stand-in.
            $admin = $emp->client_id
                ? User::where('client_id', $emp->client_id)->where('user_type', 'client_admin')->first()
                : null;
            return [$admin?->id ?? null, $admin?->name ?? 'Client (CEO) (unassigned)'];
        }
        return [null, $roleName ?: 'Unassigned'];
    }

    private function event($user, string $action, string $message): array
    {
        return [
            'at'         => now()->toIso8601String(),
            'actor_id'   => $user?->id,
            'actor_name' => $user?->name ?? '(system)',
            'action'     => $action,
            'message'    => $message,
        ];
    }

    /** Same tenant-scope rules as the template controller. */
    private function applyScope($q, $user, ?int $branchFilter = null): void
    {
        if (!$user) return;
        if ($user->user_type === 'super_admin') {
            if ($branchFilter !== null) $q->where('branch_id', $branchFilter);
            return;
        }
        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            $q->where(function ($w) use ($user) {
                $w->whereNull('client_id')->orWhere('client_id', $user->client_id);
            });
            return;
        }
        if (in_array($user->user_type, ['branch_user', 'employee'], true)) {
            $clientId = $user->client_id;
            $branchId = $user->branch_id;
            $q->where(function ($w) use ($clientId, $branchId, $user) {
                $w->where('client_id', $clientId)
                  // employees can also see their OWN documents even if the
                  // row belongs to a different branch (they're the subject)
                  ->orWhere('employee_id', $user->employee_id);
            });
            return;
        }
        $q->whereRaw('1 = 0');
    }
}
