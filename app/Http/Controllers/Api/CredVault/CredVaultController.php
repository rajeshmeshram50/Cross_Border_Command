<?php

namespace App\Http\Controllers\Api\CredVault;

use App\Http\Controllers\Controller;
use App\Models\CredVault\AccessRequest;
use App\Models\CredVault\AuditLog;
use App\Models\CredVault\Credential;
use App\Models\CredVault\CredentialShare;
use App\Models\CredVault\Policy;
use App\Models\CredVault\Transfer;
use App\Models\Employee;
use App\Models\Masters\Departments;
use App\Models\Module;
use App\Models\Permission;
use App\Models\User;
use App\Services\CredVault\Totp;
use App\Services\CredVault\VaultFile;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\QueryException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/**
 * CredVault — the company password manager. /api/credvault/*
 *
 * Every screen of the Kryptone CredVault prototype is served from here:
 * Vault Dashboard, Password Health, My / Team / Critical Vault, sharing,
 * Access Request Management, Policies, Import & Recovery, Audit Logs and the
 * Recycle Bin. docs/CREDVAULT_PROTOTYPE_SHEET.md is the functional spec.
 *
 * WHO SEES A CREDENTIAL — the access rank, weakest first:
 *   use (0)  sign in with it, never see it     — a "Use Only" share
 *   view (1) reveal the secret                 — a "View" share
 *   copy (2) reveal and copy                   — a "Copy" share, or a member
 *                                                of the team it belongs to
 *   full (3) edit, share, delete               — the owner, a "Full" share,
 *                                                and on a team credential the
 *                                                department HOD and the Vault Admins
 * A personal credential is the owner's alone; not even a Vault Admin sees it
 * unless it was shared. Anything outside a user's ranks reads as 404.
 *
 * PROTECTED CREDENTIALS — every critical credential, and any other with an
 * authenticator lock — reveal nothing, to anyone, owner included, until an
 * access request has passed every step (Vault Admin → Reporting Manager →
 * authenticator code) and its time window is open. The window closes on its
 * own; an expired unlock is swept to 'locked' on the next request that looks.
 *
 * Secrets never appear in a list or a detail response. The reveal endpoint is
 * the only way out, and every call to it is audited.
 *
 * Responses: { status: true, data, ... } on success; { status: false,
 * message, errors? } on refusal, with errors keyed by the API field.
 */
class CredVaultController extends Controller
{
    private const RANK_USE  = 0;
    private const RANK_VIEW = 1;
    private const RANK_COPY = 2;
    private const RANK_FULL = 3;
    /** Wrong authenticator codes one person may enter on one credential in 24 h (two voided requests). */
    private const OTP_DAILY_LIMIT = 6;

    private const PAGE_SIZE   = 10;
    private const IMPORT_TTL  = 1800;   // seconds a previewed import stays claimable
    // As the prototype accepts them: a type's own file field (crdField), and the extra attachments (crdXt).
    private const FIELD_FILE_TYPES = 'pdf,jpg,jpeg,png,pem,crt,cer,pfx';
    private const ATTACH_TYPES     = 'pdf,png,jpg,jpeg,webp,doc,docx,xls,xlsx,csv,txt';
    private const FILE_MAX_KB = 10240;
    private const MAX_EXTRA_ATTACHMENTS = 5;

    /** The non-secret columns every list, count and health pass needs. */
    private const LIGHT_COLUMNS = [
        'id', 'client_id', 'code', 'type', 'category_group', 'name', 'scope', 'owner_id', 'department_id',
        'url', 'username', 'risk', 'strength', 'has_password', 'twofa', 'rotation_days',
        'password_changed_at', 'secret_hash', 'lock_admin', 'lock_manager', 'lock_otp',
        'totp_linked_at', 'created_at', 'updated_at',
    ];

    /** What every access-request row needs, in one eager load. */
    private const REQUEST_RELATIONS = [
        'credential:id,client_id,code,name,type,category_group,risk,url,owner_id,deleted_at',
        'requester:id,name,designation,department_id,employee_code,client_id,user_type',
        'adminUser:id,name,designation', 'managerUser:id,name,designation',
        'adminDecider:id,name,designation', 'managerDecider:id,name,designation',
    ];

    /** Per-request answers that several helpers ask for repeatedly. */
    private array $memo = [];

    /* ══════════════════════════════ META ══════════════════════════════ */

    /** GET /credvault/meta — everything the forms need: types, enums, policy, me. */
    public function meta(Request $request)
    {
        $u   = $this->tenantUser($request);
        $pol = Policy::for($u->client_id);

        $types = array_map(fn ($k) => Credential::typeDef($k), array_keys(Credential::TYPES));

        return response()->json(['status' => true, 'data' => [
            'types'       => $types,
            'groups'      => collect(Credential::GROUPS)->map(fn ($g) => [
                'name' => $g, 'description' => Credential::GROUP_INFO[$g][0], 'icon' => Credential::GROUP_INFO[$g][1],
                'types' => collect($types)->where('group', $g)->pluck('key')->values(),
            ]),
            'risks'       => [
                ['key' => 'low', 'label' => 'Low'], ['key' => 'medium', 'label' => 'Medium'],
                ['key' => 'high', 'label' => 'High'], ['key' => 'critical', 'label' => 'Critical — needs approval to view'],
            ],
            'rotations'   => array_merge([['days' => null, 'label' => 'No rotation']],
                array_map(fn ($d) => ['days' => $d, 'label' => "Every {$d} days"], Credential::ROTATIONS)),
            'strengths'   => Credential::STRENGTH_LABELS,
            'permissions' => [
                ['key' => 'use',  'label' => 'Use Only',    'description' => 'Launch / autofill, password hidden'],
                ['key' => 'view', 'label' => 'View',        'description' => 'Reveal the password'],
                ['key' => 'copy', 'label' => 'Copy',        'description' => 'Reveal and copy'],
                ['key' => 'full', 'label' => 'Full Access', 'description' => 'Edit, share and delete'],
            ],
            // As the Share popup offers them: a policy limit hides "No expiry"; no limit hides 90 days.
            'share_durations'  => collect([[1, '1 day'], [7, '7 days'], [30, '30 days'], [90, '90 days'], [0, 'No expiry']])
                ->filter(fn ($d) => $pol['share_max_days'] ? ($d[0] && $d[0] <= $pol['share_max_days']) : $d[0] !== 90)
                ->map(fn ($d) => ['days' => $d[0] ?: null, 'label' => $d[1], 'critical_allowed' => $d[0] !== 0])->values(),
            'unlock_durations' => array_values(array_filter(AccessRequest::DURATIONS, fn ($m) => $m <= $pol['cp_max_minutes'])),
            'audit_actions'    => collect(AuditLog::ACTIONS)->map(fn ($v, $k) => ['key' => $k, 'label' => $v[0], 'severity' => $v[1], 'verb' => AuditLog::VERBS[$k] ?? $v[0]])->values(),
            'file_types'       => ['attachments' => explode(',', self::ATTACH_TYPES), 'file_fields' => explode(',', self::FIELD_FILE_TYPES), 'max_mb' => self::FILE_MAX_KB / 1024, 'max_attachments' => self::MAX_EXTRA_ATTACHMENTS],
            'policy'           => $pol,
            'me'               => [
                'id'              => $u->id,
                'name'            => $u->name,
                'is_vault_admin'  => $this->isAdmin($u),
                'department_id'   => $this->deptOf($u),
                'manager_user_id' => $this->managerOf($u),
            ],
        ]], 200);
    }

    /* ═══════════════════════════ CREDENTIALS ═══════════════════════════ */

    /**
     * GET /credvault/credentials
     *   ?tab=all|mine|team|shared|others   My Vault / Team Vault / Critical Vault tabs
     *                                  (others = not mine, any route — the Critical
     *                                  Vault's "Teams Critical Credentials" tab)
     *   &risk=critical                 the Critical Vault list
     *   &q= &type= &group= &department_id= &member_id= &page= &per_page=
     *
     * member_id (a login) or member_employee_id (a tree node) is the Team Vault
     * "credentials accessible to <person>" filter. It narrows what the caller
     * can already see, so it reveals nothing new and anyone may use it.
     *
     * Tab counts ignore the search box, as the prototype's do. The department
     * and member filters belong to the Team side: the "mine" tab ignores both.
     * tabs.sharedby is the Shared By Me count (active + expiring soon).
     */
    public function index(Request $request)
    {
        $u = $this->tenantUser($request);
        $f = $request->validate($this->listRules(['all', 'mine', 'team', 'shared', 'others']) + [
            'risk'               => ['nullable', Rule::in(Credential::RISKS)],
            'type'               => ['nullable', Rule::in(array_keys(Credential::TYPES))],
            'group'              => ['nullable', Rule::in(Credential::GROUPS)],
            'department_id'      => ['nullable', 'integer', 'min:1'],
            'member_id'          => ['nullable', 'integer', 'min:1'],
            'member_employee_id' => ['nullable', 'integer', 'min:1'],
        ]);
        $this->sweepUnlocks($u->client_id);
        $tab = $f['tab'] ?? 'all';

        $base = $this->visibleQuery($u);
        if (!empty($f['risk']))  $base->where('risk', $f['risk']);
        if (!empty($f['type']))  $base->where('type', $f['type']);
        if (!empty($f['group'])) $base->where('category_group', $f['group']);

        // The Team-side filters: everything but "mine".
        $teamSide = clone $base;
        if (!empty($f['department_id'])) $teamSide->where('department_id', $f['department_id']);
        $member = $this->memberFilter($u, $f);
        if ($member) $teamSide->whereIn('credvault_credentials.id', $this->visibleQuery($member)->select('credvault_credentials.id'));

        $sharedIds = $this->sharedWithMeIds($u);
        $views = [
            'all'    => fn () => (clone $teamSide),
            'mine'   => fn () => (clone $base)->where('owner_id', $u->id),
            'team'   => fn () => (clone $teamSide)->where('scope', 'team')->where('owner_id', '!=', $u->id)->whereNotIn('credvault_credentials.id', $sharedIds),
            'shared' => fn () => (clone $teamSide)->where('owner_id', '!=', $u->id)->whereIn('credvault_credentials.id', $sharedIds),
            'others' => fn () => (clone $teamSide)->where('owner_id', '!=', $u->id),
        ];
        $tabs = array_map(fn ($v) => $v()->count(), $views);
        $tabs['sharedby'] = CredentialShare::live()->where('client_id', $u->client_id)
            ->whereIn('credential_id', Credential::where('client_id', $u->client_id)->where('owner_id', $u->id)->select('id'))->count();

        $q = $views[$tab]();
        $this->credentialSearch($q, $u, $f['q'] ?? null);

        $page = $q->select(self::LIGHT_COLUMNS)
            ->with(['owner:id,name', 'department:id,name'])
            ->orderByDesc('updated_at')->orderByDesc('id')
            ->paginate($f['per_page'] ?? self::PAGE_SIZE, ['*'], 'page', $f['page'] ?? 1);

        $items  = collect($page->items());
        $access = $this->accessMap($items, $u);
        $reqs   = $this->openRequestsFor($u, $items->filter(fn ($c) => $c->isProtected())->pluck('id')->all());
        $shares = $this->liveShareCounts($items->pluck('id')->all());
        $pol    = Policy::for($u->client_id);

        return response()->json([
            'status' => true,
            'data'   => $items->map(fn ($c) => $this->row($c, $u, $pol, $access[$c->id] ?? null, $reqs[$c->id] ?? null, $shares[$c->id]['n'] ?? 0))->values(),
            'tabs'   => $tabs,
            'member' => $member ? ['id' => $member->id, 'name' => $member->name, 'designation' => $member->designation] : null,
            'meta'   => $this->pageMeta($page),
        ], 200);
    }

    /** The person behind member_id / member_employee_id — a login of this company. */
    private function memberFilter(User $u, array $f): ?User
    {
        if (!empty($f['member_employee_id'])) {
            $e = Employee::where('client_id', $u->client_id)->find($f['member_employee_id'], ['id', 'user_id', 'emp_code', 'client_id'])
                ?? $this->reject('That person is not part of your company.', 'member_employee_id', 404);
            $f['member_id'] = $e->resolved_user_id
                ?? $this->reject('This person has no CredVault login yet, so nothing is shared with them.', 'member_employee_id', 422);
        }
        if (empty($f['member_id'])) return null;

        return User::where('client_id', $u->client_id)->find($f['member_id'], ['id', 'name', 'designation', 'department_id', 'client_id', 'employee_code', 'user_type'])
            ?? $this->reject('That person is not part of your company.', 'member_id', 404);
    }

    /**
     * The list search: ID, name, username, url, category (type label), group
     * and owner — what the prototype's search box covers.
     */
    private function credentialSearch(Builder $q, User $u, ?string $term): void
    {
        if ($term === null || trim($term) === '') return;
        $like  = $this->likeTerm($term);
        $types = collect(Credential::TYPES)->filter(fn ($t) => str_contains(mb_strtolower($t[0]), mb_strtolower(trim($term))))->keys()->all();

        $q->where(function ($w) use ($like, $types, $u) {
            foreach (['name', 'code', 'username', 'url', 'category_group'] as $col) {
                $w->orWhereRaw("lower(coalesce(credvault_credentials.{$col}, '')) like ?", [$like]);
            }
            if ($types) $w->orWhereIn('credvault_credentials.type', $types);
            $w->orWhereIn('owner_id', User::where('client_id', $u->client_id)->whereRaw('lower(name) like ?', [$like])->select('id'));
        });
    }

    /** GET /credvault/credentials/next-code — preview of the next CRD- code; nothing is reserved. */
    public function nextCredentialCode(Request $request)
    {
        $u = $this->tenantUser($request);

        return response()->json(['status' => true, 'data' => [
            'next_code' => $this->peekCode('credvault_credentials', 'CRD', $u->client_id),
            'preview'   => true,
        ]], 200);
    }

    /** POST /credvault/credentials — multipart when files are attached, JSON otherwise. */
    public function store(Request $request)
    {
        $u = $this->tenantUser($request);

        return $this->persistCredential($request, $u, null);
    }

    /** GET /credvault/credentials/{id} — the View drawer. Secrets are masked, never sent. */
    public function show(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        $this->sweepUnlocks($u->client_id);
        [$c, $acc] = $this->findCredential($u, $id);

        return response()->json(['status' => true, 'data' => $this->detail($c, $u, $acc)], 200);
    }

    /**
     * POST|PUT /credvault/credentials/{id}
     *
     * Partial: a type field left out keeps its value, so the form need never
     * hold a secret to save an unrelated change. POST is accepted beside PUT
     * because PHP does not read multipart bodies on a PUT.
     */
    public function update(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        [$c, $acc] = $this->findCredential($u, $id, self::RANK_FULL,
            'Only the owner, a Vault Admin or someone with Full Access can edit this credential.');

        // A HOD or Full share may edit the details, never what guards them: lowering
        // the risk, turning 2FA off or relinking the authenticator would let them
        // unlock it without the approvals (canFlags' edit_protection says the same).
        if (!in_array($acc[1], ['owner', 'admin'], true) && ($what = $this->protectionChange($request, $c))) {
            $this->reject("Only the owner or a Vault Admin can change the {$what}.", null, 403);
        }

        return $this->persistCredential($request, $u, $c);
    }

    private function tightenSharesForCritical(User $u, Credential $c, array $pol): void
    {
        $limit = now()->addDays($pol['share_max_days'] > 0 ? $pol['share_max_days'] : 30)->endOfDay();
        foreach (CredentialShare::live()->where('credential_id', $c->id)->lockForUpdate()->get() as $s) {
            if (!$pol['share_critical']) {
                $s->forceFill(['revoked_at' => now(), 'revoked_by' => $u->id])->save();
                $this->audit($u, 'revoke', $c, 'Share ended — sharing critical credentials is turned off', ['share_id' => $s->id]);
                continue;
            }
            $was = [$s->permission, $s->expires_at?->toDateString()];
            if ($s->permission === 'full') $s->permission = 'copy';
            if (!$s->expires_at || $s->expires_at->gt($limit)) $s->expires_at = $limit;
            if ($s->isDirty()) {
                $s->save();
                $this->audit($u, 'share', $c, 'Share limited for a critical credential · ' . ucfirst($s->permission) . ' until ' . $s->expires_at->format('d/m/Y'),
                    ['share_id' => $s->id, 'was' => $was]);
            }
        }
        $this->endOrphanedShares($u, $c);
    }

    /**
     * A share passed on by someone other than the owner rides on that person's Full
     * Access. Whenever they lose it (revoke, downgrade, removal, the credential turning
     * critical) the shares they made end too — repeated until stable, so a chain of
     * re-shares unwinds however deep it goes.
     */
    private function endOrphanedShares(User $actor, Credential $c): void
    {
        for ($round = 0; $round < 10; $round++) {
            $ended = 0;
            $live  = CredentialShare::live()->where('credential_id', $c->id)->where('shared_by', '!=', $c->owner_id)->get();
            foreach ($live->groupBy('shared_by') as $by => $shares) {
                $holder = User::find($by);
                if ($holder && ($this->accessMap(collect([$c]), $holder)[$c->id][0] ?? -1) >= self::RANK_FULL) continue;
                foreach ($shares as $s) {
                    $s->forceFill(['revoked_at' => now(), 'revoked_by' => $actor->id])->save();
                    $this->audit($actor, 'revoke', $c, 'Share ended — ' . ($holder->name ?? 'the person who shared it') . ' no longer has Full Access',
                        ['share_id' => $s->id]);
                    $ended++;
                }
            }
            if (!$ended) return;
        }
    }

    /** When the user's own Full share on $c ends — null when one of them never ends. */
    private function ownShareEnd(User $u, Credential $c): ?Carbon
    {
        $dept = $this->deptOf($u);
        $ends = CredentialShare::live()->where('credential_id', $c->id)->where('permission', 'full')
            ->where(function ($w) use ($u, $dept) {
                $w->where(fn ($x) => $x->where('recipient_type', 'user')->where('recipient_user_id', $u->id));
                if ($dept) $w->orWhere(fn ($x) => $x->where('recipient_type', 'team')->where('recipient_department_id', $dept));
            })->pluck('expires_at');

        return $ends->isEmpty() || $ends->contains(null) ? null : Carbon::parse($ends->max());
    }

    /** What, if anything, this edit would change about the credential's protection. Unchanged values pass. */
    private function protectionChange(Request $r, Credential $c): ?string
    {
        $on = fn ($v) => filter_var($v, FILTER_VALIDATE_BOOLEAN);
        if ($r->filled('totp_secret') || $r->filled('totp_code')) return 'authenticator';
        if ($r->has('risk') && $r->input('risk') !== $c->risk) return 'risk level';
        foreach (['twofa', 'fields.twofa'] as $k) {
            if ($r->has($k) && $on($r->input($k)) !== ($c->twofa === 'yes')) return 'two-factor setting';
        }
        if ($r->has('scope') && $r->input('scope') !== $c->scope) return 'vault';
        if ($r->has('department_id') && (int) $r->input('department_id') !== (int) $c->department_id) return 'team';
        foreach (['lock_admin', 'lock_manager', 'lock_otp'] as $k) {
            if ($r->has($k) && $on($r->input($k)) !== (bool) $c->{$k}) return 'protection steps';
        }
        foreach (['lock_admin_user_id', 'lock_manager_user_id'] as $k) {
            if ($r->has($k) && (int) $r->input($k) !== (int) $c->{$k}) return 'approvers';
        }
        return null;
    }

    /**
     * DELETE /credvault/credentials/{id} — moves to the Recycle Bin. Shares pause while it is there.
     *
     * On a credential someone shared with you it is the prototype's "Remove
     * from your vault?": your own share ends, the credential itself is untouched.
     */
    public function destroy(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        [$c, $acc] = $this->findCredential($u, $id);

        if ($acc[1] === 'share') {
            $mine = CredentialShare::live()->where('credential_id', $c->id)->where('recipient_type', 'user')->where('recipient_user_id', $u->id)->get();
            if ($mine->isEmpty()) {
                $this->reject('This credential is shared with your whole team. Ask the owner to remove the team share.', null, 409);
            }
            $this->inTransaction('remove the credential from your vault', function () use ($mine, $u, $c) {
                CredentialShare::whereIn('id', $mine->pluck('id'))->update(['revoked_at' => now(), 'revoked_by' => $u->id, 'updated_at' => now()]);
                $this->audit($u, 'revoke', $c, 'Removed from their vault by the recipient', ['share_ids' => $mine->pluck('id')->all()]);
                $this->endOrphanedShares($u, $c);
            });

            return response()->json(['status' => true, 'message' => "“{$c->name}” removed from your vault. The owner's copy is unchanged.", 'data' => ['id' => $c->id, 'removed_share' => true]], 200);
        }
        if ($acc[0] < self::RANK_FULL) {
            $this->reject('Only the owner, a Vault Admin or someone with Full Access can delete this credential.', null, 403);
        }

        if ($c->risk === 'critical' && !in_array($acc[1], ['owner', 'admin'], true)) {
            $this->reject('A critical credential can only be moved to the bin by its owner or a Vault Admin.', null, 403);
        }

        $pol = Policy::for($u->client_id);
        $this->inTransaction('move the credential to the bin', function () use ($c, $u) {
            $c->deleted_by = $u->id;
            $c->saveQuietly();
            $c->delete();
            // Any unlock in progress on it ends — a binned credential reveals nothing.
            AccessRequest::where('credential_id', $c->id)->whereIn('status', AccessRequest::OPEN)
                ->update(['status' => 'cancelled', 'updated_at' => now()]);
            $this->audit($u, 'bin', $c, 'Moved to Recycle Bin');
        });

        return response()->json([
            'status'  => true,
            'message' => "“{$c->name}” moved to the Recycle Bin. It can be restored for {$pol['bin_days']} days.",
            'data'    => ['id' => $c->id, 'purges_at' => now()->addDays($pol['bin_days'])->toIso8601String()],
        ], 200);
    }

    /**
     * POST /credvault/credentials/{id}/reveal   { action: reveal|copy, field? }
     *
     * The only way a secret leaves the server. field defaults to the type's
     * main secret; any masked field, or 'recovery_key', may be named. On a
     * critical credential someone else's reveal or copy also notifies the
     * owner, as the View drawer's warning promises.
     */
    public function reveal(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate([
            'action' => ['required', Rule::in(['reveal', 'copy'])],
            'field'  => ['nullable', 'string', 'max:40'],
        ]);
        $this->sweepUnlocks($u->client_id);

        [$c, $acc] = $this->findCredential($u, $id, self::RANK_VIEW,
            'Your access is Use Only — you can sign in with this credential, but not see its secret.');
        if ($d['action'] === 'copy' && $acc[0] < self::RANK_COPY) {
            $this->reject('Your access lets you view this credential but not copy it.', 'action', 403);
        }
        $this->assertUnlocked($c, $u);

        $def   = Credential::typeDef($c->type);
        $field = $d['field'] ?? $def['sec'];
        if ($field === 'recovery_key') {
            $label = 'Recovery key';
            $value = $c->fields['_recovery_key'] ?? null;
        } else {
            $spec = collect($def['fields'])->firstWhere('key', $field);
            if (!$spec || !$spec['secret']) $this->reject('That is not a secret field of this credential.', 'field');
            $label = $spec['label'];
            $value = $field === $def['sec'] ? ($c->secret ?? $c->fields[$field] ?? null) : ($c->fields[$field] ?? null);
        }
        if ($value === null || $value === '') $this->reject("No {$label} is stored on this credential.", 'field', 404);

        $this->audit($u, $d['action'], $c, $label . ($d['action'] === 'copy' ? ' copied' : ' revealed'),
            ['field' => $field], $c->isProtected() ? 'Critical Vault' : 'My Vault');
        if ($c->risk === 'critical' && $c->owner_id !== $u->id) {
            $this->notify([$c->owner_id], 'critical_revealed', 'Critical credential ' . ($d['action'] === 'copy' ? 'copied' : 'revealed'),
                "{$u->name} " . ($d['action'] === 'copy' ? 'copied' : 'revealed') . " the {$label} of “{$c->name}”.",
                ['credential_id' => $c->id, 'url' => '/credentials-vault/critical-vault']);
        }

        return response()->json(['status' => true, 'data' => [
            'field'                 => $field,
            'label'                 => $label,
            'value'                 => $value,
            // The client hides a revealed value and clears a copied one after this.
            'hide_after_seconds'    => 30,
            'clear_clipboard_after' => 30,
        ]], 200);
    }

    /**
     * POST /credvault/credentials/{id}/events { action: view|launch|copy, field? }
     *
     * The drawer opened, the site launched, or a plain field (username,
     * registered email…) copied — the copies the prototype logs as "Field copied".
     */
    public function logEvent(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate([
            'action' => ['required', Rule::in(['view', 'launch', 'copy'])],
            'field'  => ['required_if:action,copy', 'nullable', 'string', 'max:40'],
        ]);
        [$c] = $this->findCredential($u, $id);

        $detail = match ($d['action']) {
            'launch' => $c->url ? 'Launched ' . $c->url : $this->reject('This credential has no website to launch.', 'action'),
            'view'   => 'Opened credential details',
            'copy'   => $this->plainFieldLabel($c, (string) $d['field']) . ' copied',
        };
        $this->audit($u, $d['action'] === 'copy' ? 'view' : $d['action'], $c, $detail, array_filter(['field' => $d['field'] ?? null]));

        return response()->json(['status' => true, 'message' => 'Recorded.'], 201);
    }

    /** The label of a field that is NOT secret — a secret is copied through /reveal, which checks rank. */
    private function plainFieldLabel(Credential $c, string $field): string
    {
        $extras = ['reg_email' => 'Registered email', 'reg_phone' => 'Registered phone', 'url' => 'Website', 'username' => 'Username'];
        if (isset($extras[$field])) return $extras[$field];

        $spec = collect(Credential::typeDef($c->type)['fields'])->firstWhere('key', $field)
            ?? $this->reject('That is not a field of this credential.', 'field');
        if ($spec['secret']) $this->reject('Copy a secret through /reveal.', 'field');

        return $spec['label'];
    }

    /** GET /credvault/credentials/{id}/activity?page= — the drawer's Activity tab, newest first. */
    public function activity(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        $f = $request->validate(['page' => ['nullable', 'integer', 'min:1'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);
        [$c] = $this->findCredential($u, $id);

        $page = AuditLog::where('client_id', $u->client_id)->where('credential_id', $c->id)
            ->with('user:id,name,user_type,designation')->orderByDesc('id')
            ->paginate($f['per_page'] ?? 50, ['*'], 'page', $f['page'] ?? 1);

        return response()->json([
            'status' => true,
            'data'   => $this->eventRows(collect($page->items()), $u),
            'meta'   => $this->pageMeta($page),
        ], 200);
    }

    /** GET /credvault/credentials/{id}/attachments/{key} — streams one stored file. */
    public function attachment(Request $request, int $id, string $key)
    {
        $u = $this->tenantUser($request);
        [$c] = $this->findCredential($u, $id, self::RANK_VIEW, 'Your access is Use Only — attachments are not included.');
        $this->assertUnlocked($c, $u);

        $file = collect($c->attachments ?? [])->firstWhere('key', $key)
            ?? $this->reject('That attachment does not exist.', null, 404);
        if (!Storage::disk('local')->exists($file['path'])) $this->reject('The file is missing from storage.', null, 404);

        $this->audit($u, 'view', $c, 'Attachment opened: ' . $file['name']);

        return Storage::disk('local')->download($file['path'], $file['name']);
    }

    /**
     * POST /credvault/authenticator/new { label? } — a fresh authenticator
     * secret for the form's "Link your authenticator app" box: QR, setup key,
     * then one code, all sent with the credential's save. Nothing is stored
     * until that save verifies the code; asking again simply gives a new one.
     */
    public function authenticatorNew(Request $request)
    {
        $this->tenantUser($request);
        $d = $request->validate(['label' => ['nullable', 'string', 'max:100']]);
        $secret = Totp::newSecret();

        return response()->json(['status' => true, 'data' => [
            'secret'         => $secret,
            'secret_display' => trim(chunk_split($secret, 4, ' ')),
            'otpauth_uri'    => Totp::uri($secret, $d['label'] ?? 'CredVault'),
            'digits'         => 6,
            'period'         => 30,
            'works_with'     => 'Google Authenticator, Microsoft Authenticator, Authy and any TOTP app',
        ]], 200);
    }

    /**
     * GET /credvault/approvers — the Critical Access Protection pickers: the
     * Vault Admins, and the people who can approve as a manager, with the
     * defaults the form pre-selects (the policy's admin, the user's own
     * reporting manager).
     */
    public function approvers(Request $request)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate(['q' => ['nullable', 'string', 'max:100']]);
        $pol = Policy::for($u->client_id);
        $defAdmin = $this->liveAdmin($pol['cp_admin_user_id'], $u->client_id);

        $admins = User::whereIn('id', $this->adminIds($u->client_id))->orderBy('name')->get(['id', 'name', 'designation', 'user_type']);
        $managers = User::where('client_id', $u->client_id)->where('status', 'active')
            ->when($d['q'] ?? null, fn ($q, $t) => $this->applySearch($q, $t, ['name', 'designation']))
            ->orderBy('name')->limit(200)->get(['id', 'name', 'designation', 'user_type']);
        $mine = $this->managerOf($u);
        $card = fn ($x) => ['id' => $x->id, 'name' => $x->name, 'designation' => $x->designation, 'initials' => $this->initials($x->name)];

        return response()->json(['status' => true, 'data' => [
            'admins'   => $admins->map(fn ($x) => $card($x) + ['role' => 'Vault Admin'])->values(),
            'managers' => $managers->map(fn ($x) => $card($x) + ['role' => $x->id === $mine ? 'Your reporting manager' : ($x->designation ?: 'Manager')])->values(),
            'defaults' => [
                'admin_user_id'   => $defAdmin,
                'admin_label'     => $defAdmin ? User::whereKey($defAdmin)->value('name') : 'Any Vault Admin',
                'manager_user_id' => $mine,
                'manager_label'   => $mine ? User::whereKey($mine)->value('name') : 'The requester’s reporting manager',
            ],
        ]], 200);
    }

    private function initials(?string $name): string
    {
        $parts = preg_split('/\s+/', trim((string) $name)) ?: [];
        return strtoupper(mb_substr($parts[0] ?? '', 0, 1) . mb_substr(count($parts) > 1 ? end($parts) : '', 0, 1));
    }

    /* ═════════════════════════════ SHARING ═════════════════════════════ */

    /** GET /credvault/share-recipients?q= — people and teams a credential can be shared with. */
    public function shareRecipients(Request $request)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate(['q' => ['nullable', 'string', 'max:100']]);

        $users = User::where('client_id', $u->client_id)->where('status', 'active')->where('id', '!=', $u->id)
            ->when($d['q'] ?? null, fn ($q, $t) => $this->applySearch($q, $t, ['name', 'email']))
            ->orderBy('name')->limit(200)->get(['id', 'name', 'email', 'user_type', 'designation']);

        $counts = $this->memberCounts($u->client_id);
        $teams  = $this->clientDepartments($u)->filter(fn ($dep) => ($counts[$dep->id] ?? 0) > 0)
            ->when($d['q'] ?? null, fn ($c, $t) => $c->filter(fn ($dep) => Str::contains(Str::lower($dep->name), Str::lower($t))))
            ->map(fn ($dep) => ['id' => $dep->id, 'name' => $dep->name, 'members' => $counts[$dep->id] ?? 0])->values();

        return response()->json(['status' => true, 'data' => [
            'users' => $users->map(fn ($x) => ['id' => $x->id, 'name' => $x->name, 'email' => $x->email, 'designation' => $x->designation, 'user_type' => $x->user_type]),
            'teams' => $teams,
        ]], 200);
    }

    /**
     * POST /credvault/credentials/{id}/shares
     *   { recipient_type: user|team, recipient_id, permission, duration_days? | expires_at? (Y-m-d), reason? }
     *
     * Neither duration nor date means no expiry. Sharing again with the same
     * recipient updates the live share instead of adding a second one.
     */
    public function share(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate([
            'recipient_type' => ['required', Rule::in(CredentialShare::RECIPIENTS)],
            'recipient_id'   => ['required', 'integer', 'min:1'],
            'permission'     => ['required', Rule::in(CredentialShare::PERMISSIONS)],
            'duration_days'  => ['nullable', 'integer', Rule::in([1, 7, 30, 90]), 'prohibits:expires_at'],
            'expires_at'     => ['nullable', 'date_format:Y-m-d', 'after_or_equal:today'],
            'reason'         => ['nullable', 'string', 'max:500'],
        ]);
        [$c, $acc] = $this->findCredential($u, $id, self::RANK_FULL, 'Only the owner or someone with Full Access can share this credential.');
        $pol = Policy::for($u->client_id);

        $until = match (true) {
            !empty($d['expires_at'])    => Carbon::createFromFormat('Y-m-d', $d['expires_at'])->endOfDay(),
            !empty($d['duration_days']) => now()->addDays($d['duration_days']),
            default                     => null,
        };

        // Someone who holds Full Access through a share cannot pass on more than they have:
        // their re-share ends when their own share does (a longer or open-ended pick is
        // shortened to that, and the response says so).
        $capped = null;
        if ($acc[1] === 'share' && ($cap = $this->ownShareEnd($u, $c)) !== null && (!$until || $until->gt($cap))) {
            $until  = $cap->copy();
            $capped = $cap;
        }

        if ($c->risk === 'critical') {
            if (!$pol['share_critical']) $this->reject('Sharing critical credentials is turned off in CredVault Policies.', null, 403);
            if ($d['permission'] === 'full') $this->reject('A critical credential cannot be shared with Full Access.', 'permission');
            if (!$until) $this->reject('A critical credential must be shared with an end date.', 'expires_at');
        }
        if ($pol['share_max_days'] > 0) {
            if (!$until) $this->reject("Policy allows shares of up to {$pol['share_max_days']} days — pick an end date.", 'expires_at');
            if ($until->gt(now()->addDays($pol['share_max_days'])->endOfDay())) {
                $this->reject("Policy allows shares of up to {$pol['share_max_days']} days.", 'expires_at');
            }
        }
        $reason = trim((string) ($d['reason'] ?? ''));
        if ($pol['share_reason'] && mb_strlen($reason) < 5) {
            $this->reject('Give a reason for sharing (at least 5 characters).', 'reason');
        }

        if ($d['recipient_type'] === 'user') {
            $to = User::where('client_id', $u->client_id)->where('status', 'active')->find($d['recipient_id'])
                ?? $this->reject('That person is not an active user of your company.', 'recipient_id', 404);
            if ($to->id === $c->owner_id) $this->reject('That person owns this credential already.', 'recipient_id');
            if ($to->id === $u->id) $this->reject('You cannot share a credential with yourself.', 'recipient_id');
            $toName = $to->name;
        } else {
            $dep = $this->clientDepartments($u)->firstWhere('id', $d['recipient_id'])
                ?? $this->reject('That team does not exist.', 'recipient_id', 404);
            $toName = $dep->name;
        }

        $share = $this->inTransaction('share the credential', function () use ($c, $u, $d, $until, $reason, $toName) {
            $match = fn ($q) => $q->where('credential_id', $c->id)->where('recipient_type', $d['recipient_type'])
                ->where($d['recipient_type'] === 'user' ? 'recipient_user_id' : 'recipient_department_id', $d['recipient_id'])
                ->whereNull('revoked_at');

            $share = $match(CredentialShare::query())->lockForUpdate()->first() ?? new CredentialShare([
                'client_id'               => $u->client_id,
                'credential_id'           => $c->id,
                'recipient_type'          => $d['recipient_type'],
                'recipient_user_id'       => $d['recipient_type'] === 'user' ? $d['recipient_id'] : null,
                'recipient_department_id' => $d['recipient_type'] === 'team' ? $d['recipient_id'] : null,
            ]);
            $renewed = $share->exists;
            if (!$share->exists) $share->shared_by = $u->id;   // a renewal keeps who originally shared it
            $share->fill(['permission' => $d['permission'], 'expires_at' => $until, 'reason' => $reason ?: null]);

            try {
                $share->save();
            } catch (QueryException $e) {
                // Two clicks raced past the lookup; the partial unique index stopped the second.
                $this->reject("This credential was just shared with {$toName}. Refresh and try again.", null, 409);
            }
            if ($renewed) $this->endOrphanedShares($u, $c);   // a Full share renewed as less ends what it passed on

            $this->audit($u, 'share', $c, ($renewed ? 'Share renewed for ' : 'Shared with ') . $toName
                . ' · ' . ucfirst($d['permission']) . ($until ? ' until ' . $until->format('d/m/Y') : ' · no expiry'),
                ['share_id' => $share->id, 'permission' => $d['permission']]);
            if ($share->recipient_type === 'user') {
                $this->notify([$share->recipient_user_id], 'shared', $renewed ? 'Share updated' : 'Credential shared with you',
                    "{$u->name} shared “{$c->name}” with you (" . ucfirst($d['permission']) . ($until ? ', until ' . $until->format('d/m/Y') : '') . ').',
                    ['credential_id' => $c->id, 'url' => '/credentials-vault/my-vault']);
            }

            return [$share, $renewed];
        });

        [$row, $renewed] = $share;
        $row->load(['credential:id,code,name,type,risk,url,category_group,updated_at', 'recipientUser:id,name,designation', 'recipientDepartment:id,name']);

        return response()->json([
            'status'  => true,
            'message' => ($renewed ? 'Share updated for ' : 'Shared with ') . $toName . '.'
                . ($capped ? ' It ends on ' . $capped->format('d/m/Y') . ', when your own access does.' : ''),
            'data'    => $this->shareRow($row, $u->client_id),
        ], $renewed ? 200 : 201);
    }

    /**
     * GET /credvault/shares?tab=all|active|soon|expired|revoked&q=&credential_id=
     *
     * Shared By Me — one row per share, on credentials I own or shares I made.
     * credential_id is the exact filter Password Health's "Fix" for an
     * over-shared credential opens. Tab counts ignore the search box.
     */
    public function sharedByMe(Request $request)
    {
        $u = $this->tenantUser($request);
        $f = $request->validate($this->listRules(['all', 'active', 'soon', 'expired', 'revoked']) + [
            'credential_id' => ['nullable', 'integer', 'min:1'],
        ]);

        $mine = Credential::where('client_id', $u->client_id)->where('owner_id', $u->id)->select('id');
        $base = CredentialShare::where('client_id', $u->client_id)
            ->whereIn('credential_id', Credential::where('client_id', $u->client_id)->select('id'))
            ->where(fn ($w) => $w->whereIn('credential_id', $mine)->orWhere('shared_by', $u->id));
        if (!empty($f['credential_id'])) $base->where('credential_id', $f['credential_id']);

        $soon = now()->addDays(3);
        $states = [
            'revoked' => fn ($q) => $q->whereNotNull('revoked_at'),
            'expired' => fn ($q) => $q->whereNull('revoked_at')->where('expires_at', '<=', now()),
            'soon'    => fn ($q) => $q->whereNull('revoked_at')->where('expires_at', '>', now())->where('expires_at', '<', $soon),
            'active'  => fn ($q) => $q->whereNull('revoked_at')->where(fn ($w) => $w->whereNull('expires_at')->orWhere('expires_at', '>=', $soon)),
        ];
        $tabs = ['all' => (clone $base)->count()];
        foreach ($states as $k => $fn) $tabs[$k] = $fn(clone $base)->count();
        $tabs['live'] = $tabs['active'] + $tabs['soon'];   // the My Vault "Shared By Me" tab badge

        if ($term = $f['q'] ?? null) {
            $like  = $this->likeTerm($term);
            $t     = mb_strtolower(trim($term));
            $perms = collect(['use' => 'use only', 'view' => 'view', 'copy' => 'copy', 'full' => 'full access'])->filter(fn ($l) => str_contains($l, $t))->keys()->all();
            $types = collect(Credential::TYPES)->filter(fn ($x) => str_contains(mb_strtolower($x[0]), $t))->keys()->all();
            $base->where(function ($w) use ($like, $u, $perms, $types) {
                $w->whereRaw('lower(coalesce(reason, \'\')) like ?', [$like])
                  ->orWhereIn('credential_id', Credential::where('client_id', $u->client_id)->where(function ($x) use ($like, $types) {
                      $x->whereRaw('lower(name) like ?', [$like])->orWhereRaw('lower(code) like ?', [$like])
                        ->orWhereRaw('lower(category_group) like ?', [$like]);
                      if ($types) $x->orWhereIn('type', $types);
                  })->select('id'))
                  ->orWhereIn('recipient_user_id', User::where('client_id', $u->client_id)->whereRaw('lower(name) like ?', [$like])->select('id'))
                  ->orWhereIn('recipient_department_id', Departments::whereRaw('lower(name) like ?', [$like])->select('id'));
                if ($perms) $w->orWhereIn('permission', $perms);
            });
        }
        if (($tab = $f['tab'] ?? 'all') !== 'all') $states[$tab]($base);

        $page = $base->with(['credential:id,code,name,type,risk,url,category_group,updated_at', 'recipientUser:id,name,designation', 'recipientDepartment:id,name'])
            ->orderByRaw('case when revoked_at is not null then 3 when expires_at is not null and expires_at <= ? then 2 when expires_at is not null and expires_at < ? then 0 else 1 end', [now(), $soon])
            ->orderByDesc('created_at')
            ->paginate($f['per_page'] ?? self::PAGE_SIZE, ['*'], 'page', $f['page'] ?? 1);

        return response()->json([
            'status' => true,
            'data'   => collect($page->items())->map(fn ($s) => $this->shareRow($s, $u->client_id))->values(),
            'tabs'   => $tabs,
            'meta'   => $this->pageMeta($page),
        ], 200);
    }

    /** DELETE /credvault/shares/{id} — revoke. The row stays as the record of who had access. */
    public function revokeShare(Request $request, int $id)
    {
        $u = $this->tenantUser($request);

        $share = CredentialShare::where('client_id', $u->client_id)->with('credential')->find($id)
            ?? $this->reject('Share not found.', null, 404);
        $c = $share->credential;
        $allowed = $c && ($c->owner_id === $u->id || $share->shared_by === $u->id || ($c->scope === 'team' && $this->isAdmin($u)));
        if (!$allowed) $this->reject('Only the owner, the person who shared it or a Vault Admin can revoke this share.', null, 403);

        $fresh = $this->inTransaction('revoke the share', function () use ($share, $u, $c) {
            $fresh = CredentialShare::lockForUpdate()->find($share->id);
            if ($fresh->revoked_at) $this->reject('This share was already revoked.', null, 409);
            $fresh->forceFill(['revoked_at' => now(), 'revoked_by' => $u->id])->save();

            $to = $fresh->recipient_type === 'user'
                ? User::whereKey($fresh->recipient_user_id)->value('name')
                : Departments::whereKey($fresh->recipient_department_id)->value('name');
            $this->audit($u, 'revoke', $c, 'Access revoked for ' . ($to ?? 'recipient'), ['share_id' => $fresh->id]);

            $this->endOrphanedShares($u, $c);

            return $fresh;
        });
        $fresh->load(['credential:id,code,name,type,risk,url,category_group,updated_at', 'recipientUser:id,name,designation', 'recipientDepartment:id,name']);

        return response()->json(['status' => true, 'message' => 'Access revoked.', 'data' => $this->shareRow($fresh, $u->client_id)], 200);
    }

    /* ════════════════════════════ TEAM VAULT ════════════════════════════ */

    /** The prototype's six levels, in display order. */
    private const LEVELS = [
        'admin'  => 'Admin',
        'hod'    => 'HOD',
        'tl'     => 'Team Lead',
        'exec'   => 'Executive',
        'emp'    => 'Employee',
        'intern' => 'Intern',
    ];

    /** A member's level, read from the HR designation (Head of Department, Team Leader, Executive, Intern / Trainee …). */
    private function levelOf(?string $designation): string
    {
        $d = mb_strtolower((string) $designation);
        return match (true) {
            str_contains($d, 'head of department') || str_contains($d, 'hod') => 'hod',
            str_contains($d, 'team lead')                                      => 'tl',
            str_contains($d, 'executive')                                      => 'exec',
            str_contains($d, 'intern') || str_contains($d, 'trainee')          => 'intern',
            default                                                            => 'emp',
        };
    }

    /** GET /credvault/team/departments — the left pane: admin card and one card per department. */
    public function teamDepartments(Request $request)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate(['q' => ['nullable', 'string', 'max:100']]);

        $levels = $this->levelCounts($u->client_id);
        $creds  = Credential::where('client_id', $u->client_id)->where('scope', 'team')
            ->selectRaw('department_id, count(*) as n, sum(case when risk = ? then 1 else 0 end) as crit', ['critical'])
            ->groupBy('department_id')->get()->keyBy('department_id');

        $deps = $this->clientDepartments($u)->filter(fn ($x) => isset($levels[$x->id]) || isset($creds[$x->id]));

        $rows = $deps->map(fn ($x) => [
            'id'                   => $x->id,
            'name'                 => $x->name,
            'hod'                  => $this->hodOf($x, $u->client_id),
            'members'              => array_sum($levels[$x->id] ?? []),
            'levels'               => $this->levelList($levels[$x->id] ?? []),
            'credentials'          => (int) ($creds[$x->id]->n ?? 0),
            'critical_credentials' => (int) ($creds[$x->id]->crit ?? 0),
        ])->when($d['q'] ?? null, fn ($c, $t) => $c->filter(
            fn ($r) => Str::contains(Str::lower($r['name'] . ' ' . ($r['hod']['name'] ?? '')), Str::lower($t))
        ))->values();

        $admins = User::whereIn('id', $this->adminIds($u->client_id))->get(['id', 'name']);
        $all = [];
        foreach ($levels as $byLevel) foreach ($byLevel as $lv => $n) $all[$lv] = ($all[$lv] ?? 0) + $n;
        $all['admin'] = $admins->count();

        return response()->json(['status' => true, 'data' => [
            'admin' => [
                'admins'      => $admins->map(fn ($a) => ['id' => $a->id, 'name' => $a->name, 'initials' => $this->initials($a->name), 'role' => 'Vault Administrator']),
                'members'     => array_sum($all),
                'departments' => $deps->count(),
                'hods'        => $deps->filter(fn ($x) => filled($x->head))->count(),
                'levels'      => $this->levelList($all),
            ],
            'departments' => $rows,
        ]], 200);
    }

    /**
     * GET /credvault/team/departments/{id} — one department's hierarchy.
     * GET /credvault/team/organisation       — the admin card's "View all": every department.
     *
     * Members come flat, each with manager_employee_id and a level, so the
     * client draws the tree; a member whose manager sits outside the set is a root.
     */
    public function teamDepartment(Request $request, int $id)
    {
        $u   = $this->tenantUser($request);
        $dep = $this->clientDepartments($u)->firstWhere('id', $id) ?? $this->reject('Department not found.', null, 404);

        return response()->json(['status' => true, 'data' => $this->hierarchy($u, $dep)], 200);
    }

    public function teamOrganisation(Request $request)
    {
        $u = $this->tenantUser($request);

        return response()->json(['status' => true, 'data' => $this->hierarchy($u, null)], 200);
    }

    private function hierarchy(User $u, ?Departments $dep): array
    {
        $emps = Employee::where('client_id', $u->client_id)->where('status', 'Active')
            ->when($dep, fn ($q) => $q->where('department_id', $dep->id), fn ($q) => $q->whereNotNull('department_id'))
            ->with('designation:id,name')
            ->get(['id', 'user_id', 'emp_code', 'first_name', 'last_name', 'display_name', 'department_id', 'designation_id', 'reporting_manager_id', 'reporting_manager_user_id']);

        // users.employee_code is the second route to a login when employees.user_id is empty.
        $byCode = User::where('client_id', $u->client_id)->whereIn('employee_code', $emps->whereNull('user_id')->pluck('emp_code')->filter()->all())
            ->pluck('id', 'employee_code');
        $ids    = $emps->pluck('id')->all();
        $deps   = $this->clientDepartments($u)->keyBy('id');

        $members = $emps->map(function ($e) use ($byCode, $ids, $deps) {
            $name = trim($e->display_name ?: ($e->first_name . ' ' . $e->last_name));
            $level = $this->levelOf($e->designation?->name);
            return [
                'employee_id'         => $e->id,
                'user_id'             => $e->user_id ?: ($byCode[$e->emp_code] ?? null),
                'name'                => $name,
                'initials'            => $this->initials($name),
                'designation'         => $e->designation?->name,
                'level'               => $level,
                'level_label'         => self::LEVELS[$level],
                'department'          => ['id' => $e->department_id, 'name' => $deps[$e->department_id]->name ?? null],
                'manager_employee_id' => in_array($e->reporting_manager_id, $ids, true) ? $e->reporting_manager_id : null,
                'manager_user_id'     => $e->reporting_manager_user_id,
            ];
        })->values();
        $counts = $members->countBy('level')->all();

        $creds = Credential::where('client_id', $u->client_id)->where('scope', 'team')
            ->when($dep, fn ($q) => $q->where('department_id', $dep->id))
            ->selectRaw('count(*) as n, sum(case when risk = ? then 1 else 0 end) as crit', ['critical'])->first();

        return [
            'department' => $dep ? ['id' => $dep->id, 'name' => $dep->name, 'hod' => $this->hodOf($dep, $u->client_id)] : null,
            'stats'      => [
                'members'              => $members->count(),
                'levels'               => count($counts),
                'teams'                => $counts['tl'] ?? 0,
                'departments'          => $dep ? 1 : $members->pluck('department.id')->unique()->count(),
                'hods'                 => $counts['hod'] ?? 0,
                'credentials'          => (int) $creds->n,
                'critical_credentials' => (int) $creds->crit,
            ],
            'levels'  => $this->levelList($counts),
            'members' => $members,
        ];
    }

    /** [department_id => [level => active members]] for the tenant, in one query. */
    private function levelCounts(int $clientId): array
    {
        return $this->memo("levels:{$clientId}", function () use ($clientId) {
            $rows = Employee::where('employees.client_id', $clientId)->where('employees.status', 'Active')->whereNotNull('employees.department_id')
                ->leftJoin('master_designations as d', 'd.id', '=', 'employees.designation_id')
                ->selectRaw('employees.department_id, d.name as designation, count(*) as n')
                ->groupBy('employees.department_id', 'd.name')->get();
            $out = [];
            foreach ($rows as $r) {
                $lv = $this->levelOf($r->designation);
                $out[$r->department_id][$lv] = ($out[$r->department_id][$lv] ?? 0) + (int) $r->n;
            }
            return $out;
        });
    }

    private function levelList(array $counts): array
    {
        return collect(self::LEVELS)->map(fn ($label, $key) => ['level' => $key, 'label' => $label, 'count' => $counts[$key] ?? 0])
            ->filter(fn ($l) => $l['count'] > 0)->values()->all();
    }

    /* ═════════════════════════ ACCESS REQUESTS ═════════════════════════ */

    /**
     * GET /credvault/access-requests?tab=all|pending|approved|rejected|mine|to_me
     *
     * A Vault Admin sees every request of the company; anyone else sees the
     * ones they raised and the ones waiting on them.
     */
    public function accessRequests(Request $request)
    {
        $u = $this->tenantUser($request);
        $f = $request->validate($this->listRules(['all', 'pending', 'approved', 'rejected', 'mine', 'to_me']));
        $this->sweepUnlocks($u->client_id);

        $admin = $this->isAdmin($u);
        $base  = AccessRequest::where('client_id', $u->client_id);
        if (!$admin) {
            $base->where(fn ($w) => $w->where('requester_id', $u->id)->orWhere('admin_user_id', $u->id)->orWhere('manager_user_id', $u->id));
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

    /** GET /credvault/access-requests/{id} */
    public function accessRequest(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        $this->sweepUnlocks($u->client_id);
        $r = $this->findRequest($u, $id);

        return response()->json(['status' => true, 'data' => $this->requestRow($r, $u)], 200);
    }

    /**
     * POST /credvault/credentials/{id}/access-requests { reason?, duration_minutes? }
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
        [$c] = $this->findCredential($u, $id, self::RANK_VIEW,
            'Your access is Use Only — there is nothing for you to unlock on this credential.');
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
            $this->reject('Too many wrong authenticator codes on this credential today. Try again tomorrow, or ask the owner to unlock it with you.', null, 429);
        }
        if ($otpStep && !$c->totp_linked_at) {
            $this->reject('The authenticator app for this credential has not been linked yet. Ask the owner to link it first.', null, 409);
        }

        $adminId = null;
        if ($adminStep) {
            // Nobody approves their own request: the requester is never in the pool.
            $pool    = array_values(array_diff($this->adminIds($u->client_id), [$u->id]));
            if (!$pool) $this->reject('There is no other Vault Admin who can approve this request.', null, 409);
            $adminId = $c->lock_admin_user_id ?: $pol['cp_admin_user_id'];
            if (!in_array((int) $adminId, $pool, true)) $adminId = null;   // null = any Vault Admin
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

    /** POST /credvault/access-requests/{id}/approve { note? } — the stage waiting now, by the person it waits on. */
    public function approveRequest(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate(['note' => ['nullable', 'string', 'max:300']]);

        return $this->decide($u, $id, true, $d['note'] ?? null);
    }

    /**
     * POST /credvault/access-requests/{id}/reject { note? } — the reason goes
     * back to the requester; without one it reads "Not approved at this time",
     * the prototype's wording.
     */
    public function rejectRequest(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate(['note' => ['nullable', 'string', 'max:300']]);

        return $this->decide($u, $id, false, filled($d['note'] ?? null) ? trim($d['note']) : 'Not approved at this time');
    }

    /** POST /credvault/access-requests/{id}/cancel — the requester withdraws it. */
    public function cancelRequest(Request $request, int $id)
    {
        $u = $this->tenantUser($request);

        $r = $this->inTransaction('cancel the request', function () use ($u, $id) {
            $r = $this->findRequest($u, $id, true);
            if ($r->requester_id !== $u->id) $this->reject('Only the person who raised a request can cancel it.', null, 403);
            if (!in_array($r->status, ['pending', 'approved'], true)) $this->reject('This request is no longer open.', null, 409);

            $r->update(['status' => 'cancelled']);
            $this->audit($u, 'cancel', $r->credential, "Request {$r->code} cancelled by requester", ['request_id' => $r->id], 'Critical Vault');

            return $r;
        });

        return response()->json(['status' => true, 'message' => 'Request cancelled.', 'data' => $this->requestRow($r->fresh(self::REQUEST_RELATIONS), $u)], 200);
    }

    /**
     * POST /credvault/access-requests/{id}/verify-otp { code }
     *
     * The last step. Three wrong codes void the request — every approval with
     * it — and the requester starts again.
     */
    public function verifyOtp(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate(['code' => ['required', 'regex:/^\d{6}$/']], ['code.regex' => 'Enter the 6-digit code from your authenticator app.']);

        [$r, $ok] = $this->inTransaction('verify the code', function () use ($u, $id, $d) {
            $r = $this->findRequest($u, $id, true);
            if ($r->requester_id !== $u->id) $this->reject('Only the person who raised the request can enter its code.', null, 403);
            if ($r->status !== 'approved' || $r->currentStage() !== 'otp') {
                $this->reject('This request is not waiting for an authenticator code.', null, 409);
            }
            // The row's eager load carries display columns only; the secret is read here, on purpose.
            $cred   = Credential::withTrashed()->find($r->credential_id, ['id', 'client_id', 'totp_secret', 'totp_linked_at']);
            $secret = $cred?->totp_secret;
            if (!$secret || !$cred->totp_linked_at) $this->reject('The authenticator app for this credential is no longer linked.', null, 409);

            // A code is good once. Claimed per (credential, time step) and atomically, so a
            // replay inside its ±30 s window is refused — without costing a try — while a
            // code from a neighbouring step stays usable.
            $step = Totp::matchStep($secret, $d['code']);
            if ($step !== null && !Cache::add("credvault:totp-used:{$cred->id}:{$step}", 1, now()->addMinutes(3))) {
                $this->reject('That code was just used. Wait for the next code in your authenticator app.', 'code');
            }
            if ($step === null) {
                $r->otp_attempts++;
                if ($r->otp_attempts >= AccessRequest::MAX_OTP_ATTEMPTS) {
                    $r->fill(['status' => 'locked', 'locked_at' => now(), 'locked_reason' => 'otp_failed']);
                    $this->audit($u, 'otp_failed', $r->credential, AccessRequest::MAX_OTP_ATTEMPTS . ' wrong authenticator codes — approvals reset', ['request_id' => $r->id], 'Critical Vault');
                    if ($r->credential && $r->credential->owner_id !== $u->id) {
                        $this->notify([$r->credential->owner_id], 'otp_failed', 'Wrong authenticator codes',
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

    /** POST /credvault/access-requests/{id}/lock — "Lock now", by the requester or a Vault Admin. */
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

    /* ═════════════════════════ PASSWORD HEALTH ═════════════════════════ */

    /**
     * GET /credvault/health?tab=all|weak|reused|twofa|rotation|shared|fixed&q=
     *
     * Checks every credential in the user's vaults — owned, administered and
     * their team's; not ones merely shared with them. Each issue says whether
     * this user can fix it (can_fix). "resolved" is accepted for "fixed".
     */
    public function health(Request $request)
    {
        $u = $this->tenantUser($request);
        if ($request->query('tab') === 'resolved') $request->merge(['tab' => 'fixed']);
        $f = $request->validate($this->listRules(['all', 'weak', 'reused', 'twofa', 'rotation', 'shared', 'fixed']));
        $pol = Policy::for($u->client_id);

        $creds  = $this->healthScope($u);
        $issues = collect($this->healthIssues($creds, $pol, $u));
        $risky  = $issues->pluck('credential.id')->unique();

        $tabs = ['all' => $issues->count()];
        foreach (['weak', 'reused', 'twofa', 'rotation', 'shared'] as $t) $tabs[$t] = $issues->where('type', $t)->count();
        $resolved = AuditLog::where('client_id', $u->client_id)->where('action', 'health_fixed')
            ->where(fn ($w) => $w->where('user_id', $u->id)->orWhereIn('credential_id', $creds->pluck('id')->all()));
        $tabs['fixed'] = (clone $resolved)->count();

        $tab  = $f['tab'] ?? 'all';
        $per  = $f['per_page'] ?? self::PAGE_SIZE;
        $pg   = $f['page'] ?? 1;
        $term = mb_strtolower(trim((string) ($f['q'] ?? '')));

        if ($tab === 'fixed') {
            if ($term !== '') {
                $like = $this->likeTerm($term);
                $resolved->where(fn ($w) => $w->whereRaw('lower(coalesce(credential_name, \'\')) like ?', [$like])
                    ->orWhereRaw('lower(coalesce(credential_code, \'\')) like ?', [$like])
                    ->orWhereRaw('lower(coalesce(detail, \'\')) like ?', [$like]));
            }
            $page  = $resolved->with('user:id,name')->orderByDesc('id')->paginate($per, ['*'], 'page', $pg);
            $now   = Credential::withTrashed()->whereIn('id', collect($page->items())->pluck('credential_id')->filter()->all())
                ->with('owner:id,name')->get(['id', 'code', 'name', 'type', 'category_group', 'url', 'risk', 'scope', 'owner_id'])->keyBy('id');
            $data = collect($page->items())->map(function ($e) use ($now, $u) {
                $c = $now->get($e->credential_id);
                return [
                    'credential'  => $this->issueCredential($c, $e),
                    'type'        => $e->meta['type'] ?? null,
                    'severity'    => $e->meta['severity'] ?? null,
                    'issue'       => $e->meta['issue'] ?? $e->detail,
                    'detail'      => $e->meta['detail'] ?? null,
                    'resolved_at' => $e->created_at->toIso8601String(),
                    'resolved_by' => $e->user_id === $u->id ? 'You' : $e->user?->name,
                ];
            });
            $meta = $this->pageMeta($page);
        } else {
            $list = $issues->when($tab !== 'all', fn ($c) => $c->where('type', $tab))
                ->when($term !== '', fn ($c) => $c->filter(fn ($i) => str_contains(mb_strtolower(implode(' ', [
                    $i['credential']['code'], $i['credential']['name'], $i['credential']['type_label'], $i['credential']['category_group'],
                    $i['credential']['owner'], $i['issue'],
                ])), $term)))
                ->values();
            $data = $list->slice(($pg - 1) * $per, $per)->values();
            $meta = ['current_page' => $pg, 'per_page' => $per, 'total' => $list->count(), 'last_page' => max(1, (int) ceil($list->count() / $per))];
        }

        $total   = $creds->count();
        $healthy = $total - $risky->count();
        $score   = $total ? (int) round($healthy / $total * 100) : 100;
        $pct     = fn ($n, $of) => $of ? (int) round($n / $of * 100) : 0;

        return response()->json([
            'status'  => true,
            'summary' => [
                'score'           => $score,
                'level'           => $score >= 80 ? 'Good' : ($score >= 60 ? 'Fair' : 'At risk'),
                'checked'         => $total,
                'with_passwords'  => $creds->where('has_password', true)->count(),
                'open_issues'     => $issues->count(),
                'at_risk'         => $risky->count(),
                'critical_issues' => $issues->where('severity', 'critical')->count(),
                // "Strong & safe": credentials with no open issue.
                'safe'            => $healthy,
                'pct'             => [
                    'with_passwords'  => $pct($creds->where('has_password', true)->count(), $total),
                    'at_risk'         => $pct($risky->count(), $total),
                    'critical_issues' => $pct($issues->where('severity', 'critical')->count(), $issues->count()),
                    'safe'            => $pct($healthy, $total),
                ],
            ],
            'data'    => $data,
            'tabs'    => $tabs,
            'meta'    => $meta,
        ], 200);
    }

    /* ═════════════════════════════ POLICIES ═════════════════════════════ */

    /**
     * GET /credvault/policies — the settings, the rule catalogue the screen is
     * drawn from (sections, labels, "Applies to", option labels), and each
     * card's insight box and "Live in your vault" numbers.
     *
     * "Reset to Defaults" in the prototype only fills the draft: the client
     * loads `defaults` into the form and saves with PUT. POST /policies/reset
     * is the one-step version.
     */
    public function policies(Request $request)
    {
        $u   = $this->tenantUser($request);
        $row = Policy::where('client_id', $u->client_id)->first();
        $pol = Policy::for($u->client_id);
        $admins = User::whereIn('id', $this->adminIds($u->client_id))->get(['id', 'name']);

        return response()->json(['status' => true, 'data' => [
            'settings'   => $pol,
            'labels'     => collect(array_keys(Policy::DEFAULTS))->mapWithKeys(fn ($k) => [$k => Policy::format($k, $pol[$k], $admins->firstWhere('id', $pol[$k])?->name)]),
            'defaults'   => Policy::DEFAULTS,
            'sections'   => collect(Policy::SECTIONS)->map(fn ($s, $k) => [
                'key' => $k, 'title' => $s[0], 'subtitle' => $s[1],
                'rules' => collect(Policy::CATALOG)->filter(fn ($r) => $r[0] === $k)->keys()->values(),
            ])->values(),
            'rules'      => Policy::catalog(),
            'admins'     => $admins->map(fn ($a) => ['id' => $a->id, 'name' => $a->name, 'initials' => $this->initials($a->name)]),
            'can_edit'   => $this->isAdmin($u),
            'warnings'   => $this->policyWarnings($pol),
            'rule_count' => count(Policy::DEFAULTS),
            'updated_at' => $row?->updated_at?->toIso8601String(),
            'updated_by' => $row?->updated_by ? User::whereKey($row->updated_by)->value('name') : null,
            'insights'   => $this->policyInsights($u, $pol),
            'history'    => $this->policyHistoryStats($u),
        ]], 200);
    }

    /** "With every check off, critical credentials open without any approval." */
    private function policyWarnings(array $pol): array
    {
        return !$pol['cp_admin'] && !$pol['cp_manager'] && !$pol['cp_otp']
            ? [['key' => 'critical_unprotected', 'section' => 'critical', 'message' => 'With every check off, critical credentials open without any approval.']]
            : [];
    }

    /**
     * Each card's insight box and the "Live in your vault" numbers the
     * prototype prints under it (polStats / polInsightHtml).
     */
    private function policyInsights(User $u, array $pol): array
    {
        $creds   = $this->healthScope($u);
        $pw      = $creds->where('has_password', true);
        $issues  = collect($this->healthIssues($creds, $pol));
        $shares  = $this->liveShareCounts($creds->pluck('id')->all());
        $bin     = $this->binQuery($u)->orderBy('deleted_at')->get(['id', 'code', 'name', 'risk', 'deleted_at']);
        $admin   = $this->isAdmin($u);
        $reqs    = AccessRequest::where('client_id', $u->client_id)
            ->when(!$admin, fn ($q) => $q->where(fn ($w) => $w->where('requester_id', $u->id)->orWhere('admin_user_id', $u->id)->orWhere('manager_user_id', $u->id)));
        $required = $creds->whereIn('risk', $pol['twofa_risks']);
        $critIds  = $creds->where('risk', 'critical')->pluck('id')->all();
        $soonBin  = $bin->filter(fn ($c) => $c->deleted_at->copy()->addDays($pol['bin_days'])->lte(now()->addDays(7)));

        return [
            'password' => [
                'strength_mix'  => collect([4 => 'strong', 3 => 'good', 2 => 'fair', 1 => 'weak'])->mapWithKeys(fn ($k, $s) => [$k => $pw->where('strength', $s)->count()]),
                'with_password' => $pw->count(),
                'below_policy'  => $pw->where('strength', '<', $pol['min_strength'])->count(),
                'rotation_due'  => $issues->where('type', 'rotation')->count(),
            ],
            'twofa' => [
                'by_risk' => collect(Policy::RISK_ORDER)->map(fn ($r) => [
                    'risk'     => $r,
                    'required' => in_array($r, $pol['twofa_risks'], true),
                    'enabled'  => $creds->where('risk', $r)->where('twofa', 'yes')->count(),
                    'applies'  => $creds->where('risk', $r)->whereIn('twofa', ['yes', 'no'])->count(),
                    'total'    => $creds->where('risk', $r)->count(),
                ])->values(),
                'enabled'            => $creds->where('twofa', 'yes')->count(),
                'missing'            => $issues->where('type', 'twofa')->count(),
                'in_required_levels' => $required->count(),
            ],
            'sharing' => [
                'active_shares'      => array_sum(array_column($shares, 'n')),
                'shares_on_critical' => array_sum(array_column(array_intersect_key($shares, array_flip($critIds)), 'n')),
                'over_shared'        => $issues->where('type', 'shared')->count(),
                'most_shared'        => collect($shares)->sortByDesc('n')->take(3)->map(function ($s, $id) use ($creds, $pol) {
                    $c = $creds->firstWhere('id', $id);
                    return ['id' => $id, 'code' => $c?->code, 'name' => $c?->name, 'risk' => $c?->risk, 'shares' => $s['n'], 'over_limit' => $s['n'] >= $pol['overshare_limit']];
                })->values(),
            ],
            'critical' => [
                'critical_credentials' => count($critIds),
                'pending_requests'     => (clone $reqs)->where('status', 'pending')->count(),
                'unlocked_now'         => (clone $reqs)->where('status', 'unlocked')->where('expires_at', '>', now())->count(),
                'checks'               => count(array_filter([$pol['cp_admin'], $pol['cp_manager'], $pol['cp_otp']])),
            ],
            'bin' => [
                'bin_items'          => $bin->count(),
                'expiring_soon'      => $soonBin->count(),
                'critical_items'     => $bin->where('risk', 'critical')->count(),
                'next_bin_deletions' => $bin->take(3)->map(fn ($c) => [
                    'id' => $c->id, 'code' => $c->code, 'name' => $c->name,
                    'purges_at' => $c->deleted_at->copy()->addDays($pol['bin_days'])->toIso8601String(),
                ])->values(),
            ],
        ];
    }

    /** PUT /credvault/policies — Vault Admins only; send just the keys that change. */
    public function updatePolicies(Request $request)
    {
        $u = $this->tenantUser($request);
        $this->assertAdmin($u);

        $o = Policy::OPTIONS;
        $d = $request->validate([
            'min_strength'     => ['sometimes', 'integer', Rule::in($o['min_strength'])],
            'rotation_default' => ['sometimes', 'nullable', 'integer', Rule::in(array_filter($o['rotation_default']))],
            'rotation_warn'    => ['sometimes', 'integer', Rule::in($o['rotation_warn'])],
            'gen_length'       => ['sometimes', 'integer', Rule::in($o['gen_length'])],
            'gen_symbols'      => ['sometimes', 'boolean'],
            'twofa_risks'      => ['sometimes', 'array'],
            'twofa_risks.*'    => ['distinct', Rule::in(Credential::RISKS)],
            'share_critical'   => ['sometimes', 'boolean'],
            'share_max_days'   => ['sometimes', 'integer', Rule::in($o['share_max_days'])],
            'share_reason'     => ['sometimes', 'boolean'],
            'overshare_limit'  => ['sometimes', 'integer', Rule::in($o['overshare_limit'])],
            'cp_admin'         => ['sometimes', 'boolean'],
            'cp_admin_user_id' => ['sometimes', 'nullable', 'integer', Rule::in($this->adminIds($u->client_id))],
            'cp_manager'       => ['sometimes', 'boolean'],
            'cp_otp'           => ['sometimes', 'boolean'],
            'cp_max_minutes'   => ['sometimes', 'integer', Rule::in($o['cp_max_minutes'])],
            'bin_days'         => ['sometimes', 'integer', Rule::in($o['bin_days'])],
            'bin_purge'        => ['sometimes', 'boolean'],
        ], ['cp_admin_user_id.in' => 'The default Vault Admin must be a company admin.']);

        return $this->savePolicies($u, $d);
    }

    /** POST /credvault/policies/reset — every setting back to its default in one step, logged like any change. */
    public function resetPolicies(Request $request)
    {
        $u = $this->tenantUser($request);
        $this->assertAdmin($u);

        return $this->savePolicies($u, Policy::DEFAULTS);
    }

    /** GET /credvault/policies/history — the Change History card: entries, total, today, people. */
    public function policyHistory(Request $request)
    {
        $u = $this->tenantUser($request);
        $f = $request->validate(['page' => ['nullable', 'integer', 'min:1'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);

        $page = AuditLog::where('client_id', $u->client_id)->where('action', 'policy')->with('user:id,name')
            ->orderByDesc('id')->paginate($f['per_page'] ?? 20, ['*'], 'page', $f['page'] ?? 1);

        return response()->json([
            'status' => true,
            'data'   => collect($page->items())->map(function ($e) use ($u) {
                $k = $e->meta['key'] ?? null;
                return [
                    'id'         => $e->id,
                    'key'        => $k,
                    'label'      => Policy::CATALOG[$k][1] ?? $k,
                    'section'    => Policy::CATALOG[$k][0] ?? null,
                    'area'       => isset(Policy::CATALOG[$k]) ? Policy::SECTIONS[Policy::CATALOG[$k][0]][0] : null,
                    'from'       => $e->meta['from'] ?? null,
                    'to'         => $e->meta['to'] ?? null,
                    'from_label' => $e->meta['from_label'] ?? ($k ? Policy::format($k, $e->meta['from'] ?? null) : null),
                    'to_label'   => $e->meta['to_label'] ?? ($k ? Policy::format($k, $e->meta['to'] ?? null) : null),
                    'by'         => $e->user_id === $u->id ? 'You' : $e->user?->name,
                    'by_id'      => $e->user_id,
                    'at'         => $e->created_at->toIso8601String(),
                ];
            }),
            'stats'  => $this->policyHistoryStats($u),
            'meta'   => $this->pageMeta($page),
        ], 200);
    }

    private function policyHistoryStats(User $u): array
    {
        $q = AuditLog::where('client_id', $u->client_id)->where('action', 'policy');

        return [
            'total'  => (clone $q)->count(),
            'today'  => (clone $q)->where('created_at', '>=', now()->startOfDay())->count(),
            'people' => (clone $q)->distinct()->count('user_id'),
            'latest' => (clone $q)->max('created_at') ? Carbon::parse((clone $q)->max('created_at'))->toIso8601String() : null,
        ];
    }

    /* ════════════════════════════ AUDIT LOGS ════════════════════════════ */

    /**
     * GET /credvault/audit-logs?tab=all|mine|team|alerts&range=24h|7d|30d|all|custom&from=&to=&action=&credential_id=&q=
     *
     * A Vault Admin sees the whole company; anyone else their own events and
     * the events on credentials they own. As in the prototype, the summary
     * and the tab counts follow the time range alone — switching tab or typing
     * a search narrows only the timeline.
     */
    public function auditLogs(Request $request)
    {
        $u = $this->tenantUser($request);
        $f = $request->validate($this->auditRules(), $this->auditMessages());
        $ranged = $this->auditQuery($u, ['range' => $f['range'] ?? '30d', 'from' => $f['from'] ?? null, 'to' => $f['to'] ?? null, 'tz' => $f['tz'] ?? null]);

        $summary = (clone $ranged)->selectRaw(
            "count(*) as total,
             sum(case when user_id = ? then 1 else 0 end) as by_me,
             sum(case when action in ('view','reveal') then 1 else 0 end) as views,
             sum(case when action in ('copy','export') then 1 else 0 end) as copies,
             sum(case when action in ('share','revoke','request','approve','reject') then 1 else 0 end) as access_changes,
             sum(case when severity = 'critical' then 1 else 0 end) as alerts,
             count(distinct case when user_id <> ? then user_id end) as team_members", [$u->id, $u->id]
        )->first();
        $top = (clone $ranged)->whereNotNull('user_id')->selectRaw('user_id, count(*) as n')->groupBy('user_id')->orderByDesc('n')->first();

        $tabs = [
            'all'    => (clone $ranged)->count(),
            'mine'   => (clone $ranged)->where('user_id', $u->id)->count(),
            'team'   => (clone $ranged)->where(fn ($w) => $w->whereNull('user_id')->orWhere('user_id', '!=', $u->id))->count(),
            'alerts' => (clone $ranged)->where('severity', 'critical')->count(),
        ];

        $page = $this->auditQuery($u, $f)->with('user:id,name,user_type')->orderByDesc('created_at')->orderByDesc('id')
            ->paginate($f['per_page'] ?? 15, ['*'], 'page', $f['page'] ?? 1);
        $topName = $top ? User::whereKey($top->user_id)->value('name') : null;

        return response()->json([
            'status'  => true,
            'summary' => [
                'events'          => (int) $summary->total,
                'by_me'           => (int) $summary->by_me,
                'team_members'    => (int) $summary->team_members,
                'views_reveals'   => (int) $summary->views,
                'copies_exports'  => (int) $summary->copies,
                'access_changes'  => (int) $summary->access_changes,
                'security_alerts' => (int) $summary->alerts,
                'most_active'     => $top ? ['user_id' => $top->user_id, 'name' => $topName, 'is_me' => $top->user_id === $u->id,
                                             'label' => $top->user_id === $u->id ? "You ({$topName})" : $topName, 'events' => (int) $top->n] : null,
                'range'           => ['range' => $f['range'] ?? '30d', 'from' => $f['from'] ?? null, 'to' => $f['to'] ?? null],
            ],
            'data'    => $this->eventRows(collect($page->items()), $u),
            'tabs'    => $tabs,
            'meta'    => $this->pageMeta($page),
        ], 200);
    }

    /** GET /credvault/audit-logs/export — the filtered view as CSV, columns as the prototype's alExport. */
    public function exportAuditLogs(Request $request)
    {
        $u = $this->tenantUser($request);
        $f = $request->validate($this->auditRules(), $this->auditMessages());

        $rows = $this->auditQuery($u, $f)->with('user:id,name')->orderByDesc('created_at')->limit(10000)->get();
        if ($rows->isEmpty()) $this->reject('There are no events in this view to export.', null, 422);

        $cols = ['Event ID', 'Date', 'Time', 'User', 'Action', 'Credential ID', 'Credential', 'Details', 'Module', 'Severity', 'IP'];
        $body = VaultFile::build($cols, $rows->map(fn ($e) => [
            'Event ID'      => 'EVT-' . $e->id,
            'Date'          => $e->created_at->format('Y-m-d'),
            'Time'          => $e->created_at->format('H:i:s'),
            'User'          => $e->user?->name ?? 'System',
            'Action'        => AuditLog::ACTIONS[$e->action][0] ?? $e->action,
            'Credential ID' => $e->credential_code,
            'Credential'    => $e->credential_name ?? 'Vault settings',
            'Details'       => $e->detail,
            'Module'        => $e->module,
            'Severity'      => AuditLog::SEVERITY_LABELS[$e->severity] ?? $e->severity,
            'IP'            => $e->ip,
        ])->all(), 'csv');

        // The log leaving the system is itself on the record (as info — it carries no secret).
        $this->writeAudit($u->client_id, $u->id, $u->branch_id, 'export', null, 'Audit log exported · ' . $rows->count() . ' events', ['rows' => $rows->count(), 'kind' => 'audit_log'], 'Audit Logs', 'info');

        return $this->download($body, 'credvault-audit-log-' . now()->format('Ymd') . '.csv', 'text/csv', ['X-CredVault-Count' => (string) $rows->count()]);
    }

    /* ══════════════════════════ IMPORT & RECOVERY ══════════════════════════ */

    /** The sample file's two rows, and the extra rows "Try it with sample data" adds — the prototype's IR_EXAMPLE / irTry. */
    private const IMPORT_EXAMPLE = [
        ['Zoho Books Admin', 'https://books.zoho.in', 'admin@inorbvict.com', 'Zoho#Books2026!', 'Finance', 'Main accounting login'],
        ['Canva Team', 'https://www.canva.com', 'design@inorbvict.com', 'Canva!Team#2026x', 'Marketing', 'Shared design workspace'],
    ];
    private const IMPORT_TRY_EXTRA = [
        ['Old Intranet', 'http://intranet.local', 'admin', 'admin@123', 'IT', 'Legacy server'],
        ['Practo Doctor Portal', 'https://practo.com', 'clinic@inhpl.com', 'Pr@cto_Clinic26!', 'Healthcare', ''],
        ['Tally Backup FTP', 'ftp://backup.inorbvict.com', 'tally_bk', '', 'IT', 'Password not stored'],
    ];
    private const IMPORT_COLUMNS = ['name', 'url', 'username', 'password', 'category', 'notes'];

    /**
     * POST /credvault/imports/preview  (multipart: file) — or { sample: true }
     * for "No file yet? Try it with sample data".
     *
     * Reads the file, maps its columns, flags every row and parks the parsed
     * rows server-side behind a token; the passwords never travel back to the
     * browser and the import call names rows by index.
     *
     * Flags, as the prototype sets them: invalid (no name), nopw (no
     * password), dup (already in your vaults), dupfile (repeated in the file,
     * and not already a dup), weak (below the policy strength).
     *   ok        importable — not invalid, not nopw
     *   ready     ok with no flag at all (the "Ready" count)
     *   selected  ticked by default: ok and not a duplicate (weak rows included)
     */
    public function importPreview(Request $request)
    {
        $u = $this->tenantUser($request);
        $request->validate([
            'sample' => ['sometimes', 'boolean'],
            'file'   => ['required_unless:sample,true,1', 'file', 'max:5120', 'extensions:xlsx,xls,csv,tsv,txt,json,xml'],
        ], ['file.extensions' => 'Upload an Excel (.xlsx), CSV, TSV, JSON or Excel XML file.', 'file.required_unless' => 'Choose a file to import.']);

        if ($request->boolean('sample')) {
            $raw = array_map(fn ($r) => array_combine(self::IMPORT_COLUMNS, $r), array_merge(self::IMPORT_EXAMPLE, self::IMPORT_TRY_EXTRA));
            $fileName = 'Sample data';
            $fmt = 'sample';
        } else {
            $file = $request->file('file');
            $ext  = strtolower($file->getClientOriginalExtension());
            try {
                $raw = VaultFile::read($file->getRealPath(), $ext);
            } catch (\RuntimeException $e) {
                $this->reject($e->getMessage(), 'file');
            }
            $fileName = $file->getClientOriginalName();
            $fmt = $ext === 'xls' ? 'xml' : $ext;
        }
        if (!$raw) $this->reject('The file has no rows to import.', 'file');

        $headers = array_map(fn ($h) => Str::lower(trim($h)), array_keys($raw[0]));
        $map     = $this->importColumnMap($headers);
        if (!isset($map['password']) || (!isset($map['name']) && !isset($map['url']))) {
            $this->reject('The file needs a password column and a name or URL column. Download the sample to see the layout.', 'file');
        }

        $pol    = Policy::for($u->client_id);
        $source = $fmt === 'sample' ? 'Sample data' : ($this->detectSource($headers) ?: (Transfer::FORMAT_LABELS[$fmt] ?? strtoupper($fmt)) . ' file');
        // Duplicates are checked against everything already in your vaults — owned and team, not shared-with-you.
        $existing = $this->healthScope($u);
        $seen = [];
        $rows = [];
        foreach ($raw as $i => $r) {
            $r    = array_change_key_case($r, CASE_LOWER);
            $get  = fn ($k) => isset($map[$k]) ? trim((string) ($r[$map[$k]] ?? '')) : '';
            $url  = $get('url');
            $name = $get('name') ?: ($this->host($url) ?? '');
            $user = $get('username');
            $pw   = $get('password');

            $flags = [];
            if ($name === '') $flags[] = 'invalid';
            if ($pw === '')   $flags[] = 'nopw';
            $dupOf = $existing->first(fn ($m) => (Str::lower($m->name) === Str::lower($name) && Str::lower((string) $m->username) === Str::lower($user))
                || ($url && $this->host($m->url) && $this->host($m->url) === $this->host($url) && Str::lower((string) $m->username) === Str::lower($user)));
            $key = Str::lower($name . '|' . $user);
            if ($dupOf) $flags[] = 'dup';
            elseif (isset($seen[$key])) $flags[] = 'dupfile';
            $seen[$key] = true;
            $strength = Credential::strengthOf($pw);
            if ($pw !== '' && $strength < $pol['min_strength']) $flags[] = 'weak';

            $ok = !array_intersect($flags, ['invalid', 'nopw']);
            $rows[] = [
                'index' => $i, 'name' => Str::limit($name, 150, ''), 'url' => Str::limit($url, 500, ''), 'username' => Str::limit($user, 191, ''),
                'password' => $pw, 'category' => Str::limit($get('category'), 100, ''), 'notes' => Str::limit($get('notes'), 2000, ''),
                'strength' => $strength, 'strength_label' => Credential::STRENGTH_LABELS[$strength] ?? '', 'flags' => $flags,
                'dup_of' => $dupOf ? ['id' => $dupOf->id, 'code' => $dupOf->code, 'name' => $dupOf->name] : null,
                'ok' => $ok, 'ready' => $ok && !$flags,
                'selected' => $ok && !array_intersect($flags, ['dup', 'dupfile']),
            ];
        }

        $token = Str::random(40);
        Cache::put($this->importCacheKey($u, $token), Crypt::encrypt(['rows' => $rows, 'file_name' => $fileName, 'format' => $fmt, 'source' => $source]), self::IMPORT_TTL);
        $c = collect($rows);

        return response()->json(['status' => true, 'data' => [
            'token'      => $token,
            'expires_in' => self::IMPORT_TTL,
            'file_name'  => $fileName,
            'format'     => $fmt,
            'format_label' => Transfer::FORMAT_LABELS[$fmt] ?? strtoupper($fmt),
            'source'     => $source,
            'columns'    => $map,
            'demo'       => $fmt === 'sample',
            'stats'      => [
                'rows'       => $c->count(),
                'ready'      => $c->where('ready', true)->count(),
                'duplicates' => $c->filter(fn ($r) => array_intersect(['dup', 'dupfile'], $r['flags']))->count(),
                'weak'       => $c->filter(fn ($r) => in_array('weak', $r['flags'], true))->count(),
                'cannot'     => $c->where('ok', false)->count(),
                'selected'   => $c->where('selected', true)->count(),
            ],
            // Everything but the password and notes themselves.
            'rows' => $c->map(fn ($r) => collect($r)->except(['password', 'notes'])->put('has_password', $r['password'] !== '')->all())->values(),
        ]], 200);
    }

    /**
     * POST /credvault/imports { token, rows: [index…], duplicates: skip|copy, scope?, department_id? }
     *
     * The token is consumed, so a second click imports nothing twice.
     * "Import as copy" brings a row that is already in the vault in with
     * " (imported)" added to its name. History counts follow the prototype:
     * skipped = every row not imported; duplicates = every duplicate in the file.
     */
    public function import(Request $request)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate([
            'token'         => ['required', 'string', 'size:40'],
            'rows'          => ['required', 'array', 'min:1', 'max:' . VaultFile::MAX_ROWS],
            'rows.*'        => ['integer', 'min:0', 'distinct'],
            'duplicates'    => ['required', Rule::in(['skip', 'copy'])],
            'scope'         => ['nullable', Rule::in(Credential::SCOPES)],
            'department_id' => ['nullable', 'integer', 'min:1'],
        ]);

        $scope  = $d['scope'] ?? 'personal';
        $deptId = $scope === 'team' ? $this->teamDepartmentFor($u, $d['department_id'] ?? null) : null;

        // The preview is spent only once the import commits: a run that imports nothing
        // (all skipped, or an error) leaves it, so the person can change options and retry.
        // The marker stops two runs of the same preview at once.
        $cacheKey = $this->importCacheKey($u, $d['token']);
        if (!Cache::add("{$cacheKey}:running", 1, 120)) $this->reject('This import is already running.', 'token', 409);

        try {
            $payload = Cache::get($cacheKey);   // read only once the marker is ours
            if (!$payload) $this->reject('This preview has expired or was already imported. Upload the file again.', 'token', 410);
            $payload = Crypt::decrypt($payload);
            $pol     = Policy::for($u->client_id);

            $result = $this->runImport($u, $d, $payload, $pol, $scope, $deptId);
            Cache::forget($cacheKey);
        } finally {
            Cache::forget("{$cacheKey}:running");
        }
        return $result;
    }

    private function runImport(User $u, array $d, array $payload, array $pol, string $scope, ?int $deptId)
    {
        $result = $this->inTransaction('import the credentials', function () use ($u, $d, $payload, $pol, $scope, $deptId) {
            $picked = array_flip($d['rows']);
            $code   = $this->nextCode('credvault_credentials', 'CRD', $u->client_id);
            $n      = (int) substr($code, 4);
            $items  = 0;
            $weak   = 0;

            foreach ($payload['rows'] as $row) {
                if (!isset($picked[$row['index']]) || !$row['ok']) continue;
                $isDup = in_array('dup', $row['flags'], true);
                $isDupFile = in_array('dupfile', $row['flags'], true);
                if (($isDup || $isDupFile) && $d['duplicates'] === 'skip') continue;

                $type = $row['url'] ? 'login' : 'password';
                $def  = Credential::typeDef($type);
                $name = $isDup ? Str::limit($row['name'], 139, '') . ' (imported)' : $row['name'];
                Credential::create([
                    'client_id' => $u->client_id, 'branch_id' => $u->branch_id,
                    'code' => sprintf('CRD-%04d', $n++), 'type' => $type, 'category_group' => $def['group'],
                    'name' => $name, 'scope' => $scope, 'owner_id' => $u->id, 'department_id' => $deptId,
                    'url' => $row['url'] ?: null, 'username' => $row['username'] ?: null,
                    'secret' => $row['password'], 'secret_hash' => Credential::hashSecret($row['password']),
                    'fields' => array_filter(['url' => $row['url'], 'username' => $row['username'], 'password' => $row['password']]),
                    'notes' => trim(($row['category'] ? "Category: {$row['category']}\n" : '') . $row['notes']) ?: null,
                    'risk' => 'medium', 'strength' => $row['strength'], 'has_password' => true, 'twofa' => 'no',
                    'rotation_days' => $pol['rotation_default'], 'password_changed_at' => now(),
                    'created_by' => $u->id, 'updated_by' => $u->id,
                ]);
                $items++;
                if (in_array('weak', $row['flags'], true)) $weak++;
            }
            if (!$items) $this->reject('None of the selected rows could be imported.', 'rows');

            $all = collect($payload['rows']);
            $t = Transfer::create([
                'client_id' => $u->client_id, 'kind' => 'import',
                'code' => $this->nextCode('credvault_transfers', 'IM', $u->client_id),
                'user_id' => $u->id, 'scope' => $scope === 'team' ? 'team' : 'mine', 'format' => $payload['format'],
                'file_name' => Str::limit($payload['file_name'], 191, ''), 'source' => $payload['source'],
                'items' => $items, 'skipped' => $all->count() - $items, 'weak' => $weak,
                'duplicates' => $all->filter(fn ($r) => array_intersect(['dup', 'dupfile'], $r['flags']))->count(),
            ]);
            $this->audit($u, 'importx', null, "{$t->code} · {$items} credentials imported from {$payload['source']}",
                ['transfer' => $t->code, 'items' => $items, 'weak' => $weak], 'Import & Recovery');

            return $t;
        });

        return response()->json([
            'status'  => true,
            'message' => "{$result->items} credentials imported to My Vault" . ($result->weak ? " · {$result->weak} have weak passwords — see Password Health" : '') . '.',
            'data'    => $this->transferRow($result->load('user:id,name'), $u),
        ], 201);
    }

    /** GET /credvault/imports — import history. */
    public function imports(Request $request)
    {
        return $this->transferHistory($request, 'import');
    }

    /** GET /credvault/imports/sample?format=csv|json|xlsx — the prototype's sample: two example rows, and a "How to fill" sheet in Excel. */
    public function importSample(Request $request)
    {
        $this->tenantUser($request);
        $d = $request->validate(['format' => ['nullable', Rule::in(['csv', 'json', 'xlsx'])]]);
        $fmt = $d['format'] ?? 'xlsx';

        $body = match ($fmt) {
            'csv'  => VaultFile::csv(self::IMPORT_COLUMNS, self::IMPORT_EXAMPLE),
            'json' => json_encode(['format' => 'CredVault import', 'credentials' => array_map(fn ($r) => array_combine(self::IMPORT_COLUMNS, $r), self::IMPORT_EXAMPLE)],
                JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            default => VaultFile::xlsx([
                ['name' => 'Credentials', 'rows' => array_merge([self::IMPORT_COLUMNS], self::IMPORT_EXAMPLE), 'head' => true, 'freeze' => true, 'widths' => [26, 32, 30, 22, 16, 32]],
                ['name' => 'How to fill', 'head' => true, 'widths' => [14, 14, 70], 'rows' => [
                    ['Column', 'Required', 'What to enter'],
                    ['name', 'Yes', 'A short name, e.g. “Zoho Books Admin”'],
                    ['url', 'Recommended', 'Website or login address'],
                    ['username', 'Recommended', 'Login name or email'],
                    ['password', 'Yes', 'The password (it is encrypted as soon as it is imported)'],
                    ['category', 'No', 'Any label, e.g. Finance, IT'],
                    ['notes', 'No', 'Anything useful for your team'],
                    ['', '', ''],
                    ['Tip', '', 'Keep the first row as it is. Delete the two example rows and add one credential per row.'],
                ]],
            ]),
        };

        return $this->download($body, 'credvault-import-sample.' . $fmt, $this->mime($fmt));
    }

    /**
     * POST /credvault/backups { format, scope: mine|team|all, include_passwords, lock, password, password_confirmation, account_password? }
     *
     * The file matches the prototype's backup: columns Name, Type, Category,
     * Website, Username, [Password], Owner, Vault, Risk, 2FA, Rotation, Notes,
     * Updated; Excel adds an "About" sheet; JSON wraps the rows with the
     * backup's id, date, author and vault. A locked backup is an AES-256 zip
     * (open it with 7-Zip or WinRAR). Passwords without a lock would be a
     * readable file, so that case asks for the account password again.
     * Secrets of protected credentials are never written — they open through
     * an unlock, not a file. A failed attempt is recorded too.
     */
    public function backup(Request $request)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate([
            'format'                => ['required', Rule::in(['csv', 'json', 'xlsx'])],
            'scope'                 => ['required', Rule::in(['mine', 'team', 'all'])],
            'include_passwords'     => ['required', 'boolean'],
            'lock'                  => ['required', 'boolean'],
            'password'              => ['exclude_unless:lock,true,1', 'required', 'string', 'min:8', 'max:128'],
            'password_confirmation' => ['exclude_unless:lock,true,1', 'required', 'string'],
            'account_password'      => ['nullable', 'string'],
        ], ['password.required' => 'Set a password for the backup file, or turn the lock off.', 'password.min' => 'Use at least 8 characters for the backup password.']);
        $d['include_passwords'] = (bool) $d['include_passwords'];
        $d['lock'] = (bool) $d['lock'];
        $fmtLabel = Transfer::FORMAT_LABELS[$d['format']];
        $scopeLabel = Transfer::SCOPE_LABELS[$d['scope']];

        $fail = function (string $why, string $field) use ($u, $d, $fmtLabel, $scopeLabel) {
            $this->inTransaction('record the failed backup', function () use ($u, $d, $why, $fmtLabel, $scopeLabel) {
                $t = Transfer::create([
                    'client_id' => $u->client_id, 'kind' => 'backup', 'code' => $this->nextCode('credvault_transfers', 'BK', $u->client_id),
                    'user_id' => $u->id, 'scope' => $d['scope'], 'format' => $d['format'], 'include_passwords' => $d['include_passwords'],
                    'locked' => $d['lock'], 'status' => 'failed', 'failure_reason' => $why,
                ]);
                $this->audit($u, 'backupfail', null, "{$t->code} · {$fmtLabel} · {$scopeLabel} · {$why}", ['transfer' => $t->code], 'Import & Recovery');
            });
            $this->reject($why . '.', $field);
        };
        if ($d['lock'] && $d['password'] !== $d['password_confirmation']) $fail('Passwords did not match', 'password_confirmation');
        if ($d['include_passwords'] && !$d['lock']) {
            if (!filled($d['account_password'] ?? null)) $this->reject('A backup with readable passwords needs your account password. Or lock the file with a password.', 'account_password');
            if (!Hash::check((string) $d['account_password'], $u->password)) $fail('Account password incorrect', 'account_password');
        }

        $creds = $this->fileScope($u, $d['scope']);
        if ($creds->isEmpty()) $this->reject('There are no credentials in this vault to back up.', 'scope');

        [$keys, $rows, $withheld] = $this->backupRows($creds, $d['include_passwords']);
        $name  = "credvault-{$d['scope']}-backup-" . now()->format('Ymd');
        // Built inside the transaction below with the code it is recorded under, so the
        // Backup ID in the file always matches the history row.
        $build = fn (string $code) => match ($d['format']) {
            'csv'  => VaultFile::csv(array_values($keys), array_map(fn ($r) => array_values(array_intersect_key(array_replace($keys, $r), $keys)), $rows)),
            'json' => json_encode(['format' => 'CredVault backup', 'id' => $code, 'created' => now()->toIso8601String(), 'by' => $u->name,
                'scope' => $scopeLabel, 'count' => count($rows), 'credentials' => $rows], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            default => VaultFile::xlsx([
                ['name' => 'Credentials', 'head' => true, 'freeze' => true,
                    'widths' => array_values(array_map(fn ($k) => ['name' => 28, 'url' => 30, 'username' => 28, 'password' => 22, 'notes' => 30, 'category' => 16][$k] ?? 14, array_keys($keys))),
                    'rows' => array_merge([array_values($keys)], array_map(fn ($r) => array_values(array_intersect_key(array_replace($keys, $r), $keys)), $rows))],
                ['name' => 'About', 'head' => true, 'widths' => [22, 40], 'rows' => [
                    ['CredVault backup', ''], ['Backup ID', $code], ['Created', now()->format('d/m/Y, H:i:s')], ['Created by', $u->name],
                    ['Vault', $scopeLabel], ['Credentials', (string) count($rows)], ['Passwords included', $d['include_passwords'] ? 'Yes' : 'No'],
                ]],
            ]),
        };
        $file = $d['lock'] ? "{$name}.zip" : "{$name}.{$d['format']}";
        $body = null;

        $t = $this->inTransaction('record the backup', function () use ($u, $d, $rows, $build, $name, $file, &$body, $fmtLabel, $scopeLabel) {
            $code = $this->nextCode('credvault_transfers', 'BK', $u->client_id);
            $body = $build($code);
            if ($d['lock']) $body = VaultFile::lock("{$name}.{$d['format']}", $body, $d['password']);
            $t = Transfer::create([
                'client_id' => $u->client_id, 'kind' => 'backup', 'code' => $code,
                'user_id' => $u->id, 'scope' => $d['scope'], 'format' => $d['format'], 'file_name' => $file,
                'items' => count($rows), 'size_bytes' => strlen($body), 'include_passwords' => $d['include_passwords'], 'locked' => $d['lock'],
            ]);
            $this->audit($u, 'backup', null, "{$t->code} · {$fmtLabel} · {$scopeLabel} · " . count($rows) . ' items · ' . ($d['lock'] ? 'password-locked' : 'not password-locked'),
                ['transfer' => $t->code], 'Import & Recovery');

            return $t;
        });

        return $this->download($body, $file, $d['lock'] ? 'application/zip' : $this->mime($d['format']), [
            'X-CredVault-Code'     => $t->code,
            'X-CredVault-Items'    => (string) count($rows),
            'X-CredVault-Withheld' => (string) $withheld,
        ]);
    }

    /**
     * GET /credvault/backups?mine= — backup history (failed attempts included),
     * plus what the Backup form shows before anything is downloaded: the
     * credential count of each scope and the columns the file will hold.
     */
    public function backups(Request $request)
    {
        $u = $this->tenantUser($request);
        $res = $this->transferHistory($request, 'backup')->getData(true);
        $res['scopes'] = collect(['mine', 'team', 'all'])->map(fn ($s) => ['scope' => $s, 'label' => Transfer::SCOPE_LABELS[$s], 'count' => $this->fileScope($u, $s, true)->count()])->values();
        $res['columns'] = ['with_passwords' => array_values(self::BACKUP_KEYS), 'without_passwords' => array_values(array_diff_key(self::BACKUP_KEYS, ['password' => 1]))];
        $res['lock_note'] = 'Locked with AES-256 — open it with 7-Zip, WinRAR or another AES-capable zip tool.';

        return response()->json($res, 200);
    }

    /**
     * GET /credvault/exports/preview?scope=team|personal — the Export popup
     * before anything downloads: a count per category group and the total.
     */
    public function exportPreview(Request $request)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate(['scope' => ['nullable', Rule::in(['team', 'personal'])]]);
        $creds = $this->fileScope($u, ($d['scope'] ?? 'team') === 'team' ? 'team' : 'mine', true);

        return response()->json(['status' => true, 'data' => [
            'scope'  => $d['scope'] ?? 'team',
            'total'  => $creds->count(),
            'groups' => collect(Credential::GROUPS)->map(fn ($g) => ['group' => $g, 'count' => $creds->where('category_group', $g)->count()])->values(),
            'protected' => $creds->filter(fn ($c) => $c->isProtected())->count(),
        ]], 200);
    }

    /**
     * POST /credvault/exports { scope: team|personal, groups?[], format: csv|json, include_notes, include_passwords, acknowledge, account_password }
     *
     * The Team Vault "Export Credentials" popup, columns as the prototype's.
     * The file is plain text, so including passwords takes the acknowledgement
     * AND the account password; secrets of protected credentials are written
     * as "[Protected — unlock in CredVault]".
     */
    public function export(Request $request)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate([
            'scope'             => ['required', Rule::in(['team', 'personal'])],
            'groups'            => ['nullable', 'array'],
            'groups.*'          => ['distinct', Rule::in(Credential::GROUPS)],
            'format'            => ['required', Rule::in(['csv', 'json'])],
            'include_notes'     => ['sometimes', 'boolean'],
            'include_passwords' => ['required', 'boolean'],
            'acknowledge'       => ['exclude_unless:include_passwords,true,1', 'accepted'],
            'account_password'  => ['exclude_unless:include_passwords,true,1', 'required', 'string'],
        ], ['acknowledge.accepted' => 'Confirm you understand the risk of exporting readable passwords.', 'account_password.required' => 'Enter your account password to export readable passwords.']);

        if ($d['include_passwords'] && !Hash::check((string) $d['account_password'], $u->password)) {
            $this->reject('Your account password is incorrect.', 'account_password');
        }

        $creds = $this->fileScope($u, $d['scope'] === 'team' ? 'team' : 'mine')
            ->when(!empty($d['groups']), fn ($c) => $c->whereIn('category_group', $d['groups']))->values();
        if ($creds->isEmpty()) $this->reject('No credentials match this selection.', 'groups');

        [$cols, $rows, $withheld] = $this->exportRows($creds, $d['include_passwords'], $d['include_notes'] ?? true);
        $file = ($d['scope'] === 'team' ? 'team' : 'my') . '-vault-credentials-' . now()->format('Ymd') . '.' . $d['format'];
        $body = VaultFile::build($cols, $rows, $d['format']);

        $t = $this->inTransaction('record the export', function () use ($u, $d, $rows, $body, $file) {
            $t = Transfer::create([
                'client_id' => $u->client_id, 'kind' => 'export', 'code' => $this->nextCode('credvault_transfers', 'EX', $u->client_id),
                'user_id' => $u->id, 'scope' => $d['scope'] === 'team' ? 'team' : 'mine', 'format' => $d['format'], 'file_name' => $file,
                'items' => count($rows), 'size_bytes' => strlen($body), 'include_passwords' => $d['include_passwords'],
            ]);
            $this->audit($u, 'export', null, count($rows) . ' credentials exported as ' . strtoupper($d['format']) . ($d['include_passwords'] ? ' with passwords' : ''), ['transfer' => $t->code], 'Team Vault');

            return $t;
        });

        return $this->download($body, $file, $this->mime($d['format']), [
            'X-CredVault-Code' => $t->code, 'X-CredVault-Count' => (string) count($rows), 'X-CredVault-Withheld' => (string) $withheld,
        ]);
    }

    /** GET /credvault/exports — export history. */
    public function exports(Request $request)
    {
        return $this->transferHistory($request, 'export');
    }

    /* ════════════════════════════ RECYCLE BIN ════════════════════════════ */

    /**
     * GET /credvault/recycle-bin?tab=all|mine|team|soon&q= — expired items are
     * purged first, and `purged` says how many went (the prototype's toast).
     * "expiring" is accepted for "soon". Tab counts ignore the search box.
     */
    public function recycleBin(Request $request)
    {
        $u = $this->tenantUser($request);
        if ($request->query('tab') === 'expiring') $request->merge(['tab' => 'soon']);
        $f = $request->validate($this->listRules(['all', 'mine', 'team', 'soon']));
        $pol = Policy::for($u->client_id);
        $purged = $this->purgeExpired($u->client_id, $pol);

        $base = $this->binQuery($u);
        $soon = now()->subDays($pol['bin_days'])->addDays(7);

        $tabs = [
            'all'  => (clone $base)->count(),
            'mine' => (clone $base)->where('deleted_by', $u->id)->count(),
            'team' => (clone $base)->where('scope', 'team')->count(),
            'soon' => (clone $base)->where('deleted_at', '<=', $soon)->count(),
        ];
        $next = (clone $base)->orderBy('deleted_at')->first(['id', 'name', 'deleted_at']);
        $summary = [
            'retention_days'       => $pol['bin_days'],
            'purge_allowed'        => (bool) $pol['bin_purge'],
            'can_change_retention' => $this->isAdmin($u),
            'retention_options'    => Policy::OPTIONS['bin_days'],
            'items'                => $tabs['all'],
            'deleted_by_me'        => $tabs['mine'],
            'expiring_soon'        => $tabs['soon'],
            'critical'             => (clone $base)->where('risk', 'critical')->count(),
            'next_deletion'        => $next ? [
                'name' => $next->name, 'at' => $next->deleted_at->copy()->addDays($pol['bin_days'])->toIso8601String(),
                'days' => max(1, (int) ceil(now()->diffInHours($next->deleted_at->copy()->addDays($pol['bin_days']), false) / 24)),
            ] : null,
        ];

        match ($f['tab'] ?? 'all') {
            'mine'  => $base->where('deleted_by', $u->id),
            'team'  => $base->where('scope', 'team'),
            'soon'  => $base->where('deleted_at', '<=', $soon),
            default => null,
        };
        if ($term = $f['q'] ?? null) {
            // ID, name, category, group, owner and who deleted it.
            $like   = $this->likeTerm($term);
            $types  = collect(Credential::TYPES)->filter(fn ($x) => str_contains(mb_strtolower($x[0]), mb_strtolower(trim($term))))->keys()->all();
            $people = User::where('client_id', $u->client_id)->whereRaw('lower(name) like ?', [$like])->select('id');
            $base->where(function ($w) use ($like, $types, $people) {
                foreach (['name', 'code', 'category_group'] as $col) $w->orWhereRaw("lower(coalesce({$col}, '')) like ?", [$like]);
                if ($types) $w->orWhereIn('type', $types);
                $w->orWhereIn('owner_id', $people)->orWhereIn('deleted_by', $people);
            });
        }

        $page = $base->select(array_merge(self::LIGHT_COLUMNS, ['deleted_at', 'deleted_by']))
            ->with(['owner:id,name'])->orderBy('deleted_at')
            ->paginate($f['per_page'] ?? self::PAGE_SIZE, ['*'], 'page', $f['page'] ?? 1);
        $deleters = User::whereIn('id', collect($page->items())->pluck('deleted_by')->filter()->unique()->all())->pluck('name', 'id');

        return response()->json([
            'status'  => true,
            'purged'  => $purged,
            'summary' => $summary,
            'data'    => collect($page->items())->map(function ($c) use ($pol, $deleters, $u) {
                $purge = $c->deleted_at->copy()->addDays($pol['bin_days']);
                // Never "0 days": an item still in the bin goes on its last day.
                $days  = max(1, (int) ceil(now()->diffInHours($purge, false) / 24));
                $total = $pol['bin_days'];

                return [
                    'id' => $c->id, 'code' => $c->code, 'name' => $c->name, 'type' => $c->type,
                    'type_label' => Credential::typeDef($c->type)['label'] ?? $c->type, 'category_group' => $c->category_group,
                    'url' => $c->url, 'scope' => $c->scope, 'risk' => $c->risk,
                    'owner' => ['id' => $c->owner_id, 'name' => $c->owner?->name, 'is_me' => $c->owner_id === $u->id],
                    'deleted_by' => ['id' => $c->deleted_by, 'name' => $c->deleted_by === $u->id ? 'You' : ($deleters[$c->deleted_by] ?? null)],
                    'deleted_at' => $c->deleted_at->toIso8601String(),
                    'purges_at' => $purge->toIso8601String(), 'days_left' => $days,
                    'left_pct' => (int) round(min($days, $total) / max(1, $total) * 100),
                    'urgency' => $days <= 3 ? 'bad' : ($days <= 7 ? 'warn' : 'ok'),
                    'can_purge' => (bool) $pol['bin_purge'],
                ];
            })->values(),
            'tabs'    => $tabs,
            'meta'    => $this->pageMeta($page),
        ], 200);
    }

    /** POST /credvault/recycle-bin/{id}/restore */
    public function restore(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        $c = $this->binQuery($u)->find($id) ?? $this->reject('That item is not in your Recycle Bin.', null, 404);

        $this->inTransaction('restore the credential', function () use ($c, $u) {
            $c->restore();
            $c->forceFill(['deleted_by' => null, 'updated_by' => $u->id])->saveQuietly();
            $this->audit($u, 'restore', $c, 'Restored from Recycle Bin');
        });

        return response()->json(['status' => true, 'message' => "“{$c->name}” restored to " . ($c->scope === 'team' ? 'Team Vault' : 'My Vault') . '.', 'data' => ['id' => $c->id]], 200);
    }

    /** DELETE /credvault/recycle-bin/{id} { confirm: true } — gone for good. */
    public function purge(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        $request->validate(['confirm' => ['accepted']], ['confirm.accepted' => 'Confirm that you understand this cannot be undone.']);
        $pol = Policy::for($u->client_id);
        if (!$pol['bin_purge']) $this->reject('Permanent delete is turned off in CredVault Policies.', null, 403);

        $c = $this->binQuery($u)->find($id) ?? $this->reject('That item is not in your Recycle Bin.', null, 404);
        $this->inTransaction('delete the credential permanently', fn () => $this->purgeOne($c, $u->id, 'Deleted permanently'));

        return response()->json(['status' => true, 'message' => "“{$c->name}” deleted permanently."], 200);
    }

    /** DELETE /credvault/recycle-bin { confirm: true } — Empty Bin: everything the user may purge. */
    public function emptyBin(Request $request)
    {
        $u = $this->tenantUser($request);
        $request->validate(['confirm' => ['accepted']], ['confirm.accepted' => 'Confirm that you understand this cannot be undone.']);
        $pol = Policy::for($u->client_id);
        if (!$pol['bin_purge']) $this->reject('Permanent delete is turned off in CredVault Policies.', null, 403);

        $items = $this->binQuery($u)->get();
        if ($items->isEmpty()) $this->reject('The Recycle Bin is already empty.', null, 409);

        $this->inTransaction('empty the Recycle Bin', function () use ($items, $u) {
            foreach ($items as $c) $this->purgeOne($c, $u->id, 'Deleted permanently (Empty Bin)');
        });

        return response()->json(['status' => true, 'message' => $items->count() . ' items deleted permanently.'], 200);
    }

    /* ═══════════════════════════ GENERATOR ═══════════════════════════ */

    /**
     * POST /credvault/generate-password — characters or passphrase, from the
     * server's CSPRNG, with the prototype's defaults: length and symbols from
     * the policy, "avoid ambiguous" on, 8 words, one Numbers switch for both
     * modes (add_number is accepted as its passphrase alias).
     */
    public function generatePassword(Request $request)
    {
        $u   = $this->tenantUser($request);
        $pol = Policy::for($u->client_id);
        $d   = $request->validate([
            'mode'            => ['nullable', Rule::in(['chars', 'phrase'])],
            'length'          => ['nullable', 'integer', 'min:8', 'max:64'],
            'upper'           => ['nullable', 'boolean'],
            'lower'           => ['nullable', 'boolean'],
            'numbers'         => ['nullable', 'boolean'],
            'symbols'         => ['nullable', 'boolean'],
            'avoid_ambiguous' => ['nullable', 'boolean'],
            'words'           => ['nullable', 'integer', 'min:4', 'max:12'],
            'separator'       => ['nullable', Rule::in(['-', '.', '_', ' '])],
            'capitalize'      => ['nullable', 'boolean'],
            'add_number'      => ['nullable', 'boolean'],
        ]);

        $addNum = $d['add_number'] ?? $d['numbers'] ?? true;
        if (($d['mode'] ?? 'chars') === 'phrase') {
            $words = array_map(fn () => self::WORDS[random_int(0, count(self::WORDS) - 1)], range(1, $d['words'] ?? 8));
            if ($d['capitalize'] ?? true) $words = array_map('ucfirst', $words);
            if ($addNum) { $i = random_int(0, count($words) - 1); $words[$i] .= random_int(0, 9); }
            $pw   = implode($d['separator'] ?? '-', $words);
            $bits = count($words) * log(count(self::WORDS), 2) + ($addNum ? 3.3 : 0);
        } else {
            $amb  = $d['avoid_ambiguous'] ?? true;   // drops I O · l o · 0 1, as gpGen()
            $sets = array_filter([
                ($d['upper'] ?? true)   ? ($amb ? 'ABCDEFGHJKLMNPQRSTUVWXYZ' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') : null,
                ($d['lower'] ?? true)   ? ($amb ? 'abcdefghijkmnpqrstuvwxyz' : 'abcdefghijklmnopqrstuvwxyz') : null,
                ($d['numbers'] ?? true) ? ($amb ? '23456789' : '0123456789') : null,
                ($d['symbols'] ?? $pol['gen_symbols']) ? '!@#$%^&*-_=+?' : null,
            ]);
            if (!$sets) $this->reject('Keep at least one character set on.', 'upper');

            $len  = $d['length'] ?? $pol['gen_length'];
            $pool = implode('', $sets);
            // One from every chosen set, the rest from the whole pool, then shuffled.
            $chars = array_map(fn ($s) => $s[random_int(0, strlen($s) - 1)], array_values($sets));
            while (count($chars) < $len) $chars[] = $pool[random_int(0, strlen($pool) - 1)];
            for ($i = count($chars) - 1; $i > 0; $i--) { $j = random_int(0, $i); [$chars[$i], $chars[$j]] = [$chars[$j], $chars[$i]]; }
            $pw   = implode('', $chars);
            $bits = $len * log(strlen(count_chars($pool, 3)), 2);
        }

        $bits = (int) round($bits);

        return response()->json(['status' => true, 'data' => [
            'password' => $pw,
            'bits'     => $bits,
            'level'    => $bits >= 100 ? 'Very strong' : ($bits >= 75 ? 'Strong' : ($bits >= 55 ? 'Good' : ($bits >= 40 ? 'Fair' : 'Weak'))),
            'strength' => Credential::strengthOf($pw),
            'meets_policy' => Credential::strengthOf($pw) >= $pol['min_strength'],
        ]], 200);
    }

    /* ═════════════════════════════ DASHBOARD ═════════════════════════════ */

    /**
     * GET /credvault/dashboard?range=7|14|30&tz= — the landing page, every
     * widget in one call, computed as the prototype's vdData():
     *
     *   score = round(hp·.40 + tp·.25 + rp·.20 + bkp·.15), each factor a whole
     *   percent first; a factor with nothing to measure counts 0.
     *     hp  credentials with no open issue / credentials in your vaults
     *     tp  2FA on / credentials where 2FA applies
     *     rp  rotations on time (due-soon included) / credentials that rotate
     *     bkp 50 for a good backup in 7 days (30 within 30 days) + 50 × locked share
     *
     * tz (an IANA zone, e.g. Asia/Kolkata) buckets the activity chart by the
     * viewer's own midnight; the server runs on UTC.
     */
    public function dashboard(Request $request)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate([
            'range' => ['nullable', 'integer', Rule::in([7, 14, 30])],
            'tz'    => ['nullable', 'timezone:all_with_bc'], // browsers still report aliases such as Asia/Calcutta
        ]);
        $range = $d['range'] ?? 14;
        $tz    = $d['tz'] ?? config('app.timezone');
        $pol   = Policy::for($u->client_id);
        $this->sweepUnlocks($u->client_id);
        $this->purgeExpired($u->client_id, $pol);

        $all    = $this->visibleQuery($u)->select(self::LIGHT_COLUMNS)->with('owner:id,name')->get();
        $access = $this->accessMap($all, $u);
        $own    = $all->filter(fn ($c) => ($access[$c->id][1] ?? null) !== 'share')->values();   // your vaults: what health counts
        $issues = collect($this->healthIssues($own, $pol));
        $risky  = $issues->pluck('credential.id')->unique();
        $shared = $all->filter(fn ($c) => $c->owner_id !== $u->id && ($access[$c->id][1] ?? null) === 'share');

        $rot = ['ok' => 0, 'soon' => 0, 'over' => 0];
        foreach ($own as $c) if ($s = $this->rotationState($c, $pol)['state']) $rot[$s]++;
        $rotN = array_sum($rot);
        $tw   = $own->whereIn('twofa', ['yes', 'no']);
        $pw   = $own->where('has_password', true);

        // Backups and imports over all history, in aggregate.
        $bk = Transfer::where('client_id', $u->client_id)->where('kind', 'backup');
        $bkStats = (clone $bk)->selectRaw(
            "sum(case when status = 'done' then 1 else 0 end) as ok,
             sum(case when status = 'done' and locked then 1 else 0 end) as locked,
             sum(case when status = 'failed' then 1 else 0 end) as failed,
             sum(case when status = 'failed' and created_at >= ? then 1 else 0 end) as failed30,
             count(distinct case when status = 'done' then user_id end) as people", [now()->subDays(30)]
        )->first();
        $okN    = (int) $bkStats->ok;
        $lastOk = (clone $bk)->where('status', 'done')->orderByDesc('id')->first();
        $byFormat = (clone $bk)->where('status', 'done')->selectRaw('format, count(*) as n')->groupBy('format')->pluck('n', 'format');

        $pct = fn ($n, $of) => $of ? (int) round($n / $of * 100) : 0;
        $hp  = $pct($own->count() - $risky->count(), $own->count());
        $tp  = $pct($tw->where('twofa', 'yes')->count(), $tw->count());
        $rp  = $pct($rot['ok'] + $rot['soon'], $rotN);
        $bkp = (int) round(($lastOk && $lastOk->created_at->gt(now()->subDays(7)) ? 50 : ($lastOk && $lastOk->created_at->gt(now()->subDays(30)) ? 30 : 0))
            + ($okN ? 50 * (int) $bkStats->locked / $okN : 0));
        $score = (int) round($hp * .4 + $tp * .25 + $rp * .2 + $bkp * .15);

        $critical = $all->where('risk', 'critical');
        $unlocked = AccessRequest::where('requester_id', $u->id)->where('status', 'unlocked')->where('expires_at', '>', now())->pluck('credential_id')->all();
        $reqQ     = AccessRequest::where('client_id', $u->client_id)
            ->when(!$this->isAdmin($u), fn ($q) => $q->where(fn ($w) => $w->where('requester_id', $u->id)->orWhere('admin_user_id', $u->id)->orWhere('manager_user_id', $u->id)));
        $pending  = (clone $reqQ)->where('status', 'pending')->get(['id', 'admin_required', 'admin_status', 'created_at']);
        $reqTotal = (clone $reqQ)->count();

        $myShares = CredentialShare::live()->whereIn('credential_id', $all->where('owner_id', $u->id)->pluck('id')->all())->get(['credential_id', 'expires_at']);
        $endWeek  = $myShares->filter(fn ($s) => $s->expires_at && $s->expires_at->lte(now()->addDays(7)))->count();
        $bin      = $this->binQuery($u)->get(['id', 'deleted_at', 'deleted_by']);
        $binSoon  = $bin->filter(fn ($b) => $b->deleted_at->copy()->addDays($pol['bin_days'])->lte(now()->addDays(7)))->count();

        // Activity: this range and the one before it, by the viewer's day.
        $startLocal = now($tz)->subDays($range - 1)->startOfDay();
        $from = $startLocal->copy()->utc();
        $prevFrom = $startLocal->copy()->subDays($range)->utc();
        $dayExpr = DB::getDriverName() === 'pgsql'
            ? "to_char((created_at AT TIME ZONE 'UTC') AT TIME ZONE " . DB::getPdo()->quote($tz) . ", 'YYYY-MM-DD')"
            : 'date(created_at)';
        $events = $this->auditQuery($u, ['range' => 'all'])->where('created_at', '>=', $from)
            ->selectRaw("{$dayExpr} as day, severity, count(*) as n")->groupBy('day', 'severity')->get();
        $prevTotal = $this->auditQuery($u, ['range' => 'all'])->where('created_at', '>=', $prevFrom)->where('created_at', '<', $from)->count();
        $days = [];
        for ($i = 0; $i < $range; $i++) {
            $key = $startLocal->copy()->addDays($i)->toDateString();
            $days[$key] = ['date' => $key, 'info' => 0, 'warn' => 0, 'critical' => 0, 'total' => 0];
        }
        foreach ($events as $e) {
            if (!isset($days[$e->day])) continue;
            $days[$e->day][$e->severity] = (int) $e->n;
            $days[$e->day]['total'] += (int) $e->n;
        }
        $total = array_sum(array_column($days, 'total'));
        $busiest = collect($days)->sortByDesc('total')->first();

        $recent  = $this->auditQuery($u, ['range' => 'all'])->with('user:id,name')->orderByDesc('id')->limit(10)->get();
        $imQ     = Transfer::where('client_id', $u->client_id)->where('kind', 'import');
        $imStats = (clone $imQ)->selectRaw('count(*) as runs, coalesce(sum(items),0) as items, coalesce(sum(weak),0) as weak, coalesce(sum(duplicates),0) as dup, coalesce(sum(skipped),0) as skipped, count(distinct user_id) as people')->first();

        // Departments: every one with people, counting each credential by its
        // team or, for a personal one, by its owner's department.
        $ownerDept = $this->departmentsOfUsers($all->pluck('owner_id')->unique()->all());
        $deptOf    = fn ($c) => $c->department_id ?: ($ownerDept[$c->owner_id] ?? null);
        $members   = $this->memberCounts($u->client_id);
        $departments = $this->clientDepartments($u)->filter(fn ($x) => ($members[$x->id] ?? 0) > 0)->map(function ($x) use ($all, $deptOf, $members) {
            $g = $all->filter(fn ($c) => $deptOf($c) === $x->id);
            return ['id' => $x->id, 'name' => $x->name, 'count' => $g->count(), 'critical' => $g->where('risk', 'critical')->count(), 'members' => $members[$x->id] ?? 0];
        })->sortByDesc('count')->values();

        $attention = array_values(array_filter([
            ['level' => 'bad',  'key' => 'critical_issues', 'label' => 'Critical password issues',       'sub' => 'Weak, reused or unprotected critical logins',     'count' => $issues->where('severity', 'critical')->count(), 'open' => 'health'],
            ['level' => 'bad',  'key' => 'twofa_missing',   'label' => '2FA missing on high-risk logins', 'sub' => 'The password alone is enough to sign in',        'count' => $issues->where('type', 'twofa')->count(), 'open' => 'health'],
            ['level' => 'bad',  'key' => 'backup_failed',   'label' => 'Failed backup attempts',          'sub' => 'In the last 30 days',                            'count' => (int) $bkStats->failed30, 'open' => 'backup'],
            ['level' => 'warn', 'key' => 'requests',        'label' => 'Access requests waiting',         'sub' => 'People waiting to open a critical credential',   'count' => $pending->count(), 'open' => 'access-requests'],
            ['level' => 'warn', 'key' => 'rotation',        'label' => 'Rotation overdue or due soon',    'sub' => 'Older than the policy allows',                   'count' => $issues->where('type', 'rotation')->count(), 'open' => 'health'],
            ['level' => 'warn', 'key' => 'weak',            'label' => 'Weak passwords',                  'sub' => 'Below the policy minimum strength',              'count' => $issues->where('type', 'weak')->count(), 'open' => 'health'],
            ['level' => 'warn', 'key' => 'reused',          'label' => 'Reused passwords',                'sub' => 'Same password on more than one credential',      'count' => $issues->where('type', 'reused')->count(), 'open' => 'health'],
            ['level' => 'warn', 'key' => 'shared',          'label' => 'Shared too widely',               'sub' => 'More people have access than needed',            'count' => $issues->where('type', 'shared')->count(), 'open' => 'health'],
            ['level' => 'warn', 'key' => 'backup_unlocked', 'label' => 'Backups without a password',      'sub' => 'Anyone with the file can read it',               'count' => $okN - (int) $bkStats->locked, 'open' => 'backup'],
            ['level' => 'info', 'key' => 'bin_expiring',    'label' => 'Deleted for good this week',      'sub' => 'Restore from the Recycle Bin if needed',         'count' => $binSoon, 'open' => 'recycle-bin'],
        ], fn ($r) => $r['count'] > 0));
        $team = $own->where('scope', 'team')->count();

        return response()->json(['status' => true, 'data' => [
            'updated_at' => now()->toIso8601String(),
            'score' => [
                'value' => $score,
                'level' => $score >= 80 ? 'Strong' : ($score >= 60 ? 'Needs care' : 'At risk'),
                'healthy' => $own->count() - $risky->count(), 'checked' => $own->count(),
                'factors' => [
                    ['key' => 'health',   'label' => 'Password health',    'weight' => 40, 'value' => $hp],
                    ['key' => 'twofa',    'label' => 'Two-factor sign-in', 'weight' => 25, 'value' => $tp, 'enabled' => $tw->where('twofa', 'yes')->count(), 'applies' => $tw->count()],
                    ['key' => 'rotation', 'label' => 'Rotation on time',   'weight' => 20, 'value' => $rp, 'overdue' => $rot['over'], 'due_soon' => $rot['soon']],
                    ['key' => 'backups',  'label' => 'Backups',            'weight' => 15, 'value' => $bkp, 'locked' => (int) $bkStats->locked, 'downloaded' => $okN, 'last_backup_at' => $lastOk?->created_at?->toIso8601String()],
                ],
            ],
            'kpis' => [
                'total'     => ['value' => $all->count(), 'mine' => $all->where('owner_id', $u->id)->count(), 'personal' => $own->count() - $team, 'team' => $team, 'shared_with_me' => $shared->count()],
                'critical'  => ['value' => $critical->count(), 'unlocked_now' => $critical->whereIn('id', $unlocked)->count(), 'locked' => $critical->count() - $critical->whereIn('id', $unlocked)->count(), 'open_requests' => $pending->count()],
                'approvals' => ['value' => $pending->count(), 'total' => $reqTotal, 'admin_stage' => $pending->where('admin_status', 'pending')->count(), 'manager_stage' => $pending->where('admin_status', '!=', 'pending')->count(), 'oldest_at' => $pending->min('created_at')?->toIso8601String()],
                'issues'    => ['value' => $issues->count(), 'credentials' => $risky->count(), 'of' => $own->count(), 'critical' => $issues->where('severity', 'critical')->count(), 'high' => $issues->where('severity', 'high')->count(), 'medium' => $issues->where('severity', 'medium')->count()],
                'shares'    => ['value' => $myShares->count(), 'credentials' => $myShares->pluck('credential_id')->unique()->count(), 'of' => $all->where('owner_id', $u->id)->count(), 'ongoing' => $myShares->count() - $endWeek, 'ending_this_week' => $endWeek],
                'bin'       => ['value' => $bin->count(), 'by_me' => $bin->where('deleted_by', $u->id)->count(), 'by_team' => $bin->where('deleted_by', '!=', $u->id)->count(), 'expiring' => $binSoon],
            ],
            'by_group'   => collect(Credential::GROUPS)->map(fn ($g) => ['group' => $g, 'count' => $all->where('category_group', $g)->count(),
                'top_types' => $all->where('category_group', $g)->countBy('type')->sortDesc()->take(4)->map(fn ($n, $t) => ['type' => $t, 'label' => Credential::typeDef($t)['label'] ?? $t, 'count' => $n])->values()]),
            'top_types'  => $all->countBy('type')->sortDesc()->take(3)->map(fn ($n, $t) => ['type' => $t, 'label' => Credential::typeDef($t)['label'] ?? $t, 'count' => $n])->values(),
            'by_risk'    => collect(Credential::RISKS)->mapWithKeys(fn ($r) => [$r => $all->where('risk', $r)->count()]),
            'where'      => [
                'personal' => $own->count() - $team, 'team' => $team, 'shared_with_me' => $shared->count(),
                'owned_by_me' => $all->where('owner_id', $u->id)->count(), 'owned_by_others' => $all->where('owner_id', '!=', $u->id)->count(),
                'top_owners' => $all->where('owner_id', '!=', $u->id)->groupBy('owner_id')->map(fn ($g) => ['name' => $g->first()->owner?->name, 'count' => $g->count()])->sortByDesc('count')->take(3)->values(),
            ],
            'activity'   => [
                'range' => $range, 'timezone' => $tz, 'days' => array_values($days),
                'total' => $total, 'average' => $range ? round($total / $range, 1) : 0,
                'previous_total' => $prevTotal,
                'change_pct' => $prevTotal >= 10 ? (int) round(($total - $prevTotal) / $prevTotal * 100) : null,
                'busiest' => $busiest && $busiest['total'] ? ['date' => $busiest['date'], 'events' => $busiest['total']] : null,
                'critical' => array_sum(array_column($days, 'critical')), 'warnings' => array_sum(array_column($days, 'warn')),
            ],
            'hygiene'    => [
                'strength' => ['strong' => $pw->where('strength', 4)->count(), 'good' => $pw->where('strength', 3)->count(), 'fair' => $pw->where('strength', 2)->count(), 'weak' => $pw->where('strength', 1)->count(),
                               'meets_policy' => $pw->where('strength', '>=', $pol['min_strength'])->count(), 'with_password' => $pw->count(),
                               'pct' => $pct($pw->where('strength', '>=', $pol['min_strength'])->count(), $pw->count())],
                'twofa'    => ['enabled' => $tw->where('twofa', 'yes')->count(), 'disabled' => $tw->where('twofa', 'no')->count(), 'pct' => $tp],
                'rotation' => $rot + ['pct' => $rp],
                'policy'   => ['min_strength' => $pol['min_strength'], 'min_strength_label' => Credential::STRENGTH_LABELS[$pol['min_strength']],
                               'rotation_default' => $pol['rotation_default'], 'twofa_risks' => $pol['twofa_risks']],
            ],
            'attention'   => $attention,
            'attention_summary' => ['urgent' => collect($attention)->where('level', 'bad')->count(), 'areas' => count($attention), 'items' => array_sum(array_column($attention, 'count'))],
            'recent'      => $this->eventRows($recent, $u),
            'departments' => $departments,
            'backups' => [
                'downloaded' => $okN, 'locked' => (int) $bkStats->locked, 'not_locked' => $okN - (int) $bkStats->locked, 'failed' => (int) $bkStats->failed,
                'locked_pct' => $pct((int) $bkStats->locked, $okN),
                'last' => $lastOk ? ['code' => $lastOk->code, 'items' => $lastOk->items, 'at' => $lastOk->created_at->toIso8601String()] : null,
                'by_format' => collect(['xlsx', 'csv', 'json'])->map(fn ($f) => ['format' => $f, 'label' => Transfer::FORMAT_LABELS[$f], 'count' => (int) ($byFormat[$f] ?? 0)])->values(),
                'people' => (int) $bkStats->people,
                'latest' => (clone $bk)->with('user:id,name')->orderByDesc('id')->limit(6)->get()->reverse()->map(fn ($t) => $this->transferRow($t, $u))->values(),
            ],
            'imports' => [
                'items' => (int) $imStats->items, 'runs' => (int) $imStats->runs, 'weak' => (int) $imStats->weak, 'people' => (int) $imStats->people,
                'duplicates' => (int) $imStats->dup, 'skipped' => (int) $imStats->skipped,
                'clean' => max(0, (int) $imStats->items - (int) $imStats->weak),
                'by_source' => (clone $imQ)->selectRaw('source, coalesce(sum(items),0) as n')->groupBy('source')->orderByDesc('n')->pluck('n', 'source')->map(fn ($n) => (int) $n),
                'latest' => (clone $imQ)->with('user:id,name')->orderByDesc('id')->limit(3)->get()->map(fn ($t) => $this->transferRow($t, $u))->values(),
            ],
        ]], 200);
    }

    /** [user_id => department_id] from the login, else the employee record. */
    private function departmentsOfUsers(array $ids): array
    {
        if (!$ids) return [];
        $out = User::whereIn('id', $ids)->whereNotNull('department_id')->pluck('department_id', 'id')->map(fn ($d) => (int) $d)->all();
        Employee::whereIn('user_id', array_diff($ids, array_keys($out)))->whereNotNull('department_id')->get(['user_id', 'department_id'])
            ->each(function ($e) use (&$out) { $out[$e->user_id] ??= (int) $e->department_id; });

        return $out;
    }

    /* ═════════════════════════ CREDENTIAL WRITES ═════════════════════════ */

    private function credentialRules(bool $creating): array
    {
        return [
            'type'                 => [$creating ? 'required' : 'sometimes', 'string', Rule::in(array_keys(Credential::TYPES))],
            'name'                 => [$creating ? 'required' : 'sometimes', 'string', 'min:2', 'max:150'],
            'scope'                => ['sometimes', Rule::in(Credential::SCOPES)],
            'department_id'        => ['nullable', 'integer', 'min:1'],
            'risk'                 => ['sometimes', 'nullable', Rule::in(Credential::RISKS)],
            'rotation_days'        => ['sometimes', 'nullable', 'integer', Rule::in(Credential::ROTATIONS)],
            'twofa'                => ['sometimes', 'boolean'],
            'notes'                => ['sometimes', 'nullable', 'string', 'max:5000'],
            'fields'               => ['sometimes', 'array'],
            'reg_email'            => ['sometimes', 'nullable', 'email:rfc', 'max:191'],
            'reg_phone'            => ['sometimes', 'nullable', 'regex:/^\+?[\d\s()-]{10,16}$/'],
            'recovery_key'         => ['sometimes', 'nullable', 'string', 'min:4', 'max:500'],
            'files'                => ['sometimes', 'array'],
            'files.*'              => ['file', 'max:' . self::FILE_MAX_KB, 'extensions:' . self::FIELD_FILE_TYPES],
            'attachments'          => ['sometimes', 'array', 'max:' . self::MAX_EXTRA_ATTACHMENTS],
            'attachments.*'        => ['file', 'max:' . self::FILE_MAX_KB, 'extensions:' . self::ATTACH_TYPES],
            'remove_attachments'   => ['sometimes', 'array'],
            'remove_attachments.*' => ['string', 'max:40'],
            'lock_admin'           => ['sometimes', 'boolean'],
            'lock_manager'         => ['sometimes', 'boolean'],
            'lock_otp'             => ['sometimes', 'boolean'],
            'lock_admin_user_id'   => ['sometimes', 'nullable', 'integer', 'min:1'],
            'lock_manager_user_id' => ['sometimes', 'nullable', 'integer', 'min:1'],
            // Linking the authenticator, in the form, before the save — the secret comes from POST /authenticator/new.
            'totp_secret'          => ['sometimes', 'nullable', 'string', 'regex:/^[A-Z2-7]{16,128}$/', 'required_with:totp_code'],
            'totp_code'            => ['sometimes', 'nullable', 'regex:/^\d{6}$/', 'required_with:totp_secret'],
        ];
    }

    /**
     * "yes"/"no" — what the form's 2FA switch posts — read as booleans, for
     * the top-level switch and for the Password type's own 2FA toggle field.
     */
    private function normaliseSwitches(Request $request): void
    {
        $yn = fn ($v) => is_string($v) && in_array(strtolower($v), ['yes', 'no'], true) ? strtolower($v) === 'yes' : $v;
        if ($request->has('twofa')) $request->merge(['twofa' => $yn($request->input('twofa'))]);
        $f = $request->input('fields');
        if (is_array($f) && array_key_exists('twofa', $f)) {
            $f['twofa'] = filter_var($yn($f['twofa']), FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            $request->merge(['fields' => $f]);
        }
    }

    /**
     * Create ($c null) or update one credential — the Add and Edit forms.
     *
     * The authenticator follows the prototype: on a type with a 2FA switch
     * (login, email, bank, crypto, passkey, password) that switch IS the
     * authenticator lock, at any risk; on other types a critical credential
     * has its own "2FA — Authenticator app" step (lock_otp). Either way the
     * app is linked inside the form — the form sends the secret it showed as
     * a QR code and one code from the app — and the save is refused until it
     * is, so no credential is ever left locked behind an app nobody has.
     */
    private function persistCredential(Request $request, User $u, ?Credential $c)
    {
        $creating = $c === null;
        $this->normaliseSwitches($request);
        $data = $request->validate($this->credentialRules($creating), [
            'reg_phone.regex'          => 'Enter a phone number of 10 to 16 digits.',
            'files.*.extensions'       => 'Allowed files: ' . str_replace(',', ', ', self::FIELD_FILE_TYPES) . '.',
            'attachments.*.extensions' => 'Allowed files: ' . str_replace(',', ', ', self::ATTACH_TYPES) . '.',
            'totp_secret.regex'        => 'The setup key is not valid — get a new one and scan it again.',
            'totp_code.regex'          => 'Enter the 6-digit code shown in your authenticator app.',
        ]);

        $type = $creating ? $data['type'] : $c->type;
        if (!$creating && isset($data['type']) && $data['type'] !== $c->type) {
            $this->reject('The type of a credential cannot be changed — add a new one instead.', 'type');
        }
        $def = Credential::typeDef($type);
        $pol = Policy::for($u->client_id);
        $scopeIds = $creating ? [] : $this->healthScope($u)->pluck('id')->all();
        $before = $creating ? [] : $this->singleIssues($c, $pol, $scopeIds);

        // The Password type keeps its 2FA switch among its fields; it is the credential's 2FA, not a stored field.
        $inputFields = $data['fields'] ?? [];
        $toggle2fa = array_key_exists('twofa', $inputFields) ? $inputFields['twofa'] : null;
        unset($inputFields['twofa']);
        $existing = $creating ? [] : ($c->fields ?? []);
        unset($existing['twofa']);

        $fields = $this->validateTypeFields($def, $inputFields, $existing, $request, $c);
        foreach (['reg_email' => '_reg_email', 'reg_phone' => '_reg_phone', 'recovery_key' => '_recovery_key'] as $in => $key) {
            if (!array_key_exists($in, $data)) continue;
            if (filled($data[$in])) $fields[$key] = trim($data[$in]); else unset($fields[$key]);
        }

        $name = trim($data['name'] ?? $c->name);
        $ownerId = $creating ? $u->id : $c->owner_id;
        $dup = Credential::where('client_id', $u->client_id)->where('owner_id', $ownerId)->where('type', $type)
            ->whereRaw('lower(trim(name)) = lower(?)', [$name])->when(!$creating, fn ($q) => $q->where('id', '!=', $c->id))->exists();
        if ($dup) $this->reject("There is already a {$def['label']} named “{$name}” in this vault.", 'name');

        $scope  = $data['scope'] ?? ($c->scope ?? 'personal');
        $deptId = $scope === 'team'
            ? $this->teamDepartmentFor($u, array_key_exists('department_id', $data) ? $data['department_id'] : ($c->department_id ?? null))
            : null;

        $risk = $data['risk'] ?? ($c->risk ?? $def['risk']);
        $sec  = $def['sec'];
        $secret  = $sec ? ($fields[$sec] ?? null) : null;
        $isPw    = Credential::secretIsPassword($type);
        $changed = $creating || ($sec && array_key_exists($sec, $inputFields) && $secret !== $c->secret);
        $strength = $isPw ? Credential::strengthOf($secret) : 0;
        if ($isPw && $secret !== null && $changed && $strength < $pol['min_strength']) {
            $this->reject('Policy requires a ' . Credential::STRENGTH_LABELS[$pol['min_strength']] . ' or stronger password — use the generate button.', "fields.{$sec}");
        }

        $rotation = $isPw ? (array_key_exists('rotation_days', $data) ? $data['rotation_days'] : ($creating ? $pol['rotation_default'] : $c->rotation_days)) : null;
        $twofa = match (true) {
            (bool) $def['twofa']              => (array_key_exists('twofa', $data) ? $data['twofa'] : (!$creating && $c->twofa === 'yes')) ? 'yes' : 'no',
            Credential::hasTwofaSwitch($type) => ($toggle2fa ?? $data['twofa'] ?? (!$creating && $c->twofa === 'yes')) ? 'yes' : 'no',
            default                           => 'na',
        };

        // Protection. Admin and manager steps exist only on a critical credential.
        $critical    = $risk === 'critical';
        $wasCritical = !$creating && $c->risk === 'critical';
        $pick = fn (string $k, bool $default) => array_key_exists($k, $data) ? (bool) $data[$k] : $default;
        $lockAdmin   = $critical && $pick('lock_admin', $wasCritical ? $c->lock_admin : true);
        $lockManager = $critical && $pick('lock_manager', $wasCritical ? $c->lock_manager : true);
        $lockOtp     = Credential::hasTwofaSwitch($type)
            ? $twofa === 'yes'
            : $critical && $pick('lock_otp', $wasCritical ? $c->lock_otp : true);
        if ($critical && !$lockAdmin && !$lockManager && !$lockOtp) {
            $this->reject('Turn on at least one protection step for a critical credential.', 'lock_admin');
        }
        $adminUserId = $lockAdmin ? (array_key_exists('lock_admin_user_id', $data) ? $data['lock_admin_user_id'] : $c?->lock_admin_user_id) : null;
        if ($adminUserId && !in_array((int) $adminUserId, $this->adminIds($u->client_id), true)) {
            $this->reject('The approving Vault Admin must be a company admin.', 'lock_admin_user_id');
        }
        $managerUserId = $lockManager ? (array_key_exists('lock_manager_user_id', $data) ? $data['lock_manager_user_id'] : $c?->lock_manager_user_id) : null;
        if ($managerUserId && !User::where('client_id', $u->client_id)->where('status', 'active')->whereKey($managerUserId)->exists()) {
            $this->reject('The approving manager must be an active user of your company.', 'lock_manager_user_id');
        }

        // The authenticator: a new secret plus a code (first link or re-link), or the one already linked.
        $newSecret = $data['totp_secret'] ?? null;
        if ($newSecret && !Totp::verify($newSecret, (string) $data['totp_code'])) {
            $this->reject('That code is incorrect or expired. Check your app and try again.', 'totp_code');
        }
        if ($lockOtp && !$newSecret && !($c?->totp_secret && $c?->totp_linked_at)) {
            $this->reject('Scan the QR code and verify a code to link your authenticator app, or turn 2FA off.', 'totp_code');
        }

        $idSpec   = $def['id'] ? collect($def['fields'])->firstWhere('key', $def['id']) : null;
        $idValue  = $def['id'] ? ($fields[$def['id']] ?? null) : null;
        // A secret id (account, passport, licence number) shows as its last four only.
        $username = $idValue === null ? null : (!empty($idSpec['secret']) ? '•••• ' . mb_substr((string) $idValue, -4) : $idValue);
        $url      = collect(['url', 'endpoint', 'host', 'domain'])->map(fn ($k) => $fields[$k] ?? null)->first(fn ($v) => filled($v));

        $stored = [];
        $result = $this->inTransaction($creating ? 'save the credential' : 'update the credential', function () use (
            $request, $u, $c, $creating, $data, $type, $def, $pol, $fields, $name, $scope, $deptId, $risk, $secret, $strength, $isPw,
            $changed, $rotation, $twofa, $lockAdmin, $lockManager, $lockOtp, $adminUserId, $managerUserId, $username, $url, $before,
            $newSecret, $scopeIds, &$stored
        ) {
            if ($creating) {
                $c = new Credential([
                    'client_id' => $u->client_id, 'branch_id' => $u->branch_id, 'owner_id' => $u->id, 'created_by' => $u->id,
                    'code' => $this->nextCode('credvault_credentials', 'CRD', $u->client_id), 'type' => $type,
                ]);
            }
            $dirtyBefore = $creating ? [] : ['name' => $c->name, 'risk' => $c->risk, 'scope' => $c->scope, 'rotation_days' => $c->rotation_days, 'twofa' => $c->twofa];

            $c->fill([
                'category_group' => $def['group'], 'name' => $name, 'scope' => $scope, 'department_id' => $deptId,
                'url' => $url ? Str::limit($url, 500, '') : null, 'username' => $username ? Str::limit($username, 191, '') : null,
                'secret' => $secret, 'secret_hash' => Credential::hashSecret($secret), 'fields' => $fields,
                'risk' => $risk, 'strength' => $strength, 'has_password' => $isPw && filled($secret), 'twofa' => $twofa,
                'rotation_days' => $rotation, 'lock_admin' => $lockAdmin, 'lock_manager' => $lockManager, 'lock_otp' => $lockOtp,
                'lock_admin_user_id' => $adminUserId, 'lock_manager_user_id' => $managerUserId, 'updated_by' => $u->id,
            ]);
            if (array_key_exists('notes', $data)) $c->notes = filled($data['notes']) ? trim($data['notes']) : null;
            if ($changed && filled($secret)) $c->password_changed_at = now();

            $relinked = false;
            if ($lockOtp && $newSecret) {
                $c->totp_secret = $newSecret;
                $c->totp_linked_at = now();
                $relinked = true;
            } elseif (!$lockOtp) {
                $c->totp_secret = null;
                $c->totp_linked_at = null;
            }
            $c->save();

            $c->attachments = $this->syncAttachments($request, $c, $def, $data['remove_attachments'] ?? [], $stored);
            $c->saveQuietly();

            if ($creating) {
                $this->audit($u, 'create', $c, "{$def['label']} credential added");
            } else {
                $what = array_keys(array_diff_assoc(array_map('strval', $dirtyBefore), array_map('strval', [
                    'name' => $c->name, 'risk' => $c->risk, 'scope' => $c->scope, 'rotation_days' => $c->rotation_days, 'twofa' => $c->twofa,
                ])));
                if (array_key_exists('fields', $data)) $what[] = 'details';
                if ($changed) $what[] = 'secret';
                $this->audit($u, 'edit', $c, 'Updated' . ($what ? ': ' . implode(', ', array_unique($what)) : ''), ['changed' => array_values(array_unique($what))]);
            }
            if ($relinked) $this->audit($u, 'totp_linked', $c, 'Authenticator app linked');

            // Becoming critical brings the live shares under the critical sharing rules the
            // Share popup enforces: none when policy forbids it, no Full Access, an end date.
            if (!$creating && $risk === 'critical' && ($dirtyBefore['risk'] ?? null) !== 'critical') {
                $this->tightenSharesForCritical($u, $c, $pol);
            }

            // Password Health → Resolved: every issue this save made go away.
            $resolved = [];
            $open = $creating ? [] : $this->singleIssues($c, $pol, $scopeIds);
            foreach ($before as $issue) {
                if (in_array($issue['type'], array_column($open, 'type'), true)) continue;
                $resolved[] = $issue;
                $this->audit($u, 'health_fixed', $c, $issue['issue'] . ' — resolved',
                    ['type' => $issue['type'], 'severity' => $issue['severity'], 'issue' => $issue['issue'], 'detail' => $issue['detail']], 'Password Health');
            }

            return [$c, $resolved, $open];
        }, $stored);

        [$c, $resolved, $open] = $result;
        $body = $this->detail($c->fresh(['owner:id,name', 'department:id,name']), $u, [self::RANK_FULL, $c->owner_id === $u->id ? 'owner' : 'admin']);
        if (!$creating) {
            // The Fix flow's toast: "N health issues resolved" or "Saved — the issue is still open".
            $body['health'] = [
                'resolved'   => array_map(fn ($i) => collect($i)->only(['type', 'severity', 'issue'])->all(), $resolved),
                'still_open' => array_map(fn ($i) => collect($i)->only(['type', 'severity', 'issue'])->all(), $open),
            ];
        }

        return response()->json([
            'status'  => true,
            'message' => $creating
                ? "“{$c->name}” saved to " . ($scope === 'team' ? 'Team Vault' : 'My Vault') . '.'
                : ($resolved ? count($resolved) . ' health ' . Str::plural('issue', count($resolved)) . ' resolved' : 'Credential updated.'),
            'data'    => $body,
        ], $creating ? 201 : 200);
    }

    /**
     * The type form, checked field by field. Fields left out keep their stored
     * value; a required field must hold a value once the edit is applied.
     *
     * @return array the merged fields, normalised
     */
    private function validateTypeFields(array $def, array $input, array $existing, Request $request, ?Credential $c): array
    {
        $errors = [];
        $known  = array_column($def['fields'], 'key');
        foreach (array_keys($input) as $k) {
            if (!in_array($k, $known, true)) $errors["fields.{$k}"][] = "“{$k}” is not a field of a {$def['label']} credential.";
        }

        $merged = $existing;
        foreach ($def['fields'] as $f) {
            $k = $f['key'];
            if ($f['kind'] === 'file') {
                $has = $request->hasFile("files.{$k}") || collect($c?->attachments ?? [])->contains('key', $k);
                $removing = in_array($k, (array) $request->input('remove_attachments', []), true) && !$request->hasFile("files.{$k}");
                if ($f['required'] && (!$has || $removing)) $errors["files.{$k}"][] = "Upload the {$f['label']}.";
                continue;
            }

            if (array_key_exists($k, $input)) {
                $v = $input[$k];
                if (is_string($v)) $v = trim($v);
                if ($v === '' || $v === null) unset($merged[$k]); else $merged[$k] = $v;
            }
            $v = $merged[$k] ?? null;
            if ($v === null) {
                if ($f['required']) $errors["fields.{$k}"][] = ($f['kind'] === 'select' ? 'Select' : 'Enter') . " the {$f['label']}.";
                continue;
            }
            if (!is_scalar($v)) { $errors["fields.{$k}"][] = "{$f['label']} must be text."; continue; }

            [$msg, $norm] = $this->checkField($def['key'], $f, (string) $v);
            if ($msg) $errors["fields.{$k}"][] = $msg; else $merged[$k] = $norm;
        }

        if ($errors) throw ValidationException::withMessages($errors);

        return $merged;
    }

    /** @return array{0:?string,1:string} an error message, or null and the normalised value */
    private function checkField(string $type, array $f, string $v): array
    {
        $label = $f['label'];
        $max   = $f['max'] ?? (in_array($f['kind'], ['secret', 'textarea'], true) || $f['secret'] ? 10000 : 500);
        if (mb_strlen($v) > $max) return ["{$label} can be at most {$max} characters.", $v];

        $err = match ($f['kind']) {
            // A scheme is optional (the prototype accepts "books.zoho.in"); a path, query or fragment may follow.
            'url'    => preg_match('~^([a-z][a-z0-9+.-]*://)?((([\w-]+\.)+[a-z]{2,})|(\d{1,3}(\.\d{1,3}){3})|localhost)(:\d+)?([/?#]\S*)?$~i', $v)
                            ? null : "Enter a valid web address for {$label}.",
            'email'  => filter_var($v, FILTER_VALIDATE_EMAIL) ? null : "Enter a valid email for {$label}.",
            'number' => ctype_digit($v) && strlen($v) <= 9 ? null : "{$label} must be a whole number.",
            'date'   => ($d = \DateTime::createFromFormat('Y-m-d', $v)) && $d->format('Y-m-d') === $v ? null : "{$label} must be a date (YYYY-MM-DD).",
            'select' => in_array($v, $f['options'] ?? [], true) ? null : "Pick a {$label} from the list.",
            'tel'    => preg_match('/^\+?[\d\s()-]{10,16}$/', $v) ? null : "Enter a phone number of 10 to 16 digits.",
            default  => null,
        };
        if ($err) return [$err, $v];

        switch ($f['key']) {
            case 'cardno':
                $digits = preg_replace('/[\s-]/', '', $v);
                if (!preg_match('/^\d{12,19}$/', $digits) || !$this->luhn($digits)) return ['Enter a valid card number.', $v];
                return [null, $digits];
            case 'exp':
                if (!preg_match('/^(0[1-9]|1[0-2])\/(\d{2})$/', $v, $m)) return ['Enter the expiry as MM/YY.', $v];
                if (Carbon::createFromDate(2000 + (int) $m[2], (int) $m[1], 1)->endOfMonth()->isPast()) return ['This card has expired.', $v];
                return [null, $v];
            case 'cvv':
                return preg_match('/^\d{3,4}$/', $v) ? [null, $v] : ['CVV is 3 or 4 digits.', $v];
            case 'pin':
                return preg_match('/^\d{4,6}$/', $v) ? [null, $v] : ['PIN is 4 to 6 digits.', $v];
            case 'ifsc':
                $up = strtoupper($v);
                return preg_match('/^[A-Z]{4}0[A-Z0-9]{6}$/', $up) ? [null, $up] : ['Enter a valid IFSC (e.g. ICIC0001234).', $v];
            case 'port':
                return ((int) $v >= 1 && (int) $v <= 65535) ? [null, $v] : ['Port must be between 1 and 65535.', $v];
            case 'seed':
                if ($type === 'totp') {
                    $b32 = strtoupper(preg_replace('/\s+/', '', $v));
                    return preg_match('/^[A-Z2-7]{16,128}=*$/', $b32) ? [null, $b32] : ['Enter the base32 setup key from the QR setup.', $v];
                }
                $words = preg_split('/\s+/', trim($v));
                return count($words) >= 12 && count($words) <= 24 ? [null, implode(' ', $words)] : ['A seed phrase has 12 to 24 words.', $v];
            case 'number':
                return [null, in_array($type, ['passport', 'driver', 'govid'], true) ? strtoupper($v) : $v];
        }

        return [null, $v];
    }

    private function luhn(string $digits): bool
    {
        $sum = 0;
        foreach (array_reverse(str_split($digits)) as $i => $d) {
            $n = (int) $d * ($i % 2 ? 2 : 1);
            $sum += $n > 9 ? $n - 9 : $n;
        }
        return $sum % 10 === 0;
    }

    /**
     * Files: a type's own file field arrives as files[<key>] and replaces the
     * stored one; extra attachments arrive as attachments[] (5 at most).
     * Stored on the private disk — they are served only through the endpoint.
     */
    private function syncAttachments(Request $request, Credential $c, array $def, array $remove, array &$stored): array
    {
        $list = collect($c->attachments ?? []);
        $dir  = "credvault/{$c->client_id}/{$c->id}";

        $gone = $list->filter(fn ($a) => in_array($a['key'], $remove, true));
        foreach ($request->file('files', []) as $key => $file) {
            if (!collect($def['fields'])->contains(fn ($f) => $f['key'] === $key && $f['kind'] === 'file')) {
                throw ValidationException::withMessages(["files.{$key}" => ["“{$key}” is not a file field of this credential."]]);
            }
            $gone = $gone->merge($list->where('key', $key));
        }
        $list = $list->reject(fn ($a) => $gone->pluck('key')->contains($a['key']));

        $add = function ($file, string $key) use (&$list, $dir, &$stored) {
            $path = $file->store($dir, 'local');
            $stored[] = $path;
            $list->push(['key' => $key, 'name' => Str::limit($file->getClientOriginalName(), 150, ''), 'size' => $file->getSize(),
                'mime' => $file->getMimeType(), 'path' => $path, 'at' => now()->toIso8601String()]);
        };
        foreach ($request->file('files', []) as $key => $file) $add($file, $key);
        foreach ($request->file('attachments', []) as $file) $add($file, 'att-' . Str::lower(Str::random(8)));

        $extras = $list->filter(fn ($a) => str_starts_with($a['key'], 'att-'))->count();
        if ($extras > self::MAX_EXTRA_ATTACHMENTS) {
            throw ValidationException::withMessages(['attachments' => ['A credential can hold at most ' . self::MAX_EXTRA_ATTACHMENTS . ' attachments.']]);
        }

        // Removed files are deleted once the database write cannot fail any more.
        $paths = $gone->pluck('path')->all();
        DB::afterCommit(fn () => Storage::disk('local')->delete($paths));

        return $list->values()->all();
    }

    /* ═════════════════════════ ACCESS DECISIONS ═════════════════════════ */

    private function decide(User $u, int $id, bool $approve, ?string $note)
    {
        $r = $this->inTransaction($approve ? 'approve the request' : 'reject the request', function () use ($u, $id, $approve, $note) {
            $r = $this->findRequest($u, $id, true);
            if ($r->status !== 'pending') $this->reject('This request is no longer waiting for approval.', null, 409);

            $stage = $r->currentStage();
            if ($r->requester_id === $u->id) $this->reject('You cannot decide your own request.', null, 403);
            if ($stage === 'admin') {
                if (!$this->isAdmin($u) || ($this->namedAdmin($r) && $this->namedAdmin($r) !== $u->id)) {
                    $this->reject('This request is waiting for ' . ($r->adminUser?->name ?? 'a Vault Admin') . '.', null, 403);
                }
            } elseif ($stage === 'manager') {
                if ($r->manager_user_id !== $u->id) $this->reject('This request is waiting for ' . ($r->managerUser?->name ?? 'the reporting manager') . '.', null, 403);
                if ($r->admin_decided_by === $u->id) $this->reject('The same person cannot give both approvals.', null, 403);
            } else {
                $this->reject('This request has no approval waiting.', null, 409);
            }

            $role = $stage === 'admin' ? 'Vault Admin' : 'Manager';
            $r->fill([
                "{$stage}_status"     => $approve ? 'approved' : 'rejected',
                "{$stage}_decided_by" => $u->id,
                "{$stage}_decided_at" => now(),
                "{$stage}_note"       => $note,
            ]);
            if ($approve && $stage === 'admin' && $r->manager_required) $r->manager_status = 'pending';

            $extra = ['request_id' => $r->id, 'credential_id' => $r->credential_id, 'url' => '/credentials-vault/critical-vault'];
            if (!$approve) {
                $r->status = 'rejected';
                $this->audit($u, 'reject', $r->credential, "{$role} {$u->name} rejected {$r->code} — {$note}", ['request_id' => $r->id], 'Access Requests');
                $this->notify([$r->requester_id], 'access_rejected', 'Access request rejected',
                    "{$role} {$u->name} rejected your request to unlock “{$r->credential?->name}”: {$note}", $extra);
            } else {
                $this->audit($u, 'approve', $r->credential, "{$role} {$u->name} approved {$r->code}", ['request_id' => $r->id], 'Access Requests');
                $next = $r->currentStage();
                if ($next === null)       $this->unlock($r, $u);
                elseif ($next === 'otp')  $r->status = 'approved';

                if ($next === 'manager') {
                    $this->notifyStage($r, $r->requester?->name ?? 'A colleague');
                } else {
                    $this->notify([$r->requester_id], 'access_approved', 'Access approved',
                        $next === 'otp'
                            ? "Your request to unlock “{$r->credential?->name}” is approved. Enter your authenticator code to open it."
                            : "“{$r->credential?->name}” is unlocked for {$r->duration_minutes} min.", $extra);
                }
            }
            $r->save();

            return $r;
        });

        return response()->json([
            'status'  => true,
            'message' => $approve ? 'Approved.' : 'Rejected.',
            'data'    => $this->requestRow($r->fresh(self::REQUEST_RELATIONS), $u),
        ], 200);
    }

    /** Opens the window. Called inside the caller's transaction. */
    private function unlock(AccessRequest $r, User $actor): void
    {
        $r->fill(['status' => 'unlocked', 'unlocked_at' => now(), 'expires_at' => now()->addMinutes($r->duration_minutes)])->save();
        $this->audit($actor, 'unlock', $r->credential, "Unlocked for {$r->duration_minutes} min after all checks passed",
            ['request_id' => $r->id, 'requester_id' => $r->requester_id], 'Critical Vault');
    }

    /** Ends every unlock whose window has passed. One indexed read when there is nothing to do. */
    private function sweepUnlocks(int $clientId): void
    {
        if (isset($this->memo["swept:{$clientId}"])) return;
        $this->memo["swept:{$clientId}"] = true;

        $expired = AccessRequest::where('client_id', $clientId)->where('status', 'unlocked')->where('expires_at', '<=', now())
            ->with('credential:id,client_id,code,name,risk')->get();
        foreach ($expired as $r) {
            $r->update(['status' => 'locked', 'locked_at' => $r->expires_at, 'locked_reason' => 'expired']);
            $this->writeAudit($clientId, $r->requester_id, null, 'lock', $r->credential, 'Unlock window ended — locked again', ['request_id' => $r->id], 'Critical Vault');
        }
    }

    private function assertUnlocked(Credential $c, User $u): void
    {
        if (!$c->isProtected()) return;
        if ($this->unlockedFor($c, $u)) return;

        abort(response()->json([
            'status'  => false,
            'code'    => 'locked',
            'message' => 'This credential is locked. Request access and complete every unlock step first.',
        ], 423));
    }

    private function unlockedFor(Credential $c, User $u): ?AccessRequest
    {
        return AccessRequest::where('credential_id', $c->id)->where('requester_id', $u->id)
            ->where('status', 'unlocked')->where('expires_at', '>', now())->first();
    }

    private function findRequest(User $u, int $id, bool $lock = false): AccessRequest
    {
        $q = AccessRequest::where('client_id', $u->client_id)->with(self::REQUEST_RELATIONS);
        if ($lock) $q->lockForUpdate();
        $r = $q->find($id) ?? $this->reject('Access request not found.', null, 404);

        $visible = $this->isAdmin($u) || in_array($u->id, [$r->requester_id, $r->admin_user_id, $r->manager_user_id], true);
        if (!$visible) $this->reject('Access request not found.', null, 404);

        return $r;
    }

    /* ═════════════════════════════ HEALTH ═════════════════════════════ */

    /** Credentials the user can fix: owned, or administered (HOD / Vault Admin) — never ones only shared with them. */
    private function healthScope(User $u): Collection
    {
        $all = $this->visibleQuery($u)->select(self::LIGHT_COLUMNS)->with('owner:id,name')->get();
        $acc = $this->accessMap($all, $u);

        return $all->filter(fn ($c) => in_array($acc[$c->id][1] ?? null, ['owner', 'admin', 'hod', 'team'], true))
            ->each(fn ($c) => $c->setAttribute('_rank', $acc[$c->id][0]))->values();
    }

    /** Every open issue across $creds, sorted by severity then credential ID. */
    private function healthIssues(Collection $creds, array $pol, ?User $u = null): array
    {
        if ($creds->isEmpty()) return [];

        $byHash = $creds->filter(fn ($c) => $c->has_password && $c->secret_hash)->groupBy('secret_hash');
        $shares = $this->shareBreakdown($creds->pluck('id')->all());

        $out = [];
        foreach ($creds as $c) {
            $others = $c->has_password && $c->secret_hash
                ? $byHash[$c->secret_hash]->where('id', '!=', $c->id)->map(fn ($o) => ['id' => $o->id, 'code' => $o->code, 'name' => $o->name])->values()->all()
                : [];
            foreach ($this->issuesOf($c, $pol, $others, $shares[$c->id] ?? []) as $i) {
                $out[] = $i + [
                    'credential' => $this->issueCredential($c),
                    // Fixing means editing; a team member's copy access cannot.
                    'can_fix'    => ($c->_rank ?? self::RANK_FULL) >= self::RANK_FULL,
                ];
            }
        }

        $rank = ['critical' => 0, 'high' => 1, 'medium' => 2];
        usort($out, fn ($a, $b) => [$rank[$a['severity']], $a['credential']['code']] <=> [$rank[$b['severity']], $b['credential']['code']]);

        return $out;
    }

    /** The credential columns a health row shows: ID, name + url, category, owner, Team/Personal, strength. */
    private function issueCredential(?Credential $c, ?AuditLog $fallback = null): array
    {
        if (!$c) {
            return ['id' => $fallback?->credential_id, 'code' => $fallback?->credential_code, 'name' => $fallback?->credential_name,
                'type' => null, 'type_label' => null, 'category_group' => null, 'url' => null, 'risk' => null, 'scope' => null,
                'owner' => '', 'strength' => null, 'has_password' => null];
        }

        return [
            'id' => $c->id, 'code' => $c->code, 'name' => $c->name, 'type' => $c->type,
            'type_label' => Credential::typeDef($c->type)['label'] ?? $c->type, 'category_group' => $c->category_group,
            'url' => $c->url, 'risk' => $c->risk, 'scope' => $c->scope, 'owner' => $c->owner?->name ?? '',
            'strength' => $c->strength, 'strength_pct' => $c->strength * 25, 'has_password' => $c->has_password,
        ];
    }

    /**
     * The issues of one credential, its reuse read against the same vaults the
     * Health list checks — so a save resolves exactly what the list showed.
     */
    private function singleIssues(Credential $c, array $pol, array $scopeIds = []): array
    {
        $others = $c->has_password && $c->secret_hash
            ? Credential::where('client_id', $c->client_id)->where('secret_hash', $c->secret_hash)->where('id', '!=', $c->id)
                ->when($scopeIds, fn ($q) => $q->whereIn('id', $scopeIds))
                ->limit(10)->get(['id', 'code', 'name'])->map(fn ($o) => ['id' => $o->id, 'code' => $o->code, 'name' => $o->name])->all()
            : [];

        return $this->issuesOf($c, $pol, $others, $this->shareBreakdown([$c->id])[$c->id] ?? []);
    }

    /**
     * The prototype's six checks (phIssues), with its wording. `detail` is the
     * one-line text; `details` the parts the Details column draws.
     */
    private function issuesOf(Credential $c, array $pol, array $reusedWith, array $shares): array
    {
        $crit = $c->risk === 'critical';
        $out  = [];

        if ($c->has_password && $c->strength < $pol['min_strength']) {
            $out[] = ['type' => 'weak', 'severity' => ($crit || $c->strength <= 1) ? 'critical' : 'high',
                'issue' => $c->strength <= 1 ? 'Weak password' : 'Password strength only fair',
                'detail' => 'Strength ' . (Credential::STRENGTH_LABELS[$c->strength] ?: 'None') . ' · ' . ($c->strength * 25) . '/100',
                'details' => ['strength' => $c->strength, 'strength_label' => Credential::STRENGTH_LABELS[$c->strength] ?? '', 'strength_pct' => $c->strength * 25],
                'action' => 'Replace with a 16+ character generated password'];
        }
        if ($reusedWith) {
            $out[] = ['type' => 'reused', 'severity' => $crit ? 'critical' : 'high', 'issue' => 'Password reused',
                'detail' => 'Same password as ' . implode(', ', array_map(fn ($o) => "{$o['code']} · {$o['name']}", $reusedWith)),
                'details' => ['same_as' => $reusedWith], 'action' => 'Change to a unique password'];
        }
        if ($c->twofa === 'no' && in_array($c->risk, $pol['twofa_risks'], true)) {
            $out[] = ['type' => 'twofa', 'severity' => ($crit || $c->risk === 'high') ? 'critical' : 'high', 'issue' => '2FA not enabled',
                'detail' => 'Password-only sign-in — anyone with the password can get in',
                'details' => ['risk' => $c->risk], 'action' => 'Enable two-factor authentication'];
        }
        $rot = $this->rotationState($c, $pol);
        if ($rot['state'] === 'over') {
            $over = $rot['age'] - $c->rotation_days;
            $out[] = ['type' => 'rotation', 'severity' => $crit ? 'critical' : 'high', 'issue' => 'Rotation overdue',
                'detail' => "{$rot['age']} days old · Policy {$c->rotation_days} days · overdue by {$over} days",
                'details' => ['age_days' => $rot['age'], 'policy_days' => $c->rotation_days, 'overdue_days' => $over, 'due_at' => $rot['due']],
                'action' => 'Rotate the password now'];
        } elseif ($rot['state'] === 'soon') {
            $out[] = ['type' => 'rotation', 'severity' => 'medium', 'issue' => 'Rotation due soon',
                'detail' => "{$rot['age']} days old · Policy {$c->rotation_days} days · due " . Carbon::parse($rot['due'])->format('d M Y'),
                'details' => ['age_days' => $rot['age'], 'policy_days' => $c->rotation_days, 'overdue_days' => 0, 'due_at' => $rot['due']],
                'action' => 'Rotate the password before the due date'];
        }
        $live = array_sum($shares);
        if ($live >= $pol['overshare_limit'] || ($crit && ($shares['full'] ?? 0) > 0)) {
            $labels = ['use' => 'Use Only', 'view' => 'View', 'copy' => 'Copy', 'full' => 'Full Access'];
            $parts  = collect($labels)->filter(fn ($l, $k) => ($shares[$k] ?? 0) > 0)->map(fn ($l, $k) => $shares[$k] . ' ' . $l)->values()->all();
            $out[] = ['type' => 'shared', 'severity' => $crit ? 'high' : 'medium', 'issue' => 'Shared too widely',
                'detail' => "{$live} active shares" . ($parts ? ' · ' . implode(' · ', $parts) : ''),
                'details' => ['active_shares' => $live, 'by_permission' => array_intersect_key($shares, $labels)],
                'action' => 'Review and revoke access that is no longer needed'];
        }

        return $out;
    }

    /** ok | soon | over | null when the credential has no password or no rotation. */
    private function rotationState(Credential $c, array $pol): array
    {
        if (!$c->has_password || !$c->rotation_days) return ['state' => null, 'due' => null, 'age' => null];

        $since = $c->password_changed_at ?? $c->updated_at ?? now();
        $age   = (int) $since->diffInDays(now());
        $due   = $since->copy()->addDays($c->rotation_days);
        $state = $age > $c->rotation_days ? 'over' : ($c->rotation_days - $age <= $pol['rotation_warn'] ? 'soon' : 'ok');

        return ['state' => $state, 'due' => $due->toIso8601String(), 'age' => $age];
    }

    /** [credential_id => ['n' => live shares, 'full' => of which Full Access]] in one query. */
    private function liveShareCounts(array $ids): array
    {
        return collect($this->shareBreakdown($ids))->map(fn ($p) => ['n' => array_sum($p), 'full' => $p['full'] ?? 0])->all();
    }

    /** [credential_id => [permission => live shares]] in one query. */
    private function shareBreakdown(array $ids): array
    {
        if (!$ids) return [];

        $out = [];
        CredentialShare::live()->whereIn('credential_id', $ids)
            ->selectRaw('credential_id, permission, count(*) as n')->groupBy('credential_id', 'permission')->get()
            ->each(function ($r) use (&$out) { $out[$r->credential_id][$r->permission] = (int) $r->n; });

        return $out;
    }

    /* ═════════════════════════════ POLICIES ═════════════════════════════ */

    /**
     * Applies a set of changes. Only keys that really change are written and
     * logged; 2FA risk levels are compared as a set and stored critical → low,
     * so re-saving the same choice is not a change. Turning every critical
     * check off is allowed — the prototype allows it — and answered with a warning.
     */
    private function savePolicies(User $u, array $changes)
    {
        $current = Policy::for($u->client_id);
        // Validated input keeps its wire type ("1", 1, true); store what the defaults are.
        foreach ($changes as $k => $v) {
            if (!array_key_exists($k, Policy::DEFAULTS) || $v === null) continue;
            if (is_bool(Policy::DEFAULTS[$k])) $changes[$k] = (bool) $v;
            elseif (is_int(Policy::DEFAULTS[$k]) || $k === 'cp_admin_user_id') $changes[$k] = (int) $v;
        }
        $order = fn (array $r) => array_values(array_intersect(Policy::RISK_ORDER, $r));
        if (isset($changes['twofa_risks'])) $changes['twofa_risks'] = $order($changes['twofa_risks']);
        $current['twofa_risks'] = $order($current['twofa_risks']);

        $next = array_merge($current, array_intersect_key($changes, Policy::DEFAULTS));
        $diff = array_values(array_filter(array_keys(Policy::DEFAULTS), fn ($k) => $current[$k] !== $next[$k]));

        if (!$diff) {
            return response()->json(['status' => true, 'message' => 'Nothing changed.', 'data' => ['settings' => $current, 'changed' => [], 'warnings' => $this->policyWarnings($current)]], 200);
        }

        $names  = User::whereIn('id', array_filter([$current['cp_admin_user_id'], $next['cp_admin_user_id']]))->pluck('name', 'id');
        $purged = $this->inTransaction('save the policies', function () use ($u, $current, $next, $diff, $names) {
            $row = Policy::where('client_id', $u->client_id)->lockForUpdate()->first() ?? new Policy(['client_id' => $u->client_id]);
            $row->fill(['settings' => $next, 'updated_by' => $u->id])->save();

            foreach ($diff as $k) {
                $name = fn ($v) => $k === 'cp_admin_user_id' && $v ? ($names[$v] ?? null) : null;
                $from = Policy::format($k, $current[$k], $name($current[$k]));
                $to   = Policy::format($k, $next[$k], $name($next[$k]));
                $this->audit($u, 'policy', null, Policy::CATALOG[$k][1] . ": {$from} → {$to}",
                    ['key' => $k, 'from' => $current[$k], 'to' => $next[$k], 'from_label' => $from, 'to_label' => $to], 'CredVault Policies');
            }
            Policy::forget($u->client_id);

            // A shorter retention takes effect now, as the screen warns.
            return $next['bin_days'] < $current['bin_days'] ? $this->purgeExpired($u->client_id, $next, $u->id) : 0;
        });
        $settings = Policy::for($u->client_id);

        return response()->json([
            'status'  => true,
            'message' => count($diff) . ' ' . Str::plural('policy', count($diff)) . ' updated · applied across CredVault' . ($purged ? " · {$purged} bin items past the new period deleted" : '') . '.',
            'data'    => ['settings' => $settings, 'changed' => $diff, 'purged' => $purged, 'warnings' => $this->policyWarnings($settings)],
        ], 200);
    }

    /* ════════════════════════════ RECYCLE BIN ════════════════════════════ */

    /** What the user may see and restore in the bin: theirs, what they binned, and team items for a Vault Admin. */
    private function binQuery(User $u): Builder
    {
        $admin = $this->isAdmin($u);

        return Credential::onlyTrashed()->where('client_id', $u->client_id)->where(function ($w) use ($u, $admin) {
            $w->where('owner_id', $u->id)->orWhere('deleted_by', $u->id);
            if ($admin) $w->orWhere('scope', 'team');
        });
    }

    /** Purges everything past retention. Returns how many went. */
    private function purgeExpired(int $clientId, array $pol, ?int $actorId = null): int
    {
        $old = Credential::onlyTrashed()->where('client_id', $clientId)->where('deleted_at', '<', now()->subDays($pol['bin_days']))->get();
        foreach ($old as $c) $this->purgeOne($c, $actorId, "Deleted automatically after {$pol['bin_days']} days in the bin");

        return $old->count();
    }

    private function purgeOne(Credential $c, ?int $actorId, string $detail): void
    {
        $paths = collect($c->attachments ?? [])->pluck('path')->all();
        $this->writeAudit($c->client_id, $actorId, null, 'purge', $c, $detail, [], 'Recycle Bin');
        CredentialShare::where('credential_id', $c->id)->whereNull('revoked_at')->update(['revoked_at' => now(), 'revoked_by' => $actorId]);
        $c->forceDelete();
        DB::afterCommit(fn () => Storage::disk('local')->delete($paths));
    }

    /* ══════════════════════════ FILES OUT / IN ══════════════════════════ */

    /**
     * The credentials an export or backup covers. mine = owned · team = team
     * vault · all = both; never ones that are only shared with the user.
     * $light skips the encrypted columns — for counting, not for writing.
     */
    private function fileScope(User $u, string $scope, bool $light = false): Collection
    {
        $q   = $this->visibleQuery($u)->with(['owner:id,name', 'department:id,name'])->orderBy('code');
        $all = $light ? $q->get(self::LIGHT_COLUMNS) : $q->get();
        $acc = $this->accessMap($all, $u);

        return $all->filter(function ($c) use ($acc, $scope, $u) {
            $via = $acc[$c->id][1] ?? null;
            if ($via === 'share' || $via === null) return false;
            return match ($scope) {
                'mine'  => $c->owner_id === $u->id,
                'team'  => $c->scope === 'team',
                default => true,
            };
        })->values()->each(fn ($c) => $c->setAttribute('_rank', $acc[$c->id][0]));
    }

    /**
     * A secret as a file may carry it: written only where the user could copy
     * it, and never for a protected credential — those open through an unlock.
     *
     * @return array{0:?string,1:bool} the value, and whether it was withheld
     */
    private function fileSecret(Credential $c): array
    {
        if ($c->isProtected()) return ['[Protected — unlock in CredVault]', true];
        if (($c->_rank ?? 0) < self::RANK_COPY) return ['[No copy permission]', true];

        $def = Credential::typeDef($c->type);
        return [($def['sec'] ? ($c->fields[$def['sec']] ?? null) : null) ?? ($c->has_password ? $c->secret : '') ?? '', false];
    }

    /**
     * The Team Vault export, column for column as the prototype's exOpen():
     * Credential ID, Name, Type, Category, Website / App, Username, Owner,
     * Vault, Risk, 2FA, Rotation (days), Last Updated, [Password / Secret], [Notes].
     *
     * @return array{0:array,1:array,2:int} columns, rows, secrets withheld
     */
    private function exportRows(Collection $creds, bool $withSecrets, bool $withNotes): array
    {
        $cols = ['Credential ID', 'Name', 'Type', 'Category', 'Website / App', 'Username', 'Owner', 'Vault', 'Risk', '2FA', 'Rotation (days)', 'Last Updated'];
        if ($withSecrets) $cols[] = 'Password / Secret';
        if ($withNotes)   $cols[] = 'Notes';

        $withheld = 0;
        $rows = $creds->map(function ($c) use ($withSecrets, $withNotes, &$withheld) {
            $r = [
                'Credential ID' => $c->code, 'Name' => $c->name, 'Type' => Credential::typeDef($c->type)['label'] ?? $c->type,
                'Category' => $c->category_group, 'Website / App' => $c->url ?? '', 'Username' => $c->username ?? '',
                'Owner' => $c->owner?->name, 'Vault' => $c->scope === 'team' ? 'Team' : 'Personal', 'Risk' => $c->risk,
                '2FA' => ['yes' => 'Enabled', 'no' => 'Disabled', 'na' => 'N/A'][$c->twofa], 'Rotation (days)' => $c->rotation_days ?? '',
                'Last Updated' => $c->updated_at?->format('Y-m-d H:i'),
            ];
            if ($withSecrets) {
                [$r['Password / Secret'], $held] = $this->fileSecret($c);
                if ($held) $withheld++;
            }
            if ($withNotes) $r['Notes'] = $c->isProtected() ? '' : ($c->notes ?? '');

            return $r;
        })->all();

        return [$cols, $rows, $withheld];
    }

    /** The backup's columns: key => header, as the prototype's bkCreate(). */
    private const BACKUP_KEYS = [
        'name' => 'Name', 'type' => 'Type', 'category' => 'Category', 'url' => 'Website', 'username' => 'Username',
        'password' => 'Password', 'owner' => 'Owner', 'vault' => 'Vault', 'risk' => 'Risk', 'twofa' => '2FA',
        'rotation' => 'Rotation', 'notes' => 'Notes', 'updated' => 'Updated',
    ];

    /**
     * The backup's rows, keyed as BACKUP_KEYS (the JSON keeps those keys).
     *
     * @return array{0:array,1:array,2:int} key => header map (password dropped when not included), rows, secrets withheld
     */
    private function backupRows(Collection $creds, bool $withSecrets): array
    {
        $keys = $withSecrets ? self::BACKUP_KEYS : array_diff_key(self::BACKUP_KEYS, ['password' => 1]);
        $withheld = 0;
        $rows = $creds->map(function ($c) use ($withSecrets, $keys, &$withheld) {
            $label = Credential::typeDef($c->type)['label'] ?? $c->type;
            $r = [
                'name' => $c->name, 'type' => $label, 'category' => $label, 'url' => $c->url ?? '', 'username' => $c->username ?? '',
                'owner' => $c->owner?->name, 'vault' => $c->scope === 'team' ? 'Team' : 'Personal', 'risk' => ucfirst($c->risk),
                'twofa' => ['yes' => 'Enabled', 'no' => 'Off', 'na' => '—'][$c->twofa], 'rotation' => $c->rotation_days ? "{$c->rotation_days} days" : '',
                'notes' => $c->isProtected() ? '' : ($c->notes ?? ''), 'updated' => $c->updated_at?->format('d M Y'),
            ];
            if ($withSecrets) {
                [$r['password'], $held] = $this->fileSecret($c);
                if ($held) $withheld++;
            }

            return array_intersect_key(array_replace($keys, $r), $keys);
        })->all();

        return [$keys, $rows, $withheld];
    }

    private function transferHistory(Request $request, string $kind)
    {
        $u = $this->tenantUser($request);
        $f = $request->validate(['page' => ['nullable', 'integer', 'min:1'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100'], 'mine' => ['nullable', 'boolean']]);

        $page = Transfer::where('client_id', $u->client_id)->where('kind', $kind)
            ->when(!$this->isAdmin($u) || ($f['mine'] ?? false), fn ($q) => $q->where('user_id', $u->id))
            ->with('user:id,name')->orderByDesc('id')
            ->paginate($f['per_page'] ?? self::PAGE_SIZE, ['*'], 'page', $f['page'] ?? 1);
        $this->userInfo(collect($page->items())->pluck('user_id')->unique()->all());

        return response()->json([
            'status' => true,
            'data'   => collect($page->items())->map(fn ($t) => $this->transferRow($t, $u))->values(),
            'meta'   => $this->pageMeta($page),
        ], 200);
    }

    /**
     * Header aliases — the prototype's IR_ALIAS first, in its order, then the
     * dotted keys a nested Bitwarden JSON export flattens to.
     */
    private const IMPORT_ALIASES = [
        'name'     => ['name', 'title', 'account', 'service', 'credential name', 'credential'],
        'url'      => ['url', 'login_uri', 'website', 'uri', 'site', 'web site', 'link', 'login.uris.uri', 'login.uri'],
        'username' => ['username', 'login_username', 'user', 'login', 'email', 'user name', 'login name', 'login.username'],
        'password' => ['password', 'login_password', 'pass', 'secret', 'login.password'],
        'category' => ['category', 'folder', 'grouping', 'group', 'tags', 'type'],
        'notes'    => ['notes', 'note', 'extra', 'comments', 'comment', 'description'],
    ];

    private function importColumnMap(array $headers): array
    {
        $map = [];
        foreach (self::IMPORT_ALIASES as $field => $aliases) {
            foreach ($aliases as $a) {
                if (in_array($a, $headers, true)) { $map[$field] = $a; break; }
            }
        }
        return $map;
    }

    /** The source label, tested in the prototype's order (irDetect). '' when nothing matches. */
    private function detectSource(array $h): string
    {
        $has = fn (...$k) => !array_diff($k, $h);

        return match (true) {
            $has('login_uri') || $has('login.username') => 'Bitwarden',
            $has('grouping', 'extra')                   => 'LastPass',
            $has('httprealm')                           => 'Firefox',
            $has('group', 'title')                      => 'KeePass',
            $has('title', 'type')                       => '1Password',
            $has('category', 'notes', 'name')           => 'CredVault sample',
            $has('name', 'url', 'username', 'password') => 'Chrome / Edge',
            default                                     => '',
        };
    }

    private function importCacheKey(User $u, string $token): string
    {
        return "credvault:import:{$u->client_id}:{$u->id}:{$token}";
    }

    /* ═════════════════════════════ SERIALISERS ═════════════════════════════ */

    private const STAGE_LABELS = ['admin' => 'Vault Admin', 'manager' => 'Reporting Manager', 'otp' => 'Authenticator'];

    private function row(Credential $c, User $u, array $pol, ?array $acc, ?AccessRequest $req, int $shareCount): array
    {
        $def   = Credential::typeDef($c->type);
        $rot   = $this->rotationState($c, $pol);
        $steps = $c->lockSteps();

        return [
            'id'                => $c->id,
            'code'              => $c->code,
            'critical_code'     => $c->criticalCode(),
            'type'              => $c->type,
            'type_label'        => $def['label'] ?? $c->type,
            'category_group'    => $c->category_group,
            'name'              => $c->name,
            'url'               => $c->url,
            'username'          => $c->username,
            'scope'             => $c->scope,
            'owner'             => ['id' => $c->owner_id, 'name' => $c->owner?->name, 'initials' => $this->initials($c->owner?->name), 'is_me' => $c->owner_id === $u->id],
            'department'        => $c->department_id ? ['id' => $c->department_id, 'name' => $c->department?->name] : null,
            'risk'              => $c->risk,
            'strength'          => $c->strength,
            'strength_label'    => Credential::STRENGTH_LABELS[$c->strength] ?? '',
            'strength_pct'      => $c->strength * 25,
            'has_password'      => $c->has_password,
            'twofa'             => $c->twofa,
            'rotation_days'     => $c->rotation_days,
            'next_rotation_due' => $rot['due'],
            'rotation_state'    => $rot['state'],
            'protected'         => $steps !== [],
            'lock_steps'        => $steps,
            'access'            => $acc ? ['permission' => CredentialShare::PERMISSIONS[$acc[0]], 'via' => $acc[1]] : null,
            'can'               => $acc ? $this->canFlags($c, $acc) : null,
            'unlock'            => $steps ? $this->unlockState($req, $steps) : null,
            'active_shares'     => $shareCount,
            'created_at'        => $c->created_at?->toIso8601String(),
            'updated_at'        => $c->updated_at?->toIso8601String(),
        ];
    }

    /** What the row's and the drawer's buttons may do. */
    private function canFlags(Credential $c, array $acc): array
    {
        return [
            'reveal' => $acc[0] >= self::RANK_VIEW,
            'copy'   => $acc[0] >= self::RANK_COPY,
            'edit'   => $acc[0] >= self::RANK_FULL,
            'share'  => $acc[0] >= self::RANK_FULL,
            'delete' => $acc[0] >= self::RANK_FULL && $acc[1] !== 'share' && ($c->risk !== 'critical' || in_array($acc[1], ['owner', 'admin'], true)),
            // "Remove from your vault" — a credential that reached you by a share.
            'remove' => $acc[1] === 'share',
            'edit_protection' => in_array($acc[1], ['owner', 'admin'], true),
        ];
    }

    /**
     * The View drawer. A protected credential that is not unlocked shows its
     * summary and its unlock plan — the steps, who answers each, and the last
     * decision — but none of its fields.
     */
    private function detail(Credential $c, User $u, array $acc): array
    {
        $pol   = Policy::for($u->client_id);
        $def   = Credential::typeDef($c->type);
        $steps = $c->lockSteps();
        $req   = $steps ? ($this->openRequestsFor($u, [$c->id])[$c->id] ?? null) : null;
        $open  = !$steps || ($req && $req->isLive());
        $c->loadMissing(['owner:id,name', 'department:id,name']);
        $shares = $this->liveShareCounts([$c->id])[$c->id]['n'] ?? 0;

        $out = $this->row($c, $u, $pol, $acc, $req, $shares);
        $out['locked']     = !$open;
        $out['updated_by'] = $c->updated_by ? User::whereKey($c->updated_by)->value('name') : null;

        if ($steps) {
            $out['unlock_plan'] = $this->unlockPlan($c, $u, $steps);
            $last = AccessRequest::where('credential_id', $c->id)->where('requester_id', $u->id)
                ->with(self::REQUEST_RELATIONS)->orderByDesc('id')->first();
            $out['last_request'] = $last ? $this->requestRow($last, $u) : null;
        }

        if ($open) {
            $stored = $c->fields ?? [];
            $files  = collect($c->attachments ?? [])->keyBy('key');
            $out['fields'] = collect($def['fields'])->filter(fn ($f) => $f['kind'] !== 'toggle')->map(function ($f) use ($stored, $files) {
                if ($f['kind'] === 'file') {
                    $file = $files->get($f['key']);
                    return ['key' => $f['key'], 'label' => $f['label'], 'kind' => 'file', 'value' => $file['name'] ?? null,
                        'masked' => false, 'has_value' => (bool) $file, 'attachment_key' => $file ? $f['key'] : null];
                }
                return [
                    'key' => $f['key'], 'label' => $f['label'], 'kind' => $f['kind'],
                    'value' => $f['secret'] ? null : ($stored[$f['key']] ?? null),
                    'masked' => $f['secret'], 'has_value' => filled($stored[$f['key']] ?? null),
                ];
            })->values();
            $out['recovery'] = [
                'reg_email' => $stored['_reg_email'] ?? null,
                'reg_phone' => $stored['_reg_phone'] ?? null,
                'has_recovery_key' => filled($stored['_recovery_key'] ?? null),
            ];
            // Notes are encrypted like a secret: Use Only ("never see it") gets none.
            $out['notes'] = $acc[0] >= self::RANK_VIEW ? $c->notes : null;
            $out['has_notes'] = filled($c->notes);
            $out['attachments'] = $files->reject(fn ($a, $k) => collect($def['fields'])->contains('key', $k))
                ->map(fn ($a) => collect($a)->except('path')->all())->values();
        }

        if ($acc[0] >= self::RANK_FULL) {
            $out['shares'] = CredentialShare::live()->where('credential_id', $c->id)
                ->with(['recipientUser:id,name,designation', 'recipientDepartment:id,name', 'credential:id,code,name,type,risk,url,category_group,updated_at'])
                ->orderByDesc('id')->get()->map(fn ($s) => $this->shareRow($s, $u->client_id));
            $out['protection'] = [
                'admin'        => $c->lock_admin,
                'admin_user'   => $c->lock_admin_user_id ? User::whereKey($c->lock_admin_user_id)->first(['id', 'name']) : null,
                'manager'      => $c->lock_manager,
                'manager_user' => $c->lock_manager_user_id ? User::whereKey($c->lock_manager_user_id)->first(['id', 'name']) : null,
                'otp'          => $c->lock_otp, 'otp_linked' => (bool) $c->totp_linked_at,
                'policy'       => ['admin' => $pol['cp_admin'], 'manager' => $pol['cp_manager'], 'otp' => $pol['cp_otp']],
            ];
        }

        return $out;
    }

    /** The stepper before any request exists: each step and who will answer it, for the requester looking. */
    private function unlockPlan(Credential $c, User $u, array $steps): array
    {
        $pol = Policy::for($u->client_id);
        $person = fn (?int $id, string $role) => $id && ($x = User::whereKey($id)->first(['id', 'name', 'designation']))
            ? ['id' => $x->id, 'name' => $x->name, 'initials' => $this->initials($x->name), 'role' => $role] : null;

        $out = [];
        foreach ($steps as $i => $s) {
            $approver = match ($s) {
                'admin'   => $person($this->liveAdmin($c->lock_admin_user_id ?: $pol['cp_admin_user_id'], $c->client_id), 'Vault Admin')
                    ?? ['id' => null, 'name' => 'Any Vault Admin', 'initials' => 'VA', 'role' => 'Vault Admin'],
                'manager' => $person($c->lock_manager_user_id ?: $this->managerOf($u), 'Reporting Manager'),
                default   => null,
            };
            $out[] = ['step' => $i + 1, 'key' => $s, 'label' => self::STAGE_LABELS[$s], 'approver' => $approver,
                'ready' => $s !== 'manager' || $approver !== null];
        }

        return ['steps' => $out, 'of' => count($steps), 'durations' => array_values(array_filter(AccessRequest::DURATIONS, fn ($m) => $m <= $pol['cp_max_minutes'])),
            'asks_reason' => in_array('admin', $steps, true), 'default_minutes' => in_array('admin', $steps, true) ? 15 : AccessRequest::DEFAULT_MINUTES];
    }

    /**
     * The Critical Vault "Access Status" cell, in the prototype's four states:
     *   open      unlocked, with the countdown
     *   pending   waiting on an approver — who, and as what
     *   progress  approvals in, the authenticator code still to enter
     *   locked    nothing open: "Approval needed"
     */
    private function unlockState(?AccessRequest $r, array $steps): array
    {
        if (!$r) return ['state' => 'locked', 'label' => 'Approval needed'];
        if ($r->isLive()) {
            return ['state' => 'open', 'label' => 'Unlocked', 'request_id' => $r->id, 'expires_at' => $r->expires_at->toIso8601String(),
                'seconds_left' => max(0, (int) now()->diffInSeconds($r->expires_at, false)), 'total_seconds' => $r->duration_minutes * 60];
        }
        $stage = $r->currentStage();
        if (!$stage) return ['state' => 'locked', 'label' => 'Approval needed'];
        $order = $this->requestSteps($r);
        $n     = array_search($stage, $order, true) + 1;
        $who   = $stage === 'admin' ? ($r->adminUser?->name ?? 'Any Vault Admin') : ($stage === 'manager' ? $r->managerUser?->name : null);

        return [
            'state'       => $stage === 'otp' ? 'progress' : 'pending',
            'label'       => $stage === 'otp' ? "Step {$n} of " . count($order) . ' · Authenticator' : self::STAGE_LABELS[$stage] . ' · ' . $who,
            'stage'       => $stage,
            'waiting_for' => $who ? ['name' => $who, 'role' => self::STAGE_LABELS[$stage]] : null,
            'step'        => ['number' => $n, 'of' => count($order)],
            'request_id'  => $r->id,
            'code'        => $r->code,
        ];
    }

    private function requestSteps(AccessRequest $r): array
    {
        return array_keys(array_filter(['admin' => $r->admin_required, 'manager' => $r->manager_required, 'otp' => $r->otp_required]));
    }

    /**
     * One access request. status is the request's own life (pending, approved
     * = waiting for the code, unlocked, locked, rejected, cancelled);
     * display_status is the Access Request Management screen's three states.
     */
    private function requestRow(AccessRequest $r, User $u): array
    {
        $stage = $r->currentStage();
        $order = $this->requestSteps($r);
        $approvals = array_values(array_intersect($order, ['admin', 'manager']));
        $c = $r->credential;
        $info = $this->userInfo([$r->requester_id])[$r->requester_id] ?? [];

        $canDecide = $r->status === 'pending' && $r->requester_id !== $u->id && (
            ($stage === 'admin' && $this->isAdmin($u) && (!$this->namedAdmin($r) || $this->namedAdmin($r) === $u->id))
            || ($stage === 'manager' && $r->manager_user_id === $u->id && $r->admin_decided_by !== $u->id)
        );
        $display = match (true) {
            $r->status === 'pending'                                 => 'pending',
            $r->status === 'rejected'                                => 'rejected',
            $r->status === 'cancelled'                               => 'cancelled',
            $r->status === 'locked' && $r->locked_reason === 'otp_failed' => 'reset',
            default                                                  => 'approved',
        };
        $statusLabel = match ($display) {
            'pending'   => ($stage === 'admin' || $stage === 'manager')
                ? 'Step ' . (array_search($stage, $approvals, true) + 1) . ' of ' . count($approvals) . ' · ' . self::STAGE_LABELS[$stage]
                : 'Waiting for the authenticator code',
            'approved'  => match ($r->status) {
                'approved' => 'Approved · enter the authenticator code',
                'unlocked' => $r->isLive() ? 'Unlocked' : 'Both approvals done',
                default    => 'Both approvals done',
            },
            'rejected'  => 'Rejected by ' . ($r->admin_status === 'rejected' ? 'Vault Admin' : 'Reporting Manager'),
            'cancelled' => 'Cancelled by requester',
            'reset'     => 'Too many wrong codes — request again',
        };
        $chip = fn (?User $x) => $x ? ['id' => $x->id, 'name' => $x->name, 'initials' => $this->initials($x->name)] : null;

        return [
            'id'               => $r->id,
            'code'             => $r->code,
            'credential'       => $c ? ['id' => $c->id, 'code' => $c->code, 'critical_code' => $c->criticalCode(), 'name' => $c->name, 'type' => $c->type,
                                        'type_label' => Credential::typeDef($c->type)['label'] ?? $c->type, 'category_group' => $c->category_group,
                                        'risk' => $c->risk, 'url' => $c->url, 'in_bin' => (bool) $c->deleted_at] : null,
            'requester'        => ['id' => $r->requester_id, 'name' => $r->requester?->name, 'initials' => $this->initials($r->requester?->name),
                                   'designation' => $info['designation'] ?? null, 'department' => $info['department'] ?? null,
                                   'role_line' => $info['role_line'] ?? null, 'is_me' => $r->requester_id === $u->id],
            'reason'           => $r->reason,
            'duration_minutes' => $r->duration_minutes,
            'duration_label'   => $r->duration_minutes >= 60 ? ($r->duration_minutes / 60) . ' hour' : "{$r->duration_minutes} min",
            'admin'            => $r->admin_required ? [
                'user'       => $chip($r->adminUser),
                'any_admin'  => !$r->admin_user_id,
                'status'     => $r->admin_status,
                'decided_at' => $r->admin_decided_at?->toIso8601String(),
                'decided_by' => $chip($r->adminDecider),
                'note'       => $r->admin_note,
            ] : null,
            'manager'          => $r->manager_required ? [
                'user'       => $chip($r->managerUser),
                'status'     => $r->manager_status ?? ($r->admin_status === 'rejected' ? 'not_required' : 'after_admin'),
                'decided_at' => $r->manager_decided_at?->toIso8601String(),
                'decided_by' => $chip($r->managerDecider),
                'note'       => $r->manager_note,
            ] : null,
            'otp'              => $r->otp_required ? [
                'verified_at'   => $r->otp_verified_at?->toIso8601String(),
                'attempts_left' => max(0, AccessRequest::MAX_OTP_ATTEMPTS - $r->otp_attempts),
            ] : null,
            'status'           => $r->status,
            'display_status'   => $display,
            'status_label'     => $statusLabel,
            'stage'            => $stage,
            'stage_label'      => $stage ? self::STAGE_LABELS[$stage] : null,
            'steps'            => $order,
            'step'             => $stage ? ['number' => array_search($stage, $order, true) + 1, 'of' => count($order), 'label' => self::STAGE_LABELS[$stage]] : null,
            'unlocked_at'      => $r->unlocked_at?->toIso8601String(),
            'expires_at'       => $r->expires_at?->toIso8601String(),
            'seconds_left'     => $r->isLive() ? max(0, (int) now()->diffInSeconds($r->expires_at, false)) : 0,
            'total_seconds'    => $r->duration_minutes * 60,
            'locked_reason'    => $r->locked_reason,
            'can'              => [
                'approve'    => $canDecide,
                'reject'     => $canDecide,
                'cancel'     => $r->requester_id === $u->id && in_array($r->status, ['pending', 'approved'], true),
                'verify_otp' => $r->requester_id === $u->id && $r->status === 'approved' && $stage === 'otp',
                'lock'       => $r->isLive() && ($r->requester_id === $u->id || $this->isAdmin($u)),
            ],
            'created_at'       => $r->created_at?->toIso8601String(),
        ];
    }

    private function shareRow(CredentialShare $s, ?int $clientId = null): array
    {
        $c = $s->credential;
        $members = $s->recipient_type === 'team' && $clientId ? ($this->memberCounts($clientId)[$s->recipient_department_id] ?? 0) : null;

        return [
            'id'         => $s->id,
            'credential' => $c ? ['id' => $c->id, 'code' => $c->code, 'name' => $c->name, 'type' => $c->type,
                                  'type_label' => Credential::typeDef($c->type)['label'] ?? $c->type, 'category_group' => $c->category_group ?? null,
                                  'risk' => $c->risk, 'url' => $c->url ?? null, 'updated_at' => $c->updated_at?->toIso8601String()] : null,
            'recipient'  => $s->recipient_type === 'user'
                ? ['type' => 'user', 'id' => $s->recipient_user_id, 'name' => $s->recipientUser?->name,
                   'initials' => $this->initials($s->recipientUser?->name), 'sub' => $s->recipientUser?->designation ?: 'Individual']
                : ['type' => 'team', 'id' => $s->recipient_department_id, 'name' => $s->recipientDepartment?->name,
                   'members' => $members, 'sub' => 'Team' . ($members !== null ? " · {$members} members" : '')],
            'permission' => $s->permission,
            'permission_label' => ['use' => 'Use Only', 'view' => 'View', 'copy' => 'Copy', 'full' => 'Full Access'][$s->permission] ?? $s->permission,
            'reason'     => $s->reason,
            'shared_at'  => $s->created_at?->toIso8601String(),
            'updated_at' => $s->updated_at?->toIso8601String(),
            'expires_at' => $s->expires_at?->toIso8601String(),
            'revoked_at' => $s->revoked_at?->toIso8601String(),
            'state'      => $s->state(),
        ];
    }

    /** Timeline rows, with the credential's risk and type and each actor's role read in two queries for the page. */
    private function eventRows(Collection $events, User $u): Collection
    {
        $creds = Credential::withTrashed()->whereIn('id', $events->pluck('credential_id')->filter()->unique()->all())
            ->get(['id', 'risk', 'type'])->keyBy('id');
        $this->userInfo($events->pluck('user_id')->filter()->unique()->all());

        return $events->map(fn ($e) => $this->eventRow($e, $u, $creds->get($e->credential_id)))->values();
    }

    private function eventRow(AuditLog $e, User $u, ?Credential $c = null): array
    {
        $info = $e->user_id ? ($this->userInfo([$e->user_id])[$e->user_id] ?? []) : [];

        return [
            'id'             => $e->id,
            'event_id'       => 'EVT-' . $e->id,
            'at'             => $e->created_at->toIso8601String(),
            'actor'          => $e->user_id
                ? ['id' => $e->user_id, 'name' => $e->user_id === $u->id ? 'You' : $e->user?->name, 'full_name' => $e->user?->name,
                   'initials' => $this->initials($e->user?->name), 'role' => $info['role_line'] ?? 'Team member', 'is_me' => $e->user_id === $u->id]
                : ['id' => null, 'name' => 'System', 'full_name' => 'System', 'initials' => 'SY', 'role' => 'CredVault', 'is_me' => false],
            'action'         => $e->action,
            'label'          => AuditLog::ACTIONS[$e->action][0] ?? $e->action,
            'verb'           => AuditLog::VERBS[$e->action] ?? $e->action,
            'severity'       => $e->severity,
            'severity_label' => AuditLog::SEVERITY_LABELS[$e->severity] ?? $e->severity,
            'credential'     => $e->credential_id
                ? ['id' => $e->credential_id, 'code' => $e->credential_code, 'name' => $e->credential_name, 'risk' => $c?->risk, 'type' => $c?->type]
                : null,
            'target'         => $e->credential_id ? $e->credential_code : 'Vault settings',
            'module'         => $e->module,
            'detail'         => $e->detail,
            'ip'             => $e->ip,
        ];
    }

    private function transferRow(Transfer $t, ?User $u = null): array
    {
        return [
            'id' => $t->id, 'code' => $t->code, 'kind' => $t->kind,
            'scope' => $t->scope, 'scope_label' => Transfer::SCOPE_LABELS[$t->scope] ?? $t->scope,
            'format' => $t->format, 'format_label' => Transfer::FORMAT_LABELS[$t->format] ?? strtoupper((string) $t->format),
            'file_name' => $t->file_name, 'source' => $t->source, 'items' => $t->items, 'skipped' => $t->skipped,
            'weak' => $t->weak, 'duplicates' => $t->duplicates, 'size_bytes' => $t->size_bytes,
            'include_passwords' => $t->include_passwords, 'locked' => $t->locked, 'status' => $t->status,
            'failure_reason' => $t->failure_reason,
            'by' => $t->user?->name, 'by_id' => $t->user_id, 'by_me' => $u ? $t->user_id === $u->id : null,
            'by_role' => ($this->userInfo([$t->user_id])[$t->user_id]['role_line'] ?? null),
            'at' => $t->created_at?->toIso8601String(),
        ];
    }

    /**
     * Designation, department and the one-line role the screens print under a
     * name ("Vault Administrator", "Executive · Accounts", "Team member"),
     * for a batch of users. Cached for the request, so repeated rows cost nothing.
     */
    private function userInfo(array $ids): array
    {
        $this->memo['userInfo'] ??= [];
        $missing = array_values(array_diff(array_filter($ids), array_keys($this->memo['userInfo'])));
        if ($missing) {
            $users = User::whereIn('id', $missing)->get(['id', 'name', 'designation', 'department_id', 'employee_code', 'client_id', 'user_type']);
            $emps  = Employee::whereIn('user_id', $missing)->with('designation:id,name')->get(['id', 'user_id', 'department_id', 'designation_id'])->keyBy('user_id');
            $deps  = Departments::whereIn('id', $users->pluck('department_id')->merge($emps->pluck('department_id'))->filter()->unique()->all())->pluck('name', 'id');
            foreach ($users as $x) {
                $e = $emps->get($x->id);
                $designation = $e?->designation?->name ?: $x->designation;
                $department  = $deps[$x->department_id ?: $e?->department_id] ?? null;
                $role = $x->user_type === 'client_admin' ? 'Vault Administrator'
                    : (trim(($designation ?: '') . ($department ? ' · ' . $department : ''), ' ·') ?: 'Team member');
                $this->memo['userInfo'][$x->id] = ['designation' => $designation, 'department' => $department, 'role_line' => $role];
            }
            foreach (array_diff($missing, $users->pluck('id')->all()) as $gone) $this->memo['userInfo'][$gone] = [];
        }

        return array_intersect_key($this->memo['userInfo'], array_flip($ids));
    }

    /** Users whose department (on the login or the employee record) matches a search term. */
    private function usersInDepartmentsLike(int $clientId, string $like): array
    {
        $deps = Departments::where(fn ($w) => $w->whereNull('client_id')->orWhere('client_id', $clientId))
            ->whereRaw('lower(name) like ?', [$like])->pluck('id')->all();
        if (!$deps) return [];

        return User::where('client_id', $clientId)->whereIn('department_id', $deps)->pluck('id')
            ->merge(Employee::where('client_id', $clientId)->whereIn('department_id', $deps)->whereNotNull('user_id')->pluck('user_id'))
            ->unique()->values()->all();
    }

    /* ═══════════════════════════ ACCESS MODEL ═══════════════════════════ */

    /** Every credential the user can reach by any route — the base of each list. */
    private function visibleQuery(User $u): Builder
    {
        $dept  = $this->deptOf($u);
        $heads = $this->headedDepts($u);
        $admin = $this->isAdmin($u);
        $teams = array_values(array_unique(array_filter(array_merge([$dept], $heads))));

        return Credential::where('credvault_credentials.client_id', $u->client_id)->where(function ($w) use ($u, $teams, $admin) {
            $w->where('owner_id', $u->id)->orWhereIn('credvault_credentials.id', $this->sharedWithMeIds($u));
            if ($admin) {
                $w->orWhere('scope', 'team');
            } elseif ($teams) {
                $w->orWhere(fn ($t) => $t->where('scope', 'team')->whereIn('department_id', $teams));
            }
        });
    }

    /** Subquery: ids of credentials with a live share to the user or the user's team. */
    private function sharedWithMeIds(User $u)
    {
        $dept = $this->deptOf($u);

        return CredentialShare::live()->where('client_id', $u->client_id)->where(function ($w) use ($u, $dept) {
            $w->where(fn ($x) => $x->where('recipient_type', 'user')->where('recipient_user_id', $u->id));
            if ($dept) $w->orWhere(fn ($x) => $x->where('recipient_type', 'team')->where('recipient_department_id', $dept));
        })->select('credential_id');
    }

    /** [id => [rank, via]] for a batch, in one share query. via: owner | admin | hod | team | share */
    private function accessMap(Collection $creds, User $u): array
    {
        if ($creds->isEmpty()) return [];

        $dept  = $this->deptOf($u);
        $heads = $this->headedDepts($u);
        $admin = $this->isAdmin($u);
        $shareRank = [];
        CredentialShare::live()->whereIn('credential_id', $creds->pluck('id')->all())
            ->where(function ($w) use ($u, $dept) {
                $w->where(fn ($x) => $x->where('recipient_type', 'user')->where('recipient_user_id', $u->id));
                if ($dept) $w->orWhere(fn ($x) => $x->where('recipient_type', 'team')->where('recipient_department_id', $dept));
            })->get(['credential_id', 'permission'])
            ->each(function ($s) use (&$shareRank) {
                $shareRank[$s->credential_id] = max($shareRank[$s->credential_id] ?? -1, CredentialShare::rank($s->permission));
            });

        $out = [];
        foreach ($creds as $c) {
            if ($c->owner_id === $u->id) { $out[$c->id] = [self::RANK_FULL, 'owner']; continue; }
            $best = null;
            if ($c->scope === 'team') {
                if ($admin) $best = [self::RANK_FULL, 'admin'];
                elseif ($c->department_id && in_array($c->department_id, $heads, true)) $best = [self::RANK_FULL, 'hod'];
                elseif ($c->department_id && $c->department_id === $dept) $best = [self::RANK_COPY, 'team'];
            }
            if (isset($shareRank[$c->id]) && (!$best || $shareRank[$c->id] > $best[0])) $best = [$shareRank[$c->id], 'share'];
            if ($best) $out[$c->id] = $best;
        }

        return $out;
    }

    /** @return array{0:Credential,1:array} — 404 when out of reach, 403 when below $min. */
    private function findCredential(User $u, int $id, int $min = self::RANK_USE, string $message = 'You do not have permission for this.'): array
    {
        $c   = Credential::where('client_id', $u->client_id)->with(['owner:id,name', 'department:id,name'])->find($id)
            ?? $this->reject('Credential not found.', null, 404);
        $acc = $this->accessMap(collect([$c]), $u)[$c->id] ?? $this->reject('Credential not found.', null, 404);
        if ($acc[0] < $min) $this->reject($message, null, 403);

        return [$c, $acc];
    }

    /** [credential_id => the user's open request] — a live unlock beats a pending one. */
    private function openRequestsFor(User $u, array $ids): array
    {
        if (!$ids) return [];

        return AccessRequest::where('requester_id', $u->id)->whereIn('credential_id', $ids)->whereIn('status', AccessRequest::OPEN)
            ->with(['adminUser:id,name', 'managerUser:id,name'])
            ->orderByRaw("case when status = 'unlocked' then 0 else 1 end")->get()
            ->unique('credential_id')->keyBy('credential_id')->all();
    }

    private function isAdmin(User $u): bool
    {
        // The policy's named approver is chosen from the client admins; once demoted they
        // stop being a Vault Admin, so the client-admin check alone decides.
        return $this->memo("admin:{$u->id}", fn () => $u->isClientAdmin());
    }

    private function assertAdmin(User $u): void
    {
        if (!$this->isAdmin($u)) $this->reject('Only a Vault Admin can change CredVault Policies.', null, 403);
    }

    /** Active Vault Admins of the client. $withPolicy adds the policy's named admin. */
    /** $id when it is still an active Vault Admin of the client, else null (= any Vault Admin). */
    private function liveAdmin(?int $id, int $clientId): ?int
    {
        return $id && in_array((int) $id, $this->adminIds($clientId), true) ? (int) $id : null;
    }

    /** The admin a request names — dropped once that person stops being a Vault Admin, so the request never sticks. */
    private function namedAdmin(AccessRequest $r): ?int
    {
        return $this->liveAdmin($r->admin_user_id, $r->client_id);
    }

    private function adminIds(int $clientId): array
    {
        $ids = $this->memo("admins:{$clientId}", fn () => User::where('client_id', $clientId)->where('user_type', 'client_admin')
            ->where('status', 'active')->pluck('id')->map(fn ($i) => (int) $i)->all());
        // The named approver counts only while still an active client admin (already in $ids).
        return $ids;
    }

    private function employeeOf(User $u): ?Employee
    {
        return $this->memo("emp:{$u->id}", fn () => Employee::where('client_id', $u->client_id)
            ->where(fn ($w) => $w->where('user_id', $u->id)->when($u->employee_code, fn ($x) => $x->orWhere('emp_code', $u->employee_code)))
            ->orderByRaw('case when user_id = ? then 0 else 1 end', [$u->id])
            ->first(['id', 'user_id', 'emp_code', 'client_id', 'department_id', 'reporting_manager_id', 'reporting_manager_user_id']));
    }

    private function deptOf(User $u): ?int
    {
        return $this->memo("dept:{$u->id}", function () use ($u) {
            $id = $u->department_id ?: $this->employeeOf($u)?->department_id;
            return $id ? (int) $id : null;
        });
    }

    /**
     * Departments the user heads. master_departments stores the HOD as a
     * name (`head`), not a user id, so it is matched to the login by name.
     */
    private function headedDepts(User $u): array
    {
        return $this->memo("heads:{$u->id}", fn () => array_keys(array_filter(
            $this->deptHeads($u->client_id), fn ($uid) => $uid === $u->id)));
    }

    /**
     * department id => the login of its HOD. `master_departments.head` is only a
     * name, so it is matched against the HR employee record — never the login's
     * own name, which every user can edit on their profile. A name that matches
     * no active employee, or more than one, names nobody: HOD rights are full
     * access to a team vault and must not land on a namesake.
     */
    private function deptHeads(int $clientId): array
    {
        return $this->memo("deptHeads:{$clientId}", function () use ($clientId) {
            $byName = [];
            Employee::where('client_id', $clientId)->where('status', 'Active')
                ->get(['id', 'user_id', 'emp_code', 'client_id', 'first_name', 'middle_name', 'last_name', 'display_name'])
                ->each(function ($e) use (&$byName) {
                    $names = array_unique(array_filter(array_map(
                        fn ($n) => Str::lower(preg_replace('/\s+/', ' ', trim((string) $n))),
                        [$e->display_name, "{$e->first_name} {$e->last_name}", "{$e->first_name} {$e->middle_name} {$e->last_name}"])));
                    foreach ($names as $n) $byName[$n][$e->id] = $e;
                });

            $out = [];
            // Only the tenant's own departments: a shared (client_id null) department has one
            // head name for every tenant, which would hand HOD rights to a namesake anywhere.
            $deps = Departments::where('client_id', $clientId)->whereNotNull('head')->get(['id', 'head']);
            foreach ($deps as $d) {
                $hits = $byName[Str::lower(preg_replace('/\s+/', ' ', trim((string) $d->head)))] ?? [];
                $uid  = count($hits) === 1 ? reset($hits)->resolved_user_id : null;
                if ($uid) $out[(int) $d->id] = (int) $uid;
            }
            return $out;
        });
    }

    /** The HOD as the screen shows it: the stored name, with the login it resolves to when there is one. */
    private function hodOf(Departments $d, int $clientId): ?array
    {
        if (!filled($d->head)) return null;

        return ['id' => $this->deptHeads($clientId)[(int) $d->id] ?? null, 'name' => $d->head];
    }

    /** The login behind the user's reporting manager, by either link HR may have used. */
    private function managerOf(User $u): ?int
    {
        return $this->memo("mgr:{$u->id}", function () use ($u) {
            $e = $this->employeeOf($u);
            if (!$e) return null;
            if ($e->reporting_manager_user_id) return (int) $e->reporting_manager_user_id;
            if (!$e->reporting_manager_id) return null;
            $m = Employee::where('client_id', $u->client_id)->find($e->reporting_manager_id, ['id', 'user_id', 'emp_code', 'client_id']);

            return $m?->resolved_user_id;
        });
    }

    /** Departments this tenant may use: its own and the platform's shared ones. */
    private function clientDepartments(User $u): Collection
    {
        return $this->memo("deps:{$u->client_id}", fn () => Departments::where(fn ($w) => $w->whereNull('client_id')->orWhere('client_id', $u->client_id))
            ->orderBy('name')->get(['id', 'client_id', 'name', 'head']));
    }

    /** [department_id => active employees] for the tenant. */
    private function memberCounts(int $clientId): array
    {
        return $this->memo("members:{$clientId}", fn () => Employee::where('client_id', $clientId)->where('status', 'Active')->whereNotNull('department_id')
            ->selectRaw('department_id, count(*) as n')->groupBy('department_id')->pluck('n', 'department_id')
            ->map(fn ($n) => (int) $n)->all());
    }

    /** The team a team-scope write is filed under — the user's own, or one they head or administer. */
    private function teamDepartmentFor(User $u, ?int $requested): int
    {
        $deptId = $requested ?: $this->deptOf($u);
        if (!$deptId) $this->reject('Pick the team (department) this credential belongs to.', 'department_id');
        if (!$this->clientDepartments($u)->contains('id', $deptId)) $this->reject('That department does not exist.', 'department_id', 404);

        $mayUse = $this->isAdmin($u) || $deptId === $this->deptOf($u) || in_array($deptId, $this->headedDepts($u), true);
        if (!$mayUse) $this->reject('You can only add team credentials to your own department.', 'department_id', 403);

        return (int) $deptId;
    }

    /* ══════════════════════════ NOTIFICATIONS ══════════════════════════ */

    /**
     * A row in the bell inbox (the `notifications` table NotificationController
     * reads), written the way the P2P approvals write theirs. Inside the
     * caller's transaction, so a rolled-back request notifies nobody. A failed
     * insert is logged and never fails the action that caused it.
     */
    private function notify(array $userIds, string $kind, string $title, string $message, array $extra = []): void
    {
        $now  = now();
        $rows = collect($userIds)->filter()->unique()->map(fn ($id) => [
            'id'              => (string) Str::uuid(),
            'type'            => 'App\\Notifications\\CredVault',
            'notifiable_type' => User::class,
            'notifiable_id'   => (int) $id,
            'data'            => json_encode(['module' => 'credvault', 'kind' => $kind, 'title' => $title, 'message' => $message] + $extra),
            'read_at'         => null,
            'created_at'      => $now,
            'updated_at'      => $now,
        ])->values()->all();
        if (!$rows) return;

        try {
            DB::table('notifications')->insert($rows);
        } catch (\Throwable $e) {
            Log::warning('CredVault: notification failed', ['kind' => $kind, 'users' => $userIds, 'err' => $e->getMessage()]);
        }
    }

    /** Who the request is waiting on now: the named approver, or every Vault Admin but the requester. */
    private function notifyStage(AccessRequest $r, string $who): void
    {
        $stage = $r->currentStage();
        $c     = $r->credential;
        $extra = ['request_id' => $r->id, 'credential_id' => $c?->id, 'url' => '/credentials-vault/access-requests'];

        if ($stage === 'admin') {
            $to = $this->namedAdmin($r) ? [$this->namedAdmin($r)] : array_diff($this->adminIds($r->client_id), [$r->requester_id]);
            $this->notify($to, 'access_request', 'Access request to approve',
                "{$who} asks to unlock “{$c?->name}” for {$r->duration_minutes} min ({$r->code}).", $extra);
        } elseif ($stage === 'manager') {
            $this->notify([$r->manager_user_id], 'access_request', 'Access request to approve',
                "{$who}'s request to unlock “{$c?->name}” passed the Vault Admin and needs your approval ({$r->code}).", $extra);
        }
    }

    /* ═════════════════════════════ AUDIT ═════════════════════════════ */

    private function audit(User $u, string $action, ?Credential $c = null, ?string $detail = null, array $meta = [], ?string $module = null): void
    {
        $this->writeAudit($u->client_id, $u->id, $u->branch_id, $action, $c, $detail, $meta,
            $module ?? ($c ? ($c->risk === 'critical' ? 'Critical Vault' : ($c->scope === 'team' ? 'Team Vault' : 'My Vault')) : null));
    }

    private function writeAudit(int $clientId, ?int $userId, ?int $branchId, string $action, ?Credential $c, ?string $detail, array $meta, ?string $module, ?string $severity = null): void
    {
        $severity ??= AuditLog::ACTIONS[$action][1] ?? 'info';
        if ($c && $c->risk === 'critical' && in_array($action, AuditLog::RAISE_ON_CRITICAL, true)) $severity = 'critical';

        AuditLog::create([
            'client_id'       => $clientId,
            'branch_id'       => $branchId,
            'user_id'         => $userId,
            'action'          => $action,
            'severity'        => $severity,
            'credential_id'   => $c?->id,
            'credential_code' => $c?->code,
            'credential_name' => $c ? Str::limit($c->name, 150, '') : null,
            'module'          => $module,
            'detail'          => $detail ? Str::limit($detail, 500, '') : null,
            'meta'            => $meta ?: null,
            'ip'              => request()?->ip(),
            'user_agent'      => Str::limit((string) request()?->userAgent(), 255, ''),
            'created_at'      => now(),
        ]);
    }

    private function auditRules(): array
    {
        return $this->listRules(['all', 'mine', 'team', 'alerts']) + [
            'range'         => ['nullable', Rule::in(['24h', '7d', '30d', 'all', 'custom'])],
            // Either end may be left open: no From = from the start, no To = today.
            // Dates are the viewer's calendar days (tz), not the server's UTC ones.
            'from'          => ['nullable', 'date_format:Y-m-d'],
            'to'            => ['nullable', 'date_format:Y-m-d'],
            'tz'            => ['nullable', 'timezone:all_with_bc'],
            'action'        => ['nullable', Rule::in(array_keys(AuditLog::ACTIONS))],
            'credential_id' => ['nullable', 'integer', 'min:1'],
        ];
    }

    private function auditMessages(): array
    {
        return ['from.before_or_equal' => 'From cannot be in the future.', 'to.before_or_equal' => 'To cannot be in the future.'];
    }

    private function auditQuery(User $u, array $f): Builder
    {
        $q = AuditLog::where('client_id', $u->client_id);
        if (!$this->isAdmin($u)) {
            $q->where(fn ($w) => $w->where('user_id', $u->id)
                ->orWhereIn('credential_id', Credential::withTrashed()->where('client_id', $u->client_id)->where('owner_id', $u->id)->select('id')));
        }

        $tz    = $f['tz'] ?? config('app.timezone');
        $today = now($tz)->toDateString();
        foreach (['from' => 'From', 'to' => 'To'] as $k => $label) {
            if (!empty($f[$k]) && $f[$k] > $today) $this->reject("{$label} cannot be in the future.", $k);
        }

        match ($f['range'] ?? '30d') {
            '24h'    => $q->where('created_at', '>=', now()->subDay()),
            '7d'     => $q->where('created_at', '>=', now()->subDays(7)),
            '30d'    => $q->where('created_at', '>=', now()->subDays(30)),
            'custom' => $q->when($f['from'] ?? null, fn ($x, $d) => $x->where('created_at', '>=', Carbon::parse($d, $tz)->startOfDay()->utc()))
                          ->when($f['to'] ?? null, fn ($x, $d) => $x->where('created_at', '<=', Carbon::parse($d, $tz)->endOfDay()->utc())),
            default  => null,
        };
        if (($f['range'] ?? null) === 'custom' && !empty($f['from']) && !empty($f['to']) && $f['from'] > $f['to']) {
            $this->reject('From must be on or before To.', 'from');
        }
        match ($f['tab'] ?? 'all') {
            'mine'   => $q->where('user_id', $u->id),
            'team'   => $q->where(fn ($w) => $w->whereNull('user_id')->orWhere('user_id', '!=', $u->id)),
            'alerts' => $q->where('severity', 'critical'),
            default  => null,
        };
        if (!empty($f['action']))        $q->where('action', $f['action']);
        if (!empty($f['credential_id'])) $q->where('credential_id', $f['credential_id']);
        if ($term = $f['q'] ?? null) {
            // Event ID, actor, action label, credential, detail, module — what the prototype searches.
            $like    = $this->likeTerm($term);
            $t       = mb_strtolower(trim($term));
            $actions = collect(AuditLog::ACTIONS)->filter(fn ($a) => str_contains(mb_strtolower($a[0]), $t))->keys()->all();
            $eventId = preg_match('/^(evt-)?(\d+)$/i', $t, $m) ? (int) $m[2] : null;
            $q->where(function ($w) use ($like, $u, $actions, $eventId) {
                $w->whereRaw('lower(coalesce(detail, \'\')) like ?', [$like])
                  ->orWhereRaw('lower(coalesce(credential_name, \'\')) like ?', [$like])
                  ->orWhereRaw('lower(coalesce(credential_code, \'\')) like ?', [$like])
                  ->orWhereRaw('lower(coalesce(module, \'\')) like ?', [$like])
                  ->orWhereIn('user_id', User::where('client_id', $u->client_id)->whereRaw('lower(name) like ?', [$like])->select('id'));
                if ($actions) $w->orWhereIn('action', $actions);
                if ($eventId) $w->orWhere('credvault_audit_logs.id', $eventId);
            });
        }

        return $q;
    }

    /* ═════════════════════════════ PLUMBING ═════════════════════════════ */

    /** The module row the Permissions screen grants CredVault access through. */
    private const MODULE_SLUG = 'credentials-vault';

    /**
     * The signed-in user, provided CredVault is theirs to open: a client admin
     * (the Vault Admin — approvals and policies live here) always, anyone else
     * with view on the Credentials Vault module. Checked once per request.
     */
    private function tenantUser(Request $request): User
    {
        $u = $request->user();
        if (!$u?->client_id) $this->reject('CredVault needs a company account — this login has no tenant.', null, 403);

        $this->memo("module:{$u->id}", function () use ($u) {
            if ($u->isClientAdmin()) return true;
            $moduleId = Module::where('slug', self::MODULE_SLUG)->value('id');
            $allowed = $moduleId && Permission::where('user_id', $u->id)->where('module_id', $moduleId)->where('can_view', true)->exists();
            if (!$allowed) $this->reject('You do not have access to Credentials Vault. Ask your admin to grant it in Permissions.', null, 403);
            return true;
        });

        return $u;
    }

    private function listRules(array $tabs): array
    {
        return [
            'tab'      => ['nullable', Rule::in($tabs)],
            'q'        => ['nullable', 'string', 'max:100'],
            'page'     => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ];
    }

    private function pageMeta($page): array
    {
        return ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()];
    }

    private function likeTerm(string $term): string
    {
        return '%' . addcslashes(mb_strtolower(trim($term)), '%_\\') . '%';
    }

    /** Case-insensitive contains, on any driver; "_" and "%" are literal. */
    private function applySearch(Builder $q, ?string $term, array $cols): Builder
    {
        if ($term === null || trim($term) === '') return $q;
        $like = $this->likeTerm($term);
        $table = $q->getModel()->getTable();

        return $q->where(function ($w) use ($cols, $like, $table) {
            foreach ($cols as $col) $w->orWhereRaw("lower(coalesce({$table}.{$col}, '')) like ?", [$like]);
        });
    }

    /**
     * The next code for a per-client series (CRD-0001, REQ-0001 …), allocated
     * under a lock on the client's row so two saves cannot take the same one.
     * Must run inside a transaction. The audit log is consulted too, so a code
     * once used by a credential since purged is never handed out again.
     */
    private function nextCode(string $table, string $prefix, int $clientId): string
    {
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->value('id');

        return sprintf('%s-%04d', $prefix, $this->lastNumber($table, $prefix, $clientId) + 1);
    }

    private function peekCode(string $table, string $prefix, int $clientId): string
    {
        return sprintf('%s-%04d', $prefix, $this->lastNumber($table, $prefix, $clientId) + 1);
    }

    private function lastNumber(string $table, string $prefix, int $clientId): int
    {
        $num = fn (?string $code) => $code ? (int) substr($code, strlen($prefix) + 1) : 0;
        $n = $num(DB::table($table)->where('client_id', $clientId)->where('code', 'like', "{$prefix}-%")->orderByDesc('id')->value('code'));
        if ($table === 'credvault_credentials') {
            $n = max($n, $num(AuditLog::where('client_id', $clientId)->where('action', 'purge')->where('credential_code', 'like', "{$prefix}-%")
                ->orderByDesc('credential_code')->value('credential_code')));
        }

        return $n;
    }

    private function host(?string $url): ?string
    {
        if (!$url) return null;
        $host = parse_url(str_contains($url, '://') ? $url : "https://{$url}", PHP_URL_HOST);

        return $host ? preg_replace('/^www\./', '', Str::lower($host)) : null;
    }

    private function mime(string $format): string
    {
        return ['csv' => 'text/csv', 'json' => 'application/json', 'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'][$format] ?? 'application/octet-stream';
    }

    private function download(string $body, string $name, string $mime, array $headers = [])
    {
        return response($body, 200, $headers + [
            'Content-Type'                  => $mime . ($mime === 'text/csv' ? '; charset=UTF-8' : ''),
            'Content-Disposition'           => 'attachment; filename="' . $name . '"',
            'Content-Length'                => strlen($body),
            'Cache-Control'                 => 'no-store',
            'Access-Control-Expose-Headers' => 'Content-Disposition, X-CredVault-Code, X-CredVault-Withheld',
        ]);
    }

    private function memo(string $key, callable $fn): mixed
    {
        if (!array_key_exists($key, $this->memo)) $this->memo[$key] = $fn();

        return $this->memo[$key];
    }

    /** The 422 / 403 / 404 / 409 shape the forms read; the field puts the message on the right input. */
    private function reject(string $message, ?string $field = null, int $status = 422): never
    {
        throw new HttpResponseException(response()->json(array_filter([
            'status'  => false,
            'message' => $message,
            'errors'  => $field ? [$field => [$message]] : null,
        ], fn ($v) => $v !== null), $status));
    }

    /**
     * All-or-nothing; refusals pass through as they are, anything unexpected
     * becomes a logged, clean 500. Files stored before the failure are removed.
     */
    private function inTransaction(string $action, callable $work, array &$cleanup = []): mixed
    {
        try {
            return DB::transaction($work);
        } catch (ValidationException|HttpResponseException|ModelNotFoundException|HttpExceptionInterface $e) {
            if ($cleanup) Storage::disk('local')->delete($cleanup);
            throw $e;
        } catch (\Throwable $e) {
            if ($cleanup) Storage::disk('local')->delete($cleanup);
            Log::error("CredVault: could not {$action}", ['user_id' => auth()->id(), 'error' => $e->getMessage(), 'at' => $e->getFile() . ':' . $e->getLine()]);
            $this->reject("Could not {$action}. Nothing was saved — please try again.", null, 500);
        }
    }

    /** Passphrase words — the prototype's GP_WORDS. 100 of them: log2(100) ≈ 6.6 bits a word. */
    private const WORDS = [
        'amber', 'anchor', 'arctic', 'atlas', 'autumn', 'bamboo', 'beacon', 'birch', 'blossom', 'breeze',
        'bronze', 'canyon', 'carbon', 'cedar', 'cobalt', 'comet', 'copper', 'coral', 'cosmic', 'crimson',
        'crystal', 'delta', 'desert', 'dragon', 'eagle', 'ember', 'falcon', 'fern', 'flint', 'forest',
        'frost', 'galaxy', 'garnet', 'glacier', 'granite', 'harbor', 'hazel', 'horizon', 'indigo', 'iron',
        'island', 'jade', 'jasper', 'jungle', 'lagoon', 'lantern', 'lava', 'lemon', 'lunar', 'maple',
        'marble', 'meadow', 'meteor', 'mint', 'monsoon', 'nebula', 'nickel', 'noble', 'oasis', 'ocean',
        'olive', 'onyx', 'opal', 'orbit', 'orchid', 'pebble', 'pepper', 'phoenix', 'pine', 'planet',
        'plasma', 'polar', 'prairie', 'quartz', 'radar', 'raven', 'reef', 'river', 'rocket', 'ruby',
        'saffron', 'sapphire', 'shadow', 'silver', 'solar', 'spruce', 'storm', 'summit', 'tango', 'thunder',
        'tiger', 'timber', 'topaz', 'tundra', 'velvet', 'violet', 'walnut', 'willow', 'winter', 'zephyr',
    ];
}
