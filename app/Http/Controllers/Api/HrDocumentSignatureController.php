<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\StoreSignedDocumentPdf;
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
    private static function withRelations(): array
    {
        return [
            'template:id,code,name,doc_type,signing_mode,trigger_point_id,version',
            'template.triggerPoint:id,module_name',
            'employee' => fn ($r) => $r->withTrashed()->select(
                'id', 'first_name', 'last_name', 'display_name', 'emp_code',
                'department_id', 'designation_id', 'reporting_manager_id',
                'reporting_manager_user_id', 'user_id', 'deleted_at',
            ),
            'employee.department:id,name',
            'employee.designation:id,name,level',
            'creator:id,name',
            'branch:id,name,logo',
            'client:id,org_name,logo',
        ];
    }


    private function isParallel($row): bool
    {
        return strtolower((string) ($row->template?->signing_mode ?? 'sequential')) === 'parallel';
    }

    public function index(Request $request)
    {
        $q = HrDocumentSignature::query()->with(self::withRelations());
        $this->applyScope($q, $request->user());

        $viewer = $request->user();
        if ($viewer && $viewer->user_type === 'employee' && !$this->mayReadOthersDocuments($viewer)) {
            $q->where('employee_id', $viewer->employee_id ?: 0);
        } elseif ($request->has('employee_id')) {
            $q->where('employee_id', $request->integer('employee_id'));
        }
        if ($status = $request->query('status'))          $q->where('status', $status);
        if ($tplId  = $request->integer('template_id'))   $q->where('template_id', $tplId);

        $rows = $this->fillSignerDesignations($q->orderByDesc('id')->get());
        return response()->json($rows->map(function ($row) {
            $triggerPointName = $row->template?->triggerPoint?->module_name ?? null;
            $triggerKeyword = $this->inferTriggerKeyword($triggerPointName, $row->template?->doc_type);

            $row->setAttribute('trigger_point_name', $triggerPointName);
            $row->setAttribute('trigger_keyword', $triggerKeyword);
            return $row;
        }));
    }

    public function inbox(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $history = $request->boolean('history');

        $q = HrDocumentSignature::query()->with(self::withRelations());
        if (!$history) $q->whereIn('status', ['Pending', 'In Progress']);
        $this->applyScope($q, $user);

        if ($history) {
            $settled = ['Rejected', 'Cancelled', 'Completed'];
            $rows = $q->orderByDesc('id')->get()->filter(function ($row) use ($user, $settled) {
                $signers = is_array($row->signers) ? $row->signers : [];
                $isSigner = false;
                foreach ($signers as $s) {
                    if ((int) ($s['user_id'] ?? 0) !== (int) $user->id) continue;
                    $isSigner = true;
                    if (in_array($s['status'] ?? 'Pending', ['Done', 'Rejected'], true)) {
                        return true;
                    }
                }
                $isSettled = in_array((string) $row->status, $settled, true);
                if ($isSettled && (int) $row->created_by === (int) $user->id) {
                    return true;
                }
                return $isSigner && $isSettled;
            })->values();
            return response()->json($this->fillSignerDesignations($rows));
        }

        $rows = $q->orderByDesc('id')->get()->filter(function ($row) use ($user) {
            $signers = is_array($row->signers) ? $row->signers : [];
            if ($this->isParallel($row)) {
                foreach ($signers as $s) {
                    if ((int) ($s['user_id'] ?? 0) === (int) $user->id
                        && !in_array($s['status'] ?? 'Pending', ['Done', 'Rejected', 'Skipped'], true)) {
                        return true;
                    }
                }
                return false;
            }
            $idx     = (int) $row->current_index;
            $current = $signers[$idx] ?? null;
            if (!$current) return false;
            return (int) ($current['user_id'] ?? 0) === (int) $user->id
                && ($current['status'] ?? 'Pending') !== 'Done';
        })->values();

        return response()->json($this->fillSignerDesignations($rows));
    }

    public function show(Request $request, $id)
    {
        $q = HrDocumentSignature::query()->with(self::withRelations());
        $this->applyScope($q, $request->user());
        $row = $q->findOrFail((int) $id);
        $this->assertEmployeeMayRead($request->user(), $row);
        $this->fillSignerDesignations(collect([$row]));
        return response()->json($row);
    }

    public function previewSigners(Request $request)
    {
        $data = $request->validate([
            'template_id' => 'required|integer|exists:hr_document_templates,id',
            'employee_id' => 'required|integer|exists:employees,id',
        ]);

        $tpl = HrDocumentTemplate::findOrFail((int) $data['template_id']);
        $emp = Employee::with(['department', 'designation'])->findOrFail((int) $data['employee_id']);

        $user = $request->user();
        if ($user && $user->user_type !== 'super_admin') {
            if ((int) $tpl->client_id !== (int) $user->client_id
                || (int) $emp->client_id !== (int) $user->client_id) {
                abort(403, 'Out of scope.');
            }
        }

        $out = [];
        foreach ((is_array($tpl->signers) ? $tpl->signers : []) as $i => $s) {
            $roleName = (string) ($s['role_name'] ?? '');
            [$userId, $displayName, $designation] = $this->resolveSignerUser($roleName, $emp);
            $out[] = [
                'index'       => $i,
                'role_name'   => $roleName,
                'action'      => (string) ($s['action'] ?? 'Sign'),
                'user_id'     => $userId,
                'name'        => $displayName,
                'designation' => $designation ?: ($s['designation_name'] ?? null),
                'unassigned'  => $userId === null,
            ];
        }

        return response()->json($out);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'template_id' => 'required|integer|exists:hr_document_templates,id',
            'employee_id' => 'required|integer|exists:employees,id',
            'custom_values'   => 'nullable|array',
            'custom_values.*' => 'nullable',
        ]);

        return DB::transaction(function () use ($request, $data) {
            $user = $request->user();

            $tpl = HrDocumentTemplate::findOrFail((int) $data['template_id']);
            $emp = Employee::with(['department', 'designation'])->findOrFail((int) $data['employee_id']);

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

            $existing = HrDocumentSignature::where('template_id', $tpl->id)
                ->where('employee_id', $emp->id)
                ->whereIn('status', ['Pending', 'In Progress'])
                ->lockForUpdate()
                ->first();
            if ($existing) {
                $existing->load(self::withRelations());
                return response()->json($this->fillSignerDesignations(collect([$existing]))->first(), 200);
            }

            $signersTpl = is_array($tpl->signers) ? $tpl->signers : [];
            $resolved = [];
            foreach ($signersTpl as $i => $s) {
                $roleName = (string) ($s['role_name'] ?? '');
                [$userId, $displayName, $designation] = $this->resolveSignerUser($roleName, $emp);
                $resolved[] = [
                    'index'        => $i,
                    'role_name'    => $roleName,
                    'designation'  => $designation,
                    'action'       => (string) ($s['action'] ?? 'Sign'),
                    'days'         => (int)    ($s['days']   ?? 3),
                    'user_id'      => $userId,
                    'name'         => $displayName,
                    'status'       => 'Pending',
                    'acted_at'     => null,
                    'signed_name'  => null,
                    'note'         => null,
                ];
            }

            if (!$signersTpl) {
                abort(422, "\"{$tpl->name}\" has no signers configured, so there is nobody to send it to. Add a signer to the template first.");
            }
            $unresolved = array_values(array_filter(
                $resolved,
                fn ($r) => ($r['user_id'] ?? null) === null,
            ));
            if ($unresolved) {
                $roles = implode(', ', array_map(
                    fn ($r) => (string) ($r['role_name'] ?: 'Signer'),
                    $unresolved,
                ));
                $who = $emp->display_name ?: $emp->emp_code;
                abort(422, "Cannot send: no active user resolves to {$roles} for {$who}."
                    . ' Set that person on the employee record (or the template) and send again.');
            }

            $hrTplController = new HrDocumentTemplateController();
            $ref = new \ReflectionClass($hrTplController);
            $buildCtx = $ref->getMethod('buildTokenContext'); $buildCtx->setAccessible(true);
            $resolve  = $ref->getMethod('resolveTokens');     $resolve->setAccessible(true);
            $ctx = $buildCtx->invoke($hrTplController, $emp->loadMissing(['client']), $signersTpl);

            foreach ($resolved as $r) {
                $n = ((int) $r['index']) + 1;
                $ctx["Signer{$n}Name"] = (string) ($r['name'] ?? '');
                $ctx["Signer{$n}Role"] = (string) ($r['role_name'] ?? '');
            }

            foreach ($customValues as $k => $v) {
                if (is_scalar($v)) {
                    $ctx[(string) $k] = (string) $v;
                }
            }
            $rawHtmlNames = array_values(array_diff(
                HrDocumentTemplateController::RAW_HTML_TOKENS,
                array_keys($customValues),
            ));
            $frozenHtml = $resolve->invoke($hrTplController, (string) $tpl->content_html, $ctx, true, $rawHtmlNames);

            $row = HrDocumentSignature::create([
                'client_id'      => $emp->client_id,
                'branch_id'      => $emp->branch_id,
                'template_id'    => $tpl->id,
                'template_version' => $tpl->version,
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
            $row->load(self::withRelations());

            $askNow = $this->isParallel($row) ? $resolved : array_slice($resolved, 0, 1);
            $this->notifySignersOfTurn($row, array_column($askNow, 'user_id'), $user?->name);

            return response()->json($this->fillSignerDesignations(collect([$row]))->first(), 201);
        });
    }

    public function action(Request $request, $id)
    {
        $data = $request->validate([
            'action'          => ['required', Rule::in(['Sign', 'Approve', 'Acknowledge'])],
            'signed_name'     => 'nullable|string|max:120',
            'signature_image' => 'nullable|string|max:5600000',
            'note'            => 'nullable|string|max:500',
            'consent'         => 'nullable|boolean',
        ]);

        return DB::transaction(function () use ($request, $data, $id) {
            $user = $request->user();
            $row  = $this->loadForAction($request, (int) $id);
            $signers = $row->signers;
            $parallel = $this->isParallel($row);

            if ($parallel) {
                $idx = $this->pendingSlotFor($signers, $user);
            } else {
                $idx = (int) $row->current_index;
                $cur = $signers[$idx] ?? null;
                if (!$cur) abort(404, 'No pending signer on this document.');
                if ((int) ($cur['user_id'] ?? 0) !== (int) $user->id) {
                    abort(403, "You're not the current signer on this document.");
                }
            }
            $current = $signers[$idx] ?? null;
            if (!$current) abort(404, 'No pending signer on this document.');

            if (!filter_var($data['consent'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
                $verb = strtolower((string) ($current['action'] ?? 'act on'));
                abort(422, "You must confirm you have read and understood the document before you {$verb} it.");
            }
            $current['consent_at'] = now()->toIso8601String();

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
                $rowHtml = str_replace("{{Signer{$n}Sign}}", $this->signatureMarkup($signImgUrl, $name), $rowHtml);
                $rowHtml = str_replace("{{Signer{$n}Date}}", now()->format('d M Y'), $rowHtml);
                $row->content_html = $rowHtml;
            } else {
                $current['note'] = $data['note'] ?? null;
            }

            $current['status']   = 'Done';
            $current['acted_at'] = now()->toIso8601String();
            $signers[$idx] = $current;
            $row->signers = $signers;

            if ($parallel) {
                $allActed = collect($signers)->every(
                    fn ($s) => in_array($s['status'] ?? '', ['Done', 'Skipped'], true)
                );
                $firstPending = collect($signers)->search(fn ($s) => ($s['status'] ?? '') === 'Pending');
                $row->current_index = $firstPending === false ? count($signers) : (int) $firstPending;
                $row->status = $allActed ? 'Completed' : 'In Progress';
            } else {
                $next = $idx + 1;
                if ($next >= count($signers)) {
                    $row->status = 'Completed';
                } else {
                    $row->current_index = $next;
                    $row->status = 'In Progress';
                    $this->notifySignersOfTurn($row, [$signers[$next]['user_id'] ?? null], $user?->name);
                }
            }

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
            if ($row->status === 'Completed') {
                $this->clearTurnNotifications($row);
                StoreSignedDocumentPdf::dispatch($row->id)->afterCommit();
            }
            $row->load(self::withRelations());

            return response()->json($row);
        });
    }

    public function reject(Request $request, $id)
    {
        $data = $request->validate([
            'reason'  => 'required|string|max:500',
            'consent' => 'nullable',
        ]);
        return DB::transaction(function () use ($request, $data, $id) {
            $user = $request->user();
            $row  = $this->loadForAction($request, (int) $id);
            $signers = $row->signers;
            $idx = $this->isParallel($row)
                ? $this->pendingSlotFor($signers, $user)
                : (int) $row->current_index;
            $current = $signers[$idx] ?? null;
            if (!$current) abort(404);
            if ((int) ($current['user_id'] ?? 0) !== (int) $user->id) abort(403);

            if (!filter_var($data['consent'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
                abort(422, 'You must confirm you have read and understood the document before you reject it.');
            }

            $current['status']     = 'Rejected';
            $current['acted_at']   = now()->toIso8601String();
            $current['consent_at'] = now()->toIso8601String();
            $current['note']       = $data['reason'];
            $signers[$idx] = $current;
            $row->signers = $signers;
            $row->status  = 'Rejected';
            $this->clearTurnNotifications($row);
            $this->notifySignersOfRejection($row, $user, (string) $data['reason'], $idx);
            $row->audit_log = array_merge($row->audit_log ?? [], [
                $this->event($user, 'rejected', "Rejected by {$user?->name}: {$data['reason']}"),
            ]);
            $row->save();
            $row->load(self::withRelations());
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
        $this->clearTurnNotifications($row);
        $row->load(self::withRelations());
        return response()->json($row);
    }

    public function remind(Request $request, $id)
    {
        $row = $this->loadForRead($request, (int) $id);
        $row->load(self::withRelations());

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
                        'pending_role'    => $current['role_name'] ?? null,
                        'pending_name'    => $current['name'] ?? null,
                        'pending_user_id' => isset($current['user_id']) ? (int) $current['user_id'] : null,
                        'signed_count'    => collect($row->signers ?? [])
                            ->filter(fn ($x) => in_array($x['status'] ?? '', ['Done', 'Skipped'], true))->count(),
                        'signers_total'   => count($row->signers ?? []),
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
            }
        }

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

    private function clearTurnNotifications(HrDocumentSignature $row): void
    {
        try {
            DB::table('notifications')
                ->where('type', 'App\Notifications\HrSignatureRequest')
                ->whereRaw("data::text LIKE ?", ['%"document_id":' . (int) $row->id . '%'])
                ->where(function ($w) {
                    $w->whereRaw('data::text LIKE ?', ['%"kind":"hr_signature_request"%'])
                      ->orWhereRaw('data::text LIKE ?', ['%"kind":"hr_signature_reminder"%']);
                })
                ->delete();
        } catch (\Throwable $e) {
            Log::warning('[hr-document-signatures] could not clear stale signer notifications', [
                'id' => $row->id, 'err' => $e->getMessage(),
            ]);
        }
    }

    private function pendingSlotFor(array $signers, $user): int
    {
        foreach ($signers as $i => $s) {
            if ((int) ($s['user_id'] ?? 0) === (int) ($user->id ?? 0)
                && !in_array($s['status'] ?? 'Pending', ['Done', 'Rejected', 'Skipped'], true)) {
                return (int) $i;
            }
        }
        abort(403, "You're not a pending signer on this document.");
    }

    private function notifySignersOfRejection(HrDocumentSignature $row, $actor, string $reason, int $actedIdx): void
    {
        $signers = is_array($row->signers) ? $row->signers : [];
        $targets = [];
        foreach ($signers as $i => $s) {
            if ((int) $i === $actedIdx) continue;
            $uid = (int) ($s['user_id'] ?? 0);
            if ($uid > 0 && $uid !== (int) ($actor->id ?? 0)) $targets[$uid] = true;
        }
        if ($row->created_by && (int) $row->created_by !== (int) ($actor->id ?? 0)) {
            $targets[(int) $row->created_by] = true;
        }
        if (!$targets) return;

        $tplName = $row->template?->name ?: 'a document';
        $docCode = $row->code ?: ('doc-' . $row->id);
        $by      = $actor?->name ?: 'A signer';
        $subject = $row->employee?->display_name
            ?: trim(($row->employee?->first_name ?? '') . ' ' . ($row->employee?->last_name ?? ''));

        DB::afterCommit(function () use ($row, $targets, $tplName, $docCode, $by, $subject, $reason) {
            foreach (array_keys($targets) as $uid) {
                try {
                    DB::table('notifications')->insert([
                        'id'              => (string) Str::uuid(),
                        'type'            => 'App\\Notifications\\HrSignatureRequest',
                        'notifiable_type' => User::class,
                        'notifiable_id'   => $uid,
                        'data'            => json_encode([
                            'kind'          => 'rejected',
                            'document_id'   => $row->id,
                            'code'          => $docCode,
                            'template'      => $tplName,
                            'sender_name'   => $by,
                            'employee_name' => $subject ?: null,
                            'employee_code' => (string) ($row->employee?->emp_code ?? '') ?: null,
                            'subject'       => "{$tplName} was declined"
                                . ($subject ? " — {$subject}" : ''),
                            'message'       => "{$docCode} · declined by {$by}: {$reason}",
                            'reason'        => $reason,
                            'url'           => '/inbox',
                        ]),
                        'read_at'    => null,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                } catch (\Throwable $e) {
                    Log::warning('[hr-document-signatures] rejection notification insert failed', [
                        'id' => $row->id, 'user' => $uid, 'err' => $e->getMessage(),
                    ]);
                }
            }
        });
    }
    private function notifySignersOfTurn(HrDocumentSignature $row, array $userIds, ?string $senderName): void
    {
        $userIds = array_values(array_unique(array_filter(array_map('intval', $userIds))));
        if (!$userIds) return;

        $signers = collect($row->signers ?? []);
        $tplName = $row->template?->name ?: 'a document';
        $docCode = $row->code ?: ('doc-' . $row->id);
        $sender  = $senderName ?: 'HR';
        $subject = $row->employee?->display_name
            ?: trim(($row->employee?->first_name ?? '') . ' ' . ($row->employee?->last_name ?? ''));
        $subjectCode = (string) ($row->employee?->emp_code ?? '');

        $acted  = $signers->filter(fn ($x) => in_array($x['status'] ?? '', ['Done', 'Skipped'], true))->count();
        $total  = $signers->count();
        $waiting = $signers->first(fn ($x) => !in_array($x['status'] ?? 'Pending', ['Done', 'Skipped', 'Rejected'], true));

        DB::afterCommit(function () use ($row, $userIds, $signers, $tplName, $docCode, $sender, $subject, $subjectCode, $acted, $total, $waiting) {
            foreach ($userIds as $uid) {
                $action = $signers->firstWhere('user_id', $uid)['action'] ?? 'Sign';
                try {
                    DB::table('notifications')->insert([
                        'id'              => (string) Str::uuid(),
                        'type'            => 'App\\Notifications\\HrSignatureRequest',
                        'notifiable_type' => User::class,
                        'notifiable_id'   => $uid,
                        'data'            => json_encode([
                            'kind'          => 'hr_signature_request',
                            'document_id'   => $row->id,
                            'code'          => $docCode,
                            'template'      => $tplName,
                            'action'        => $action,
                            'sender_name'   => $sender,
                            'employee_name' => $subject ?: null,
                            'employee_code' => $subjectCode ?: null,
                            'employee_id'   => $row->employee_id,
                            'message'       => "{$tplName} — waiting for you to {$action}"
                                . ($subject ? " ({$subject})" : ''),
                            'url'           => '/inbox',
                            'pending_role'    => $waiting['role_name'] ?? null,
                            'pending_name'    => $waiting['name'] ?? null,
                            'pending_user_id' => isset($waiting['user_id']) ? (int) $waiting['user_id'] : null,
                            'signed_count'    => $acted,
                            'signers_total'   => $total,
                        ]),
                        'read_at'         => null,
                        'created_at'      => now(),
                        'updated_at'      => now(),
                    ]);
                } catch (\Throwable $e) {
                    Log::warning('[hr-document-signatures] signer notification insert failed', [
                        'id' => $row->id, 'user' => $uid, 'err' => $e->getMessage(),
                    ]);
                }
            }
        });
    }

    public function forEmployee(Request $request, $slug)
    {
        $emp = is_numeric($slug)
            ? Employee::find((int) $slug)
            : Employee::where('emp_code', $slug)->first();
        if (!$emp) abort(404, 'Employee not found');

        $status = (string) $request->query('status', 'Completed');
        $q = HrDocumentSignature::query()->with(self::withRelations())
            ->where('employee_id', $emp->id);
        if ($status !== 'all') $q->where('status', $status);

        $this->applyScope($q, $request->user());
        $rows = $this->fillSignerDesignations($q->orderByDesc('id')->get());

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

    public function downloadSignedPdf(Request $request, $id)
    {
        $row      = $this->loadForRead($request, (int) $id);
        $filename = ($row->code ?: ('doc-' . $row->id)) . '-signed.pdf';

        if ($path = $this->storedSignedPdfPath($row)) {
            try {
                $stream = Storage::disk('public')->readStream($path);
            } catch (\Throwable $e) {
                $stream = null;
            }
            if (is_resource($stream)) {
                return response()->streamDownload(function () use ($stream) {
                    fpassthru($stream);
                    fclose($stream);
                }, $filename, ['Content-Type' => 'application/pdf']);
            }
        }

        $bytes = $this->renderSignedPdfBytes($row);

        if (strtolower((string) $row->status) === 'completed') {
            $this->storeSignedPdf($row, $bytes);
        }

        return response()->streamDownload(
            fn () => print($bytes),
            $filename,
            ['Content-Type' => 'application/pdf']
        );
    }

    private function storedSignedPdfPath(HrDocumentSignature $row): ?string
    {
        $path = ltrim((string) ($row->signed_pdf_path ?? ''), '/');
        if ($path === '' || strtolower((string) $row->status) !== 'completed') return null;
        if ($row->signed_pdf_at && $row->updated_at && $row->signed_pdf_at->lt($row->updated_at)) return null;
        return $path;
    }

    public function storeSignedPdf(HrDocumentSignature $row, ?string $bytes = null): ?string
    {
        static $hasColumn = null;
        if ($hasColumn === null) {
            try { $hasColumn = \Illuminate\Support\Facades\Schema::hasColumn('hr_document_signatures', 'signed_pdf_path'); }
            catch (\Throwable $e) { $hasColumn = false; }
        }
        if (!$hasColumn) return null;

        try {
            $bytes ??= $this->renderSignedPdfBytes($row);
            $clientSlug = $row->client_id ? 'c' . $row->client_id : 'public';
            $branchSlug = $row->branch_id ? 'b' . $row->branch_id : 'b0';
            $path = "signed-documents/{$clientSlug}/{$branchSlug}/" . $row->id
                . '-' . substr(md5($row->id . '|' . $row->updated_at), 0, 12) . '.pdf';
            if (substr($bytes, 0, 4) !== '%PDF') {
                throw new \RuntimeException('Renderer did not produce a PDF');
            }

            $disk = Storage::disk('public');
            if ($disk->put($path, $bytes) === false) {
                throw new \RuntimeException('Storage::put returned false (disk='
                    . config('filesystems.disks.public.driver') . ')');
            }

            $old = ltrim((string) ($row->signed_pdf_path ?? ''), '/');
            if ($old !== '' && $old !== $path) {
                try { $disk->delete($old); } catch (\Throwable $e) { }
            }
            HrDocumentSignature::withoutTimestamps(fn () => $row->forceFill([
                'signed_pdf_path' => $path,
                'signed_pdf_at'   => now(),
            ])->save());
            return $path;
        } catch (\Throwable $e) {
            Log::warning('Signed-PDF store failed', [
                'run'  => $row->id,
                'disk' => config('filesystems.disks.public.driver'),
                'err'  => $e->getMessage(),
            ]);
            return null;
        }
    }

    public function renderSignedPdfBytes(HrDocumentSignature $row): string
    {
        $row->load(self::withRelations());
        $headerCfg = is_array($row->header_config) ? $row->header_config : [];
        $footerCfg = is_array($row->footer_config) ? $row->footer_config : [];
        $logoUrl = null;
        $disk = Storage::disk('public');
        $row->loadMissing('branch:id,logo');
        $logoCandidates = [
            fn () => (string) ($headerCfg['logo_path'] ?? ''),
            fn () => $this->diskPathFromUrl((string) ($headerCfg['logo_url'] ?? '')) ?? '',
            fn () => $this->diskPathFromUrl((string) ($row->branch?->logo ?? '')) ?? '',
            fn () => (string) ((new HrDocumentTemplateController())->latestClientLogo($row->client_id) ?? ''),
        ];
        foreach ($logoCandidates as $resolveCandidate) {
            $candidate = $resolveCandidate();
            $candidate = ltrim((string) $candidate, '/');
            if ($candidate === '' || !$disk->exists($candidate)) continue;

            $ext = strtolower((string) pathinfo($candidate, PATHINFO_EXTENSION));
            $mime = match ($ext) {
                'jpg', 'jpeg' => 'image/jpeg',
                'svg'         => 'image/svg+xml',
                ''            => 'image/png',
                default       => 'image/' . $ext,
            };
            $logoUrl = 'data:' . $mime . ';base64,' . base64_encode((string) $disk->get($candidate));
            break;
        }

        $pdf = \Barryvdh\DomPDF\Facade\Pdf::loadView('pdf.signed-document', [
            'row'        => $row,
            'header'     => $headerCfg,
            'footer'     => $footerCfg,
            'logoDataUri'=> $logoUrl,
            'companyName' => (string) (
                $row->employee?->legalEntity?->name
                ?: $row->employee?->branch?->client?->org_name
                ?: $row->employee?->branch?->name
                ?: ''
            ),
            'bodyHtml'   => $this->inlineLocalImagesAsDataUris(
                $this->htmlRendersNothing($row->content_html)
                    ? '<p style="color:#9ca3af;font-style:italic;">This document has no stored content. '
                        . 'It was generated before any content was saved against its template, '
                        . 'or the template itself was empty when it was sent.</p>'
                    : (string) $row->content_html
            ),
        ]);
        $pdf->setPaper('A4');

        return $pdf->output();
    }

    public function downloadSigned(Request $request, $id)
    {
        $row = $this->loadForRead($request, (int) $id);
        $filename = ($row->code ?: ('doc-' . $row->id)) . '-signed.docx';
        return (new HrDocumentTemplateController())->renderDocx($row, $filename);
    }

    public function emailToEmployee(Request $request, $id)
    {
        $row = $this->loadForRead($request, (int) $id);
        $row->load(self::withRelations());

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

    private function loadForRead(Request $request, int $id): HrDocumentSignature
    {
        $q = HrDocumentSignature::query();
        $this->applyScope($q, $request->user());
        $row = $q->findOrFail($id);
        $this->assertEmployeeMayRead($request->user(), $row);
        return $row;
    }

    private function assertEmployeeMayRead(?User $user, HrDocumentSignature $row): void
    {
        if (!$user || $user->user_type !== 'employee') return;

        if ($this->mayReadOthersDocuments($user)) return;

        $ownEmployeeId = $user->employee_id;
        if ($ownEmployeeId && (int) $row->employee_id === (int) $ownEmployeeId) return;

        foreach ((is_array($row->signers) ? $row->signers : []) as $s) {
            if ((int) ($s['user_id'] ?? 0) === (int) $user->id) return;
        }

        abort(403, 'This document does not belong to you.');
    }

    private const READ_OTHERS_MODULES = ['hr.documents', 'hr.doc_templates', 'hr.employee'];

    private function mayReadOthersDocuments(?User $user): bool
    {
        if (!$user) return false;

        $moduleIds = \App\Models\Module::whereIn('slug', self::READ_OTHERS_MODULES)->pluck('id');
        if ($moduleIds->isEmpty()) {
            return in_array($user->user_type, ['client_admin', 'branch_user'], true);
        }

        return \App\Models\Permission::where('user_id', $user->id)
            ->whereIn('module_id', $moduleIds)
            ->where('can_view', true)
            ->exists();
    }

    private function loadForAction(Request $request, int $id): HrDocumentSignature
    {
        $q = HrDocumentSignature::query();
        $this->applyScope($q, $request->user());
        return $q->findOrFail($id);
    }

    private function resolveSignerUser(string $roleName, Employee $emp): array
    {
        return \App\Support\SignerResolver::resolve($roleName, $emp);
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

    private function signatureMarkup(?string $imageUrl, string $name): string
    {
        $safeName = htmlspecialchars($name, ENT_QUOTES);

        if ($imageUrl !== null && $imageUrl !== '') {
            return sprintf(
                '<img src="%s" alt="Signature of %s" style="max-height:48px;max-width:220px;vertical-align:middle;" />',
                htmlspecialchars($imageUrl, ENT_QUOTES),
                $safeName,
            );
        }

        return sprintf(
            '<span style="font-family:\'Brush Script MT\',cursive;font-size:22px;line-height:1;'
            . 'display:inline-block;vertical-align:middle;color:#1d4ed8;">%s</span>',
            $safeName,
        );
    }

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

    private function diskPathFromUrl(string $src): ?string
    {
        $src = trim($src);
        if ($src === '' || str_starts_with($src, 'data:')) return null;

        $parsed = parse_url($src);
        $path = $parsed['path'] ?? $src;
        $path = ltrim(str_replace('\\', '/', $path), '/');

        if (preg_match('#(?:^|/)storage/(.+)$#', $path, $m)) {
            return $m[1];
        }
        if (isset($parsed['scheme'])) return null;

        if (str_starts_with($path, 'public/')) {
            $path = substr($path, strlen('public/'));
        }
        return str_contains($path, '/') ? $path : null;
    }

    private function htmlRendersNothing(?string $html): bool
    {
        $html = (string) $html;
        if (trim($html) === '') {
            return true;
        }
        if (preg_match('/<(img|svg|hr|table|canvas)\b/i', $html)) {
            return false;
        }
        $text = preg_replace('/<!--.*?-->/s', '', $html);
        $text = strip_tags((string) $text);
        $text = html_entity_decode((string) $text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = str_replace("\xc2\xa0", ' ', (string) $text);

        return trim($text) === '';
    }

    private function inlineLocalImagesAsDataUris(string $html): string
    {
        return preg_replace_callback(
            '#<img\b([^>]*?)\bsrc=([\'"])(.*?)\2([^>]*)>#i',
            function ($mm) {
                [$full, $pre, $quote, $src, $post] = $mm;
                if ($src === '' || str_starts_with($src, 'data:')) return $full;

                $diskPath = $this->diskPathFromUrl($src);
                if (!$diskPath) return $full;

                try {
                    $binary = Storage::disk('public')->get($diskPath);
                    if ($binary === null || $binary === '') return $full;
                    $ext  = strtolower((string) pathinfo($diskPath, PATHINFO_EXTENSION));
                    $mime = match ($ext) {
                        'jpg', 'jpeg' => 'image/jpeg',
                        'svg'         => 'image/svg+xml',
                        'gif'         => 'image/gif',
                        'webp'        => 'image/webp',
                        ''            => 'image/png',
                        default       => 'image/' . $ext,
                    };
                } catch (\Throwable $e) {
                    return $full;
                }
                $dataUri = 'data:' . $mime . ';base64,' . base64_encode($binary);
                return '<img' . $pre . 'src=' . $quote . $dataUri . $quote . $post . '>';
            },
            $html
        ) ?? $html;
    }

    private function fillSignerDesignations($rows)
    {
        $missing = [];
        foreach ($rows as $row) {
            foreach ((array) $row->signers as $s) {
                if (empty($s['designation']) && (int) ($s['user_id'] ?? 0) > 0) {
                    $missing[(int) $s['user_id']] = true;
                }
            }
        }
        if (!$missing) return $rows;

        $titles = Employee::with('designation:id,name')
            ->whereIn('user_id', array_keys($missing))
            ->get(['id', 'user_id', 'designation_id'])
            ->mapWithKeys(fn ($e) => [(int) $e->user_id => $e->designation?->name])
            ->filter()
            ->all();
        if (!$titles) return $rows;

        foreach ($rows as $row) {
            $signers = (array) $row->signers;
            foreach ($signers as $i => $s) {
                if (empty($s['designation'])) {
                    $signers[$i]['designation'] = $titles[(int) ($s['user_id'] ?? 0)] ?? null;
                }
            }
            $row->signers = $signers;
        }

        return $rows;
    }

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
                  ->orWhere('employee_id', $user->employee_id);
            });
            return;
        }
        $q->whereRaw('1 = 0');
    }
}
