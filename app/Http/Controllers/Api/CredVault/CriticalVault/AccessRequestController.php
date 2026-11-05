<?php

namespace App\Http\Controllers\Api\CredVault\CriticalVault;

use App\Http\Controllers\Api\CredVault\CredVaultController;
use App\Models\CredVault\AccessRequest;
use App\Models\CredVault\Credential;
use App\Models\CredVault\Policy;
use App\Models\User;
use App\Services\CredVault\EmailOtp;
use App\Services\CredVault\Totp;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\Rule;

/**
 * CredVault · Critical Vault unlock — /api/credvault/critical-vault/access-requests/*
 *
 * Access Request Management and the Unlock modal. A request runs the steps
 * the credential had when it was raised, in this order:
 *
 *   pending   Vault Admin approves / rejects, then the Reporting Manager
 *   approved  the 2-step code: the authenticator app's code, or — for the email
 *             method — send-otp mails a code to the credential's inbox
 *   unlocked  open for the chosen window, then locked again on its own
 *
 * Three wrong codes void the request (approvals included); six a day per person
 * per credential. Normal Vault credentials have no steps and never come here.
 */
class AccessRequestController extends CredVaultController
{
    /**
     * GET /critical-vault/access-requests?tab=all|pending|approved|rejected|mine|to_me
     *
     * A Vault Admin sees every request of the company; anyone else sees the
     * ones they raised and the ones waiting on them.
     */
    public function accessRequests(Request $request)
    {
        $u = $this->tenantUser($request);
        $f = $request->validate($this->listRules(['all', 'pending', 'approved', 'rejected', 'mine', 'to_me']));
        $this->sweepUnlocks($u->client_id);

        $admin  = $this->isAdmin($u);
        $branch = $this->adminBranchOf($u);
        $base   = AccessRequest::where('client_id', $u->client_id);
        if (!$admin) {
            // The Branch Admin (Vault Admin) sees every request raised in their branch; everyone else only theirs and the ones on them.
            $base->where(function ($w) use ($u, $branch) {
                $w->where('requester_id', $u->id)->orWhere('admin_user_id', $u->id)->orWhere('manager_user_id', $u->id);
                if ($branch) {
                    $w->orWhereIn('requester_id', User::where('client_id', $u->client_id)->where('branch_id', $branch)->select('id'));
                }
            });
        }
        $search = clone $base;
        if ($term = $f['q'] ?? null) {
            // Request ID, credential (name, ID, category), requester, their department, reason, either approver.
            $like  = $this->likeTerm($term);
            $types = collect(Credential::TYPES)->filter(fn ($x) => str_contains(mb_strtolower($x[0]), mb_strtolower(trim($term))))->keys()->all();
            $people = User::where('client_id', $u->client_id)->whereRaw('lower(name) like ?', [$like])->select('id');
            $deptUsers = $this->usersInDepartmentsLike($u->client_id, $like);
            $search->where(function ($w) use ($like, $u, $types, $people, $deptUsers) {
                $w->whereRaw('lower(code) like ?', [$like])
                  ->orWhereRaw('lower(coalesce(reason, \'\')) like ?', [$like])
                  ->orWhereIn('credential_id', Credential::withTrashed()->where('client_id', $u->client_id)->where(function ($x) use ($like, $types) {
                      $x->whereRaw('lower(name) like ?', [$like])->orWhereRaw('lower(code) like ?', [$like])->orWhereRaw('lower(category_group) like ?', [$like]);
                      if ($types) $x->orWhereIn('type', $types);
                  })->select('id'))
                  ->orWhereIn('requester_id', $people)->orWhereIn('admin_user_id', $people)->orWhereIn('manager_user_id', $people)
                  ->orWhereIn('admin_decided_by', $people);
                if ($deptUsers) $w->orWhereIn('requester_id', $deptUsers);
            });
        }

        $toMe = function ($q) use ($u, $admin) {
            return $q->where('status', 'pending')->where('requester_id', '!=', $u->id)->where(function ($w) use ($u, $admin) {
                $w->where(function ($a) use ($u, $admin) {
                    $a->where('admin_required', true)->where('admin_status', 'pending')
                      ->where(fn ($x) => $x->where('admin_user_id', $u->id)->when($admin, fn ($y) => $y->orWhereNull('admin_user_id')
                          ->orWhereNotIn('admin_user_id', $this->adminIds($u->client_id))));
                })->orWhere(function ($m) use ($u) {
                    $m->where('manager_status', 'pending')->where('manager_user_id', $u->id)
                      ->where(fn ($x) => $x->whereNull('admin_decided_by')->orWhere('admin_decided_by', '!=', $u->id));
                });
            });
        };
        $tabsFn = [
            'pending'  => fn ($q) => $q->where('status', 'pending'),
            'approved' => fn ($q) => $q->whereIn('status', ['approved', 'unlocked', 'locked'])
                ->where(fn ($w) => $w->whereNull('locked_reason')->orWhere('locked_reason', '!=', 'otp_failed')),
            'rejected' => fn ($q) => $q->where('status', 'rejected'),
            'mine'     => fn ($q) => $q->where('requester_id', $u->id),
            'to_me'    => $toMe,
        ];
        // Counts ignore the search box; the list honours it.
        $tabs = ['all' => (clone $base)->count()];
        foreach ($tabsFn as $k => $fn) $tabs[$k] = $fn(clone $base)->count();
        if (($tab = $f['tab'] ?? 'all') !== 'all') $tabsFn[$tab]($search);

        $page = $search->with(self::REQUEST_RELATIONS)->orderByDesc('id')
            ->paginate($f['per_page'] ?? self::PAGE_SIZE, ['*'], 'page', $f['page'] ?? 1);
        $this->userInfo(collect($page->items())->pluck('requester_id')->unique()->all());   // one batch, not one per row

        return response()->json([
            'status' => true,
            'data'   => collect($page->items())->map(fn ($r) => $this->requestRow($r, $u))->values(),
            'tabs'   => $tabs,
            'meta'   => $this->pageMeta($page),
        ], 200);
    }

    /** GET /critical-vault/access-requests/{id} */
    public function accessRequest(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        $this->sweepUnlocks($u->client_id);
        $r = $this->findRequest($u, $id);

        return response()->json(['status' => true, 'data' => $this->requestRow($r, $u)], 200);
    }

    /**
     * POST /critical-vault/credentials/{id}/access-requests { reason?, duration_minutes? }
     *
     * The steps are fixed at this moment from the credential and the policy.
     * As in the prototype, the reason and the window are asked on the Vault
     * Admin stage only: with that step off, no reason is needed and the window
     * is 5 minutes. A request with no approval step (an authenticator-only
     * lock) starts at 'approved' and waits only for the code.
     */
    public function requestAccess(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate([
            'reason'           => ['nullable', 'string', 'max:300'],
            'duration_minutes' => ['nullable', 'integer', Rule::in(AccessRequest::DURATIONS)],
        ]);
        $this->sweepUnlocks($u->client_id);
        [$c] = $this->findInVault($u, $id, 'critical', self::RANK_VIEW,
            'Your access is Use Only — there is nothing for you to unlock on this credential.');
        if ($this->opensDirectly($u, $c)) {
            $this->reject('You are the Vault Admin for this branch — open this credential directly.', null, 409);
        }
        $pol = Policy::for($u->client_id);

        $steps       = $c->lockSteps();
        $adminStep   = in_array('admin', $steps, true);
        $managerStep = in_array('manager', $steps, true);
        $otpStep     = in_array('otp', $steps, true);
        if (!$steps) $this->reject('This credential is not locked — open it directly.', null, 409);

        $reason = trim((string) ($d['reason'] ?? ''));
        if ($adminStep && mb_strlen($reason) < 10) {
            $this->reject('Please give a reason (at least 10 characters).', 'reason');
        }
        if ($adminStep && empty($d['duration_minutes'])) {
            $this->reject('Choose how long you need access.', 'duration_minutes');
        }
        $d['duration_minutes'] = $adminStep ? (int) $d['duration_minutes'] : AccessRequest::DEFAULT_MINUTES;
        if ($d['duration_minutes'] > $pol['cp_max_minutes']) {
            $this->reject("Policy allows an unlock window of up to {$pol['cp_max_minutes']} minutes.", 'duration_minutes');
        }
        // The 3-try limit is per request, and an OTP-only lock approves a new request at
        // once — so wrong codes are also capped per person per credential per day.
        if ($otpStep && AccessRequest::where('credential_id', $c->id)->where('requester_id', $u->id)
                ->where('created_at', '>=', now()->subDay())->sum('otp_attempts') >= self::OTP_DAILY_LIMIT) {
            $this->reject('Too many wrong 2-step codes on this credential today. Try again tomorrow, or ask the owner to unlock it with you.', null, 429);
        }
        if ($otpStep && !$c->twoStepLinked()) {
            $this->reject('2-step verification for this credential has not been linked yet. Ask the owner to link it first.', null, 409);
        }

        $adminId = null;
        if ($adminStep) {
            // The Vault Admin is the requester's Branch Admin; nobody approves their own request.
            $pool = array_values(array_diff($this->branchAdminIds($u->branch_id, $u->client_id), [$u->id]));
            if (!$pool) $this->reject('Your branch has no Branch Admin (Vault Admin) to approve this. Ask your administrator to assign one.', null, 409);
            $adminId = $c->lock_admin_user_id ?: ($pol['cp_admin_user_id'] ?: null);
            if (!in_array((int) $adminId, $pool, true)) $adminId = $pool[0];   // pin to the branch admin
        }
        $managerId = null;
        if ($managerStep) {
            $managerId = $c->lock_manager_user_id ?: $this->managerOf($u);
            if (!$managerId || $managerId === $u->id) {
                $this->reject('You have no reporting manager to approve this. Ask HR to set one, or the owner to change the protection steps.', null, 409);
            }
        }

        $open = AccessRequest::where('credential_id', $c->id)->where('requester_id', $u->id)->whereIn('status', AccessRequest::OPEN)->first();
        if ($open) {
            return response()->json([
                'status'  => false,
                'message' => "You already have an open request ({$open->code}) for this credential.",
                'data'    => $this->requestRow($open->load(self::REQUEST_RELATIONS), $u),
            ], 409);
        }

        $req = $this->inTransaction('raise the access request', function () use ($u, $c, $d, $reason, $adminStep, $managerStep, $otpStep, $adminId, $managerId) {
            try {
                $req = AccessRequest::create([
                    'client_id'        => $u->client_id,
                    'code'             => $this->nextCode('credvault_access_requests', 'REQ', $u->client_id),
                    'credential_id'    => $c->id,
                    'requester_id'     => $u->id,
                    'reason'           => $reason ?: null,
                    'duration_minutes' => $d['duration_minutes'],
                    'admin_required'   => $adminStep,
                    'admin_user_id'    => $adminId,
                    'admin_status'     => $adminStep ? 'pending' : null,
                    'manager_required' => $managerStep,
                    'manager_user_id'  => $managerId,
                    'manager_status'   => (!$adminStep && $managerStep) ? 'pending' : null,
                    'otp_required'     => $otpStep,
                    'status'           => ($adminStep || $managerStep) ? 'pending' : 'approved',
                ]);
            } catch (QueryException $e) {
                $this->reject('You already have an open request for this credential.', null, 409);
            }
            $this->audit($u, 'request', $c, "Access requested for {$d['duration_minutes']} min" . ($reason ? " — {$reason}" : ''),
                ['request_id' => $req->id], 'Critical Vault');
            $req->setRelation('credential', $c);
            $this->notifyStage($req, $u->name);

            return $req;
        });

        $req->load(self::REQUEST_RELATIONS);

        return response()->json(['status' => true, 'message' => "Request {$req->code} raised.", 'data' => $this->requestRow($req, $u)], 201);
    }

    /** POST /critical-vault/access-requests/{id}/approve { note? } — the stage waiting now, by the person it waits on. */
    public function approveRequest(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate(['note' => ['nullable', 'string', 'max:300']]);

        return $this->decide($u, $id, true, $d['note'] ?? null);
    }

    /**
     * POST /critical-vault/access-requests/{id}/reject { note? } — the reason goes
     * back to the requester; without one it reads "Not approved at this time",
     * the prototype's wording.
     */
    public function rejectRequest(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate(['note' => ['nullable', 'string', 'max:300']]);

        return $this->decide($u, $id, false, filled($d['note'] ?? null) ? trim($d['note']) : 'Not approved at this time');
    }

    /**
     * POST /critical-vault/access-requests/{id}/raise-manager — the requester forwards an
     * admin-approved request to their reporting manager. Only after this does the manager's
     * approve button open; until then the request sits at "awaiting forward".
     */
    public function raiseManager(Request $request, int $id)
    {
        $u = $this->tenantUser($request);

        $r = $this->inTransaction('forward to the reporting manager', function () use ($u, $id) {
            $r = $this->findRequest($u, $id, true);
            if ($r->requester_id !== $u->id)   $this->reject('Only the person who raised the request can forward it.', null, 403);
            if ($r->status !== 'pending')       $this->reject('This request is no longer open.', null, 409);
            if (!$r->manager_required)          $this->reject('This request has no reporting-manager step.', null, 409);
            if ($r->admin_required && $r->admin_status !== 'approved') $this->reject('The Vault Admin has not approved this yet.', null, 409);
            if ($r->manager_status === 'approved') $this->reject('The reporting manager has already approved this.', null, 409);
            if ($r->manager_status === 'pending')  $this->reject('This request is already with the reporting manager.', null, 409);

            $r->update(['manager_status' => 'pending']);
            $this->audit($u, 'forward_mgr', $r->credential, "Request {$r->code} forwarded to the reporting manager", ['request_id' => $r->id], 'Access Requests');
            $this->notifyStage($r, $r->requester?->name ?? 'A colleague');   // now notifies the manager — the stage is 'manager'

            return $r;
        });

        return response()->json([
            'status'  => true,
            'message' => 'Forwarded to the reporting manager.',
            'data'    => $this->requestRow($r->fresh(self::REQUEST_RELATIONS), $u),
        ], 200);
    }

    /** POST /critical-vault/access-requests/{id}/cancel — the requester withdraws it. */
    public function cancelRequest(Request $request, int $id)
    {
        $u = $this->tenantUser($request);

        $r = $this->inTransaction('cancel the request', function () use ($u, $id) {
            $r = $this->findRequest($u, $id, true);
            if ($r->requester_id !== $u->id) $this->reject('Only the person who raised a request can cancel it.', null, 403);
            if (!in_array($r->status, ['pending', 'approved'], true)) $this->reject('This request is no longer open.', null, 409);

            $r->update(['status' => 'cancelled']);
            EmailOtp::forgetUnlock($r->id);
            $this->audit($u, 'cancel', $r->credential, "Request {$r->code} cancelled by requester", ['request_id' => $r->id], 'Critical Vault');

            return $r;
        });

        return response()->json(['status' => true, 'message' => 'Request cancelled.', 'data' => $this->requestRow($r->fresh(self::REQUEST_RELATIONS), $u)], 200);
    }

    /**
     * POST /critical-vault/access-requests/{id}/send-otp — the email method's
     * code step: mails a 6-digit code to the credential's 2-step inbox. Only
     * the requester, only once the approvals are in. Asking again replaces the
     * code (one send per 30 s); it lasts 10 minutes and works once.
     */
    public function sendOtp(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        $r = $this->findRequest($u, $id);
        if ($r->requester_id !== $u->id) $this->reject('Only the person who raised the request can ask for its code.', null, 403);
        if ($r->status !== 'approved' || $r->currentStage() !== 'otp') $this->reject('This request is not waiting for a 2-step code.', null, 409);

        $cred = Credential::find($r->credential_id, ['id', 'client_id', 'vault', 'name', 'twofa_method', 'twofa_email', 'twofa_linked_at']);
        if (!$cred || $cred->twofa_method !== 'email' || !$cred->twoStepLinked()) {
            $this->reject('This credential uses the authenticator app — enter the code it shows.', null, 409);
        }
        $sent = EmailOtp::sendUnlock($r, $cred, $u);
        $this->audit($u, 'otp_sent', $cred, "Email code sent for request {$r->code} · {$sent['sent_to']}", ['request_id' => $r->id], 'Critical Vault');

        return response()->json(['status' => true, 'message' => "Code sent to {$sent['sent_to']}.", 'data' => $sent], 200);
    }

    /**
     * POST /critical-vault/access-requests/{id}/verify-otp { code }
     *
     * The last step, by the credential's 2-step method: the authenticator app's
     * current code, or the code send-otp emailed. Three wrong codes void the
     * request — every approval with it — and the requester starts again.
     */
    public function verifyOtp(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate(['code' => ['required', 'regex:/^\d{6}$/']], ['code.regex' => 'Enter the 6-digit code.']);

        [$r, $ok] = $this->inTransaction('verify the code', function () use ($u, $id, $d) {
            $r = $this->findRequest($u, $id, true);
            if ($r->requester_id !== $u->id) $this->reject('Only the person who raised the request can enter its code.', null, 403);
            if ($r->status !== 'approved' || $r->currentStage() !== 'otp') {
                $this->reject('This request is not waiting for a 2-step code.', null, 409);
            }
            // The row's eager load carries display columns only; the secret is read here, on purpose.
            $cred = Credential::withTrashed()->find($r->credential_id,
                ['id', 'client_id', 'vault', 'twofa_method', 'twofa_email', 'twofa_linked_at', 'totp_secret', 'totp_linked_at']);
            if (!$cred || !$cred->twoStepLinked()) $this->reject('2-step verification for this credential is no longer linked.', null, 409);

            if ($cred->twofa_method === 'email') {
                // The emailed code: none live (never sent, expired, cancelled) costs no try.
                $match = EmailOtp::checkUnlock($r->id, $d['code']);
                if ($match === null) $this->reject('No live email code for this request. Press “Send code” to get one.', 'code', 409);
            } else {
                // A code is good once. Claimed per (credential, time step) and atomically, so a
                // replay inside its ±30 s window is refused — without costing a try — while a
                // code from a neighbouring step stays usable.
                $step = Totp::matchStep($cred->totp_secret, $d['code']);
                if ($step !== null && !Cache::add("credvault:totp-used:{$cred->id}:{$step}", 1, now()->addMinutes(3))) {
                    $this->reject('That code was just used. Wait for the next code in your authenticator app.', 'code');
                }
                $match = $step !== null;
            }
            if (!$match) {
                $r->otp_attempts++;
                if ($r->otp_attempts >= AccessRequest::MAX_OTP_ATTEMPTS) {
                    $r->fill(['status' => 'locked', 'locked_at' => now(), 'locked_reason' => 'otp_failed']);
                    EmailOtp::forgetUnlock($r->id);
                    $this->audit($u, 'otp_failed', $r->credential, AccessRequest::MAX_OTP_ATTEMPTS . ' wrong 2-step codes — approvals reset', ['request_id' => $r->id], 'Critical Vault');
                    if ($r->credential && $r->credential->owner_id !== $u->id) {
                        $this->notify([$r->credential->owner_id], 'otp_failed', 'Wrong 2-step codes',
                            "{$u->name} entered " . AccessRequest::MAX_OTP_ATTEMPTS . " wrong codes for {$r->credential->name}.",
                            ['credential_id' => $r->credential_id, 'url' => '/credentials-vault/critical-vault']);
                    }
                }
                $r->save();

                return [$r, false];
            }

            $r->otp_verified_at = now();
            $this->unlock($r, $u);

            return [$r, true];
        });

        if (!$ok) {
            $left = AccessRequest::MAX_OTP_ATTEMPTS - $r->otp_attempts;
            $this->reject($left > 0
                ? "Incorrect or expired code. {$left} attempt" . ($left === 1 ? '' : 's') . ' left.'
                : 'Too many wrong codes — the approvals were reset. Request access again.', 'code', $left > 0 ? 422 : 423);
        }

        return response()->json([
            'status'  => true,
            'message' => "Unlocked for {$r->duration_minutes} min.",
            'data'    => $this->requestRow($r->fresh(self::REQUEST_RELATIONS), $u),
        ], 200);
    }

    /** POST /critical-vault/access-requests/{id}/lock — "Lock now", by the requester or a Vault Admin. */
    public function lockRequest(Request $request, int $id)
    {
        $u = $this->tenantUser($request);

        $r = $this->inTransaction('lock the credential', function () use ($u, $id) {
            $r = $this->findRequest($u, $id, true);
            if ($r->requester_id !== $u->id && !$this->isAdmin($u)) $this->reject('Only the requester or a Vault Admin can lock this.', null, 403);
            if ($r->status !== 'unlocked') $this->reject('This credential is not unlocked.', null, 409);

            $r->update(['status' => 'locked', 'locked_at' => now(), 'locked_reason' => 'manual']);
            $this->audit($u, 'lock', $r->credential, 'Credential locked again', ['request_id' => $r->id], 'Critical Vault');

            return $r;
        });

        return response()->json(['status' => true, 'message' => 'Locked.', 'data' => $this->requestRow($r->fresh(self::REQUEST_RELATIONS), $u)], 200);
    }
}
