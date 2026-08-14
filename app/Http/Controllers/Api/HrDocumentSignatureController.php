<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\SignedDocumentMail;
use App\Models\Employee;
use App\Models\HrDocumentSignature;
use App\Models\HrDocumentTemplate;
use App\Models\HrGeneratedDocument;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;


class HrDocumentSignatureController extends Controller
{
    private const WITH = [
        'template:id,code,name,doc_type,signing_mode,trigger_point_id',
        'template.triggerPoint:id,module_name',
        'employee:id,first_name,last_name,display_name,emp_code,department_id,designation_id,reporting_manager_id,reporting_manager_user_id,user_id',
        'employee.department:id,name',
        'employee.designation:id,name,level',
        'creator:id,name',
        // Needed by HrDocumentSignature::getHeaderConfigAttribute(), which
        // falls back to the branch (then client) logo when the template
        // carries none. Eager-loaded so the list endpoints don't fire one
        // query per row resolving the header logo.
        'branch:id,name,logo',
        'client:id,org_name,logo',
    ];

    private const STATUSES = ['Pending', 'In Progress', 'Completed', 'Rejected', 'Cancelled'];
    private const ACTIONS  = ['Sign', 'Approve', 'Review & Acknowledge'];

    /** Parallel signing = every configured signer can act at the SAME time
     *  (the document lands in ALL their inboxes at once, not one-by-one).
     *  Sequential = strictly in order via current_index. Derived from the
     *  source template's signing_mode (so an in-flight run honours the mode
     *  the template was sent under). */
    private function isParallel($row): bool
    {
        return strtolower((string) ($row->template?->signing_mode ?? 'sequential')) === 'parallel';
    }

    /* ───── LIST / INBOX / SHOW ───── */

    public function index(Request $request)
    {
        $q = HrDocumentSignature::query()->with(self::WITH);
        $this->applyScope($q, $request->user());

        /* An employee_id that is PRESENT but not a positive integer must narrow
         * to nothing, never widen to everything. `$request->integer()` turns a
         * non-numeric value into 0, and the old `if ($empId = ...)` then read
         * that as "no filter asked for" and returned every run in the tenant —
         * so a caller passing an encrypted id (as the employee profile did) got
         * the whole company's signed documents back. Filters fail closed. */
        if ($request->has('employee_id')) {
            $q->where('employee_id', $request->integer('employee_id'));
        }
        if ($status = $request->query('status'))          $q->where('status', $status);
        if ($tplId  = $request->integer('template_id'))   $q->where('template_id', $tplId);

        $rows = $q->orderByDesc('id')->get();
        return response()->json($rows->map(function ($row) {
            $triggerPointName = $row->template?->triggerPoint?->module_name ?? null;
            $triggerKeyword = $this->inferTriggerKeyword($triggerPointName, $row->template?->doc_type);

            $row->setAttribute('trigger_point_name', $triggerPointName);
            $row->setAttribute('trigger_keyword', $triggerKeyword);
            return $row;
        }));
    }

    /**
     * Inbox = signature runs where the CURRENT user is the next signer.
     * Returned shape mirrors `index` so the same row component renders both.
     */
    public function inbox(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        // history=1 → the "Updated" tab: documents this user has ALREADY
        // acted on (signed / approved / acknowledged / rejected), regardless
        // of the run's overall status. Default (no flag) → pending inbox.
        $history = $request->boolean('history');

        $q = HrDocumentSignature::query()->with(self::WITH);
        if (!$history) $q->whereIn('status', ['Pending', 'In Progress']);
        $this->applyScope($q, $user);

        if ($history) {
            $rows = $q->orderByDesc('id')->get()->filter(function ($row) use ($user) {
                $signers = is_array($row->signers) ? $row->signers : [];
                foreach ($signers as $s) {
                    if ((int) ($s['user_id'] ?? 0) === (int) $user->id
                        && in_array($s['status'] ?? 'Pending', ['Done', 'Rejected'], true)) {
                        return true;
                    }
                }
                return false;
            })->values();
            return response()->json($rows);
        }

        // Filter in PHP since signer matching is JSON-shape-specific.
        $rows = $q->orderByDesc('id')->get()->filter(function ($row) use ($user) {
            $signers = is_array($row->signers) ? $row->signers : [];
            if ($this->isParallel($row)) {
                // Parallel: the doc is in EVERY not-yet-acted signer's inbox at
                // once — show it if THIS user is any pending signer.
                foreach ($signers as $s) {
                    if ((int) ($s['user_id'] ?? 0) === (int) $user->id
                        && !in_array($s['status'] ?? 'Pending', ['Done', 'Rejected', 'Skipped'], true)) {
                        return true;
                    }
                }
                return false;
            }
            // Sequential: only the current_index signer's turn.
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
            // Custom field values entered in the Generate wizard (token => value).
            // Merged into the frozen content_html so a doc sent for signature
            // keeps the edits the user filled in (e.g. {{TEST}} → "sssss").
            'custom_values'   => 'nullable|array',
            'custom_values.*' => 'nullable',
        ]);

        return DB::transaction(function () use ($request, $data) {
            $user = $request->user();

            $tpl = HrDocumentTemplate::findOrFail((int) $data['template_id']);
            $emp = Employee::with(['department', 'designation'])->findOrFail((int) $data['employee_id']);

            // When Send is fired from a document row (no custom_values in the
            // request), inherit the values the user filled when they last
            // "Save Generated" for this template + employee. This keeps the
            // generate-then-send-from-outside flow lossless: the signed copy
            // carries the same custom-field edits as the saved generated doc.
            $customValues = (array) ($data['custom_values'] ?? []);
            if (empty($customValues)) {
                $lastGenerated = HrGeneratedDocument::where('template_id', $tpl->id)
                    ->where('employee_id', $emp->id)
                    ->orderByDesc('id')
                    ->first();
                if ($lastGenerated && is_array($lastGenerated->custom_values)) {
                    $customValues = $lastGenerated->custom_values;
                }
            }

            // Idempotency guard — a fast double-submit (double-click on Send)
            // was creating two identical in-flight signature runs for the same
            // template + employee. If an ACTIVE run already exists (Pending or
            // In Progress), return it instead of creating a duplicate. The
            // lockForUpdate serialises concurrent sends so the second request
            // waits for the first to commit, then sees it and bails out.
            $existing = HrDocumentSignature::where('template_id', $tpl->id)
                ->where('employee_id', $emp->id)
                ->whereIn('status', ['Pending', 'In Progress'])
                ->lockForUpdate()
                ->first();
            if ($existing) {
                $existing->load(self::WITH);
                return response()->json($existing, 200);
            }

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

            // Resolve placeholders to lock the body text at send time. The
            // per-signer Sign/Date tokens are intentionally NOT substituted
            // here — they're filled in by the action handler when each
            // signer acts, so we pass preserveSignerSlots=true to keep the
            // {{Signer{N}Sign}} / {{Signer{N}Date}} placeholders intact in
            // the frozen content_html.
            $hrTplController = new HrDocumentTemplateController();
            $ref = new \ReflectionClass($hrTplController);
            $buildCtx = $ref->getMethod('buildTokenContext'); $buildCtx->setAccessible(true);
            $resolve  = $ref->getMethod('resolveTokens');     $resolve->setAccessible(true);
            $ctx = $buildCtx->invoke($hrTplController, $emp->loadMissing(['client']), $signersTpl);
            // Overlay the wizard-entered custom field values onto the token
            // context so {{CustomToken}} placeholders are frozen with the
            // user's edits (not left blank) at send time.
            foreach ($customValues as $k => $v) {
                if (is_scalar($v)) {
                    $ctx[(string) $k] = (string) $v;
                }
            }
            $frozenHtml = $resolve->invoke($hrTplController, (string) $tpl->content_html, $ctx, true);

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
            'action'          => ['required', Rule::in(['Sign', 'Approve', 'Acknowledge'])],
            'signed_name'     => 'nullable|string|max:120',
            // base64 PNG data URL from the signature pad. Loose `string` rule
            // here — strict shape ("data:image/png;base64,...") is enforced
            // inside the transaction so we can give a friendlier 422 message.
            // Max 4 MB binary ≈ 5.4 MB base64 + ~30 chars for the data: prefix.
            // Anything larger is rejected here AND by persistSignatureImage().
            'signature_image' => 'nullable|string|max:5600000',
            'note'            => 'nullable|string|max:500',
            // Explicit "I have read and understood this document" tick. Only
            // meaningful on a Sign step, where it is MANDATORY (checked below
            // so the message can name the action).
            'consent'         => 'nullable|boolean',
        ]);

        return DB::transaction(function () use ($request, $data, $id) {
            $user = $request->user();
            $row  = $this->loadForAction($request, (int) $id);
            $signers = $row->signers;
            $parallel = $this->isParallel($row);

            if ($parallel) {
                // Parallel: act on THIS user's own pending signer slot, wherever
                // it sits in the list (not gated by current_index).
                $idx = null;
                foreach ($signers as $i => $s) {
                    if ((int) ($s['user_id'] ?? 0) === (int) $user->id
                        && !in_array($s['status'] ?? 'Pending', ['Done', 'Rejected', 'Skipped'], true)) {
                        $idx = $i;
                        break;
                    }
                }
                if ($idx === null) abort(403, "You're not a pending signer on this document.");
            } else {
                // Sequential: only the current_index signer may act.
                $idx = (int) $row->current_index;
                $cur = $signers[$idx] ?? null;
                if (!$cur) abort(404, 'No pending signer on this document.');
                if ((int) ($cur['user_id'] ?? 0) !== (int) $user->id) {
                    abort(403, "You're not the current signer on this document.");
                }
            }
            $current = $signers[$idx] ?? null;
            if (!$current) abort(404, 'No pending signer on this document.');

            // Informed-consent gate — required for EVERY action (Sign, Approve
            // and Acknowledge). The UI disables the action button until the box
            // is ticked; this is the server-side backstop so a direct API call
            // can't act without it. Recorded on the signer slot + audit trail:
            // in an approval workflow, WHEN consent was given is part of the
            // evidence, not just a UI nicety.
            if (!filter_var($data['consent'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
                $verb = strtolower((string) ($current['action'] ?? 'act on'));
                abort(422, "You must confirm you have read and understood the document before you {$verb} it.");
            }
            $current['consent_at'] = now()->toIso8601String();

            // For Sign rows we require a typed name (always logged in the
            // audit trail) and fill the {{SignerNSign}} token. The signer
            // can additionally upload a drawn signature — when present, the
            // token is replaced with an <img>; otherwise we fall back to
            // the original cursive-rendered text.
            if (($current['action'] ?? '') === 'Sign') {
                $name = trim((string) ($data['signed_name'] ?? ''));
                if ($name === '') abort(422, 'Typed signature is required for Sign step.');
                $current['signed_name'] = $name;

                $signImgUrl = null;
                if (!empty($data['signature_image'])) {
                    $signImgUrl = $this->persistSignatureImage(
                        (string) $data['signature_image'],
                        $row->client_id,
                        (int) $row->id,
                        $idx + 1,
                    );
                    if ($signImgUrl) $current['signature_url'] = $signImgUrl;
                }

                $rowHtml = $row->content_html ?: '';
                $n = $idx + 1;
                $signMarker = $signImgUrl
                    ? sprintf('<img src="%s" alt="Signature of %s" style="max-height: 60px; max-width: 220px; vertical-align: middle;" />', htmlspecialchars($signImgUrl, ENT_QUOTES), htmlspecialchars($name, ENT_QUOTES))
                    : sprintf('<span style="font-family: \'Brush Script MT\', cursive; font-size: 22px; color: #1d4ed8;">%s</span>', htmlspecialchars($name, ENT_QUOTES));
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

            if ($parallel) {
                // Parallel: the run is done only when EVERY signer has acted;
                // until then it stays In Progress and any remaining signer can
                // still sign from their own inbox. current_index just points at
                // the first still-pending slot (cosmetic / reminder target).
                $allActed = collect($signers)->every(
                    fn ($s) => in_array($s['status'] ?? '', ['Done', 'Skipped'], true)
                );
                $firstPending = collect($signers)->search(fn ($s) => ($s['status'] ?? '') === 'Pending');
                $row->current_index = $firstPending === false ? count($signers) : (int) $firstPending;
                $row->status = $allActed ? 'Completed' : 'In Progress';
            } else {
                // Sequential: advance to the next signer; done when none left.
                $next = $idx + 1;
                if ($next >= count($signers)) {
                    $row->status = 'Completed';
                } else {
                    $row->current_index = $next;
                    $row->status = 'In Progress';
                }
            }

            // Audit detail. Consent is logged for EVERY action, not just Sign —
            // an approval/acknowledgement carries the same "I have read and
            // understood this" claim and needs the same evidence trail.
            $auditParts = [];
            if (!empty($data['signed_name'])) {
                $auditParts[] = "signed: {$data['signed_name']}";
            }
            if (!empty($current['signature_url'])) {
                $auditParts[] = 'drawn signature attached';
            }
            if (!empty($current['consent_at'])) {
                $auditParts[] = 'consent confirmed';
            }
            $signSuffix = $auditParts ? ' (' . implode(' · ', $auditParts) . ')' : '';
            $row->audit_log = array_merge($row->audit_log ?? [], [
                $this->event($user, strtolower(($current['action'] ?? 'action')), sprintf(
                    '%s by %s%s',
                    $current['action'] ?? 'Action taken',
                    $user?->name ?? '(unknown)',
                    $signSuffix
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

    /**
     * Send a reminder email to the CURRENT pending signer on an
     * in-flight workflow. HR uses this when a signer has been sitting
     * on a doc — instead of pinging them on chat, click Reminder and
     * the system emails them a polite nudge with the document link.
     *
     * Behaviour:
     *  - Only fires on Pending / In Progress runs (Completed / Rejected
     *    / Cancelled don't have a "current signer" to remind).
     *  - Only emails the signer whose turn it is (sequential mode);
     *    the rest are still waiting their turn and shouldn't get
     *    reminders yet.
     *  - Audit-logs the reminder so the admin can see how many nudges
     *    have been sent from the Audit Trail timeline.
     *  - Throttles to once per 6 hours per signer to avoid spam if HR
     *    clicks the button repeatedly.
     */
    public function remind(Request $request, $id)
    {
        $row = $this->loadForRead($request, (int) $id);
        $row->load(self::WITH);

        if (!in_array($row->status, ['Pending', 'In Progress'], true)) {
            abort(422, 'Reminders only apply to in-flight workflows. Current status: ' . $row->status);
        }

        $signers = $row->signers ?? [];
        $idx = (int) ($row->current_index ?? 0);
        $current = $signers[$idx] ?? null;
        if (!$current) {
            abort(422, 'No active signer found on this workflow.');
        }

        $userId = (int) ($current['user_id'] ?? 0);
        if (!$userId) {
            abort(422, 'The current signer has no user account linked — reminder cannot be sent.');
        }

        $signerUser = \App\Models\User::find($userId);
        $signerName = $current['name'] ?? ($signerUser?->name ?? 'Signer');

        // Throttle — bail if a reminder went out for THIS signer in the
        // last 6 hours. Cheap protection against accidental double-click
        // and intentional spam. Look at the audit log for the marker.
        $sixHoursAgo = now()->subHours(6);
        $recent = collect($row->audit_log ?? [])
            ->filter(function ($ev) use ($idx, $sixHoursAgo) {
                if (($ev['action'] ?? null) !== 'reminded') return false;
                if (($ev['signer_index'] ?? null) !== $idx) return false;
                try {
                    return \Carbon\Carbon::parse($ev['at'])->greaterThan($sixHoursAgo);
                } catch (\Throwable $e) {
                    return false;
                }
            })
            ->isNotEmpty();
        if ($recent) {
            abort(429, 'A reminder was already sent to this signer in the last 6 hours. Please wait before sending another.');
        }

        $tplName = $row->template?->name ?: 'a document';
        $docCode = $row->code ?: ('doc-' . $row->id);
        $action  = $current['action'] ?? 'Sign';
        $senderName = $request->user()?->name ?: 'HR';

        // In-app notification — drop a row into the Laravel notifications
        // table so the signer's bell icon flashes. NO email. The doc is
        // already in the signer's HR Inbox (the inbox() endpoint returns
        // every pending row where they're the current signer), so this
        // notification just pulls their attention to it.
        if ($signerUser) {
            try {
                \Illuminate\Support\Facades\DB::table('notifications')->insert([
                    'id'              => (string) \Illuminate\Support\Str::uuid(),
                    'type'            => 'App\\Notifications\\HrSignatureReminder',
                    'notifiable_type' => \App\Models\User::class,
                    'notifiable_id'   => $signerUser->id,
                    'data'            => json_encode([
                        'kind'        => 'hr_signature_reminder',
                        'document_id' => $row->id,
                        'code'        => $docCode,
                        'template'    => $tplName,
                        'action'      => $action,
                        'sender_name' => $senderName,
                        'message'     => "{$senderName} reminded you to {$action} {$docCode} — {$tplName}.",
                        'url'         => '/inbox',
                    ]),
                    'read_at'         => null,
                    'created_at'      => now(),
                    'updated_at'      => now(),
                ]);
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning('[hr-document-signatures] reminder notification insert failed', [
                    'id'  => $row->id,
                    'err' => $e->getMessage(),
                ]);
                // Don't fail the whole request if the notification insert
                // hiccups — audit log still records the reminder action.
            }
        }

        // Append audit event with signer_index so the throttle check
        // and the audit trail UI can both see who got reminded when.
        $row->audit_log = array_merge($row->audit_log ?? [], [
            array_merge(
                $this->event($request->user(), 'reminded', "Reminder sent to {$signerName} (in-app Inbox)"),
                ['signer_index' => $idx],
            ),
        ]);
        $row->save();

        return response()->json([
            'message' => 'Reminder sent — the signer will see it in their Inbox.',
            'signer'  => $signerName,
        ]);
    }

    /* ───── SIGNED OUTPUT (download + email) ───── */

    /**
     * Per-employee list — returns the signature runs targeting an employee.
     * Accepts either the numeric id or the EMP-### code as `{slug}` so the
     * Employee Profile (which only knows the emp_code) doesn't need a
     * separate resolve hop. Defaults to status=Completed but the SPA can
     * widen with ?status=all to include in-flight runs.
     */
    public function forEmployee(Request $request, $slug)
    {
        $emp = is_numeric($slug)
            ? Employee::find((int) $slug)
            : Employee::where('emp_code', $slug)->first();
        if (!$emp) abort(404, 'Employee not found');

        $status = (string) $request->query('status', 'Completed');
        $q = HrDocumentSignature::query()->with(self::WITH)
            ->where('employee_id', $emp->id);
        if ($status !== 'all') $q->where('status', $status);

        $this->applyScope($q, $request->user());
        $rows = $q->orderByDesc('id')->get();

        return response()->json($rows->map(function ($row) {
            $triggerPointName = $row->template?->triggerPoint?->module_name
                                 ?? $row->template?->trigger_point_name
                                 ?? null;
            $triggerKeyword = $this->inferTriggerKeyword($triggerPointName, $row->template?->doc_type);

            $row->setAttribute('trigger_point_name', $triggerPointName);
            $row->setAttribute('trigger_keyword', $triggerKeyword);
            return $row;
        }));
    }

    private function inferTriggerKeyword(?string $triggerPointName, ?string $docType): ?string
    {
        $source = strtolower(trim((string) ($triggerPointName ?: $docType ?: '')));
        if ($source === '') {
            return null;
        }

        if (str_contains($source, 'onboarding')) {
            return 'onboarding';
        }
        if (str_contains($source, 'exit')) {
            return 'exit';
        }
        if (str_contains($source, 'employee')) {
            return 'employee';
        }

        return null;
    }

    /**
     * PDF version of the signed document. Wraps the frozen content_html
     * in the same fixed-height header/footer chrome and pipes it through
     * DomPDF. Used by the Employee Profile so employees can self-serve a
     * portable copy without needing Word installed.
     */
    public function downloadSignedPdf(Request $request, $id)
    {
        $row = $this->loadForRead($request, (int) $id);
        $row->load(self::WITH);

        $headerCfg = is_array($row->header_config) ? $row->header_config : [];
        $footerCfg = is_array($row->footer_config) ? $row->footer_config : [];
        $logoUrl = null;
        // Prefer the path saved in header_config; if the frontend never
        // persisted it, fall back to the most recently uploaded logo for this
        // client — the same fallback the DOCX renderer uses — so the PDF
        // header still carries a logo instead of just the company text.
        $logoPath = !empty($headerCfg['logo_path'])
            ? (string) $headerCfg['logo_path']
            : (new HrDocumentTemplateController())->latestClientLogo($row->client_id);
        if (!empty($logoPath)) {
            $disk = Storage::disk('public');
            $logoPath = ltrim($logoPath, '/');
            if ($disk->exists($logoPath)) {
                // Inline as data URI — DomPDF can't reach the storage URL
                // because of relative-path resolution in headless renders, and
                // reading through the disk (not storage_path) keeps this
                // working when the public disk is Azure Blob on the server.
                // Normalise the extension to a valid MIME — "jpg" is the
                // common file extension but "image/jpg" is not a valid type;
                // it must be "image/jpeg" or some PDF readers refuse to
                // decode the embedded image.
                $ext = strtolower((string) pathinfo($logoPath, PATHINFO_EXTENSION));
                $mime = match ($ext) {
                    'jpg', 'jpeg' => 'image/jpeg',
                    'svg'         => 'image/svg+xml',
                    ''            => 'image/png',
                    default       => 'image/' . $ext,
                };
                $logoUrl = 'data:' . $mime . ';base64,' . base64_encode((string) $disk->get($logoPath));
            }
        }

        $pdf = \Barryvdh\DomPDF\Facade\Pdf::loadView('pdf.signed-document', [
            'row'        => $row,
            'header'     => $headerCfg,
            'footer'     => $footerCfg,
            'logoDataUri'=> $logoUrl,
            // Inline any storage-served <img> URLs (signatures, embedded
            // images) as base64 data URIs. DomPDF runs headless and can't
            // fetch /storage/... over HTTP — same workaround as the header
            // logo above.
            'bodyHtml'   => $this->inlineLocalImagesAsDataUris(
                (string) ($row->content_html ?: '<p>(empty)</p>')
            ),
        ]);
        $pdf->setPaper('A4');

        $filename = ($row->code ?: ('doc-' . $row->id)) . '-signed.pdf';
        return $pdf->download($filename);
    }

    /**
     * Stream the run's current content as a DOCX. For a completed run this
     * is the final signed copy (every {{SignerNSign}} has been replaced
     * with the signer's typed name). For an in-flight run it still works —
     * the signatures collected so far are baked in; unsigned spots stay
     * as their placeholder tokens.
     */
    public function downloadSigned(Request $request, $id)
    {
        $row = $this->loadForRead($request, (int) $id);
        $filename = ($row->code ?: ('doc-' . $row->id)) . '-signed.docx';
        return (new HrDocumentTemplateController())->renderDocx($row, $filename);
    }

    /**
     * Email the signed DOCX to the subject employee. Records an audit
     * event so the sender can see the document was dispatched (and to
     * whom) from the audit trail modal.
     */
    public function emailToEmployee(Request $request, $id)
    {
        $row = $this->loadForRead($request, (int) $id);
        $row->load(self::WITH);

        if ($row->status !== 'Completed') {
            abort(422, 'Only completed workflows can be emailed. Current status: ' . $row->status);
        }

        $emp = $row->employee;
        $email = $emp?->email;
        if (!$email) {
            abort(422, 'Subject employee has no email address on file.');
        }

        $orgName = $emp->client?->org_name
            ?? $request->user()?->client?->org_name
            ?? config('mail.from.name', 'HR');
        $recipientName = $emp->display_name
            ?: trim(($emp->first_name ?? '') . ' ' . ($emp->last_name ?? ''))
            ?: $email;
        $filename = ($row->code ?: ('doc-' . $row->id)) . '-signed.docx';

        $tmp = (new HrDocumentTemplateController())->buildDocxFile($row);

        try {
            Mail::to($email)->send(new SignedDocumentMail(
                $row, $tmp, $filename, $recipientName, $orgName,
            ));
        } catch (\Throwable $e) {
            Log::error('[hr-document-signatures] email failed', ['id' => $row->id, 'err' => $e->getMessage()]);
            @unlink($tmp);
            abort(500, 'Email delivery failed: ' . $e->getMessage());
        }
        @unlink($tmp);

        $user = $request->user();
        $row->audit_log = array_merge($row->audit_log ?? [], [
            $this->event($user, 'emailed', "Signed document emailed to {$recipientName} <{$email}>"),
        ]);
        $row->save();

        return response()->json([
            'message' => 'Signed document emailed.',
            'sent_to' => $email,
        ]);
    }

    /** Same applyScope wrapper as elsewhere, scoped for read-only fetches. */
    private function loadForRead(Request $request, int $id): HrDocumentSignature
    {
        $q = HrDocumentSignature::query();
        $this->applyScope($q, $request->user());
        return $q->findOrFail($id);
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
            // Two paths — employees.reporting_manager_id points to an
            // Employee row (the common case), but employees.reporting_
            // manager_user_id points to a User row when the manager is a
            // Branch User / Client admin who doesn't have an Employee
            // record. Try the Employee path first (most specific), then
            // fall back to the direct User lookup. Without this fallback,
            // a Branch-User reporting manager surfaced as "(unassigned)"
            // on every signature workflow.
            if ($emp->reporting_manager_id) {
                $mgr = Employee::with('user')->find($emp->reporting_manager_id);
                if ($mgr) {
                    return [$mgr->user_id ?? null, $mgr->display_name ?? 'Reporting Manager'];
                }
            }
            if ($emp->reporting_manager_user_id) {
                $u = User::find($emp->reporting_manager_user_id);
                if ($u) {
                    return [$u->id, $u->name ?: ('Reporting Manager (' . $u->email . ')')];
                }
            }
            return [null, 'Reporting Manager (unassigned)'];
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

    /**
     * Decode a `data:image/...;base64,...` payload from the SignaturePad
     * (Type/Draw modes emit PNG, Upload mode can yield PNG/JPG/GIF/WEBP/SVG)
     * and persist it under the tenant's public-disk folder. Returns the
     * public URL on success, or null if the payload doesn't look like a
     * valid base64 image — we don't abort, the signer can still proceed
     * with the typed cursive fallback.
     */
    private function persistSignatureImage(string $dataUrl, ?int $clientId, int $runId, int $signerN): ?string
    {
        if (!preg_match('#^data:image/(png|jpe?g|gif|webp|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$#i', trim($dataUrl), $m)) {
            return null;
        }
        $mime = strtolower($m[1]);
        $ext = match ($mime) {
            'jpg', 'jpeg' => 'jpg',
            'svg+xml'     => 'svg',
            default       => $mime,
        };
        $binary = base64_decode(preg_replace('/\s+/', '', $m[2]) ?: '', true);
        // Hard cap at ~4 MB — matches the SignaturePad Upload tab limit. A
        // typed/drawn signature is typically under 30 KB; this only kicks in
        // for uploaded photo-style images.
        if ($binary === false || strlen($binary) === 0 || strlen($binary) > 4 * 1024 * 1024) {
            return null;
        }
        $clientSlug = $clientId ? 'c' . $clientId : 'public';
        $folder = "doc_templates/{$clientSlug}/signatures";
        $filename = sprintf('run%d-s%d-%s.%s', $runId, $signerN, Str::random(10), $ext);
        try {
            Storage::disk('public')->put($folder . '/' . $filename, $binary, 'public');
        } catch (\Throwable $e) {
            Log::error('[hr-document-signatures] save signature image failed', [
                'run' => $runId, 'signer' => $signerN, 'err' => $e->getMessage(),
            ]);
            return null;
        }
        return file_url($folder . '/' . $filename);
    }

    /**
     * Rewrite every <img src="..."> in $html that points to a storage-served
     * URL (or a /storage/... relative path) into a base64 data URI, reading
     * the file from the public disk. Skips srcs that are already data URIs
     * or remote URLs we can't resolve. DomPDF runs headless and can't reach
     * /storage/... over HTTP, so without this signatures render as broken
     * images (or, depending on DomPDF settings, as nothing at all).
     */
    private function inlineLocalImagesAsDataUris(string $html): string
    {
        return preg_replace_callback(
            '#<img\b([^>]*?)\bsrc=([\'"])(.*?)\2([^>]*)>#i',
            function ($mm) {
                [$full, $pre, $quote, $src, $post] = $mm;
                if ($src === '' || str_starts_with($src, 'data:')) return $full;

                // Resolve the src to a path on the public disk. Handle three
                // common shapes: absolute URLs hosted on this app's storage,
                // /storage/... relative paths, and bare disk-relative paths.
                $diskPath = null;
                $parsed = parse_url($src);
                $path = $parsed['path'] ?? $src;
                if (preg_match('#/storage/(.+)$#', $path, $sm)) {
                    $diskPath = $sm[1];
                } elseif (!isset($parsed['scheme']) && !str_starts_with($path, '/')) {
                    $diskPath = ltrim($path, '/');
                }
                if (!$diskPath) return $full;

                try {
                    if (!Storage::disk('public')->exists($diskPath)) return $full;
                    $binary = Storage::disk('public')->get($diskPath);
                    $mime = Storage::disk('public')->mimeType($diskPath) ?: 'image/png';
                } catch (\Throwable $e) {
                    return $full;
                }
                $dataUri = 'data:' . $mime . ';base64,' . base64_encode($binary);
                return '<img' . $pre . 'src=' . $quote . $dataUri . $quote . $post . '>';
            },
            $html
        ) ?? $html;
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
