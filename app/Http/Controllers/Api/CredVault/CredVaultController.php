<?php

namespace App\Http\Controllers\Api\CredVault;

use App\Http\Controllers\Controller;
use App\Mail\CredVaultShareMail;
use App\Mail\PasswordChangedMail;
use App\Models\Branch;
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
use App\Services\CredVault\EmailOtp;
use App\Services\CredVault\ExcelLock;
use App\Services\CredVault\ImportTemplate;
use App\Services\CredVault\PasswordGenerator;
use App\Services\CredVault\Totp;
use App\Services\CredVault\VaultFile;
use App\Support\BrandingResolver;
use App\Support\Settings;
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
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/**
 * CredVault — the company password manager. /api/credvault/*
 *
 * The shared half of the Kryptone CredVault prototype: Vault Dashboard,
 * Password Health, the all-vault list and View drawer, sharing, Team Vault,
 * Policies, Import & Recovery, Audit Logs and the Recycle Bin.
 *
 * TWO VAULTS, ONE TABLE (credvault_credentials.vault) — each with its own
 * controller folder and code series:
 *   NormalVault\NormalVaultController       CRD-0001 …   2-step is a recorded yes/no
 *   CriticalVault\CriticalVaultController   CCRD-0001 …  approvals + 2-step unlock
 *   CriticalVault\TwoStepController         Google Authenticator / email code setup
 *   CriticalVault\AccessRequestController   the unlock flow
 * They extend this class for the helpers below. docs/CREDVAULT_API_SHEET.md
 * lists every endpoint.
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
 * PROTECTED CREDENTIALS — Critical Vault credentials with any step on —
 * reveal nothing, to anyone, owner included, until an access request has
 * passed every step (Vault Admin → Reporting Manager → 2-step code, from the
 * authenticator app or by email) and its time window is open. The window closes on its
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
    protected const RANK_USE  = 0;
    protected const RANK_VIEW = 1;
    protected const RANK_COPY = 2;
    protected const RANK_FULL = 3;
    /** Wrong authenticator codes one person may enter on one credential in 24 h (two voided requests). */
    protected const OTP_DAILY_LIMIT = 6;

    protected const PAGE_SIZE   = 10;
    protected const IMPORT_TTL  = 1800;   // seconds a previewed import stays claimable
    // As the prototype accepts them: a type's own file field (crdField), and the extra attachments (crdXt).
    protected const FIELD_FILE_TYPES = 'pdf,jpg,jpeg,png,pem,crt,cer,pfx';
    protected const ATTACH_TYPES     = 'pdf,png,jpg,jpeg,webp,doc,docx,xls,xlsx,csv,txt';
    protected const FILE_MAX_KB = 10240;
    protected const MAX_EXTRA_ATTACHMENTS = 5;

    /** The non-secret columns every list, count and health pass needs. */
    protected const LIGHT_COLUMNS = [
        'id', 'client_id', 'branch_id', 'code', 'vault', 'type', 'category_group', 'name', 'scope', 'owner_id', 'department_id',
        'url', 'username', 'risk', 'strength', 'has_password', 'twofa', 'twofa_method', 'twofa_email', 'rotation_days',
        'password_changed_at', 'secret_hash', 'lock_admin', 'lock_manager', 'lock_otp',
        'totp_linked_at', 'twofa_linked_at', 'created_at', 'updated_at',
    ];

    /** What every access-request row needs, in one eager load. */
    protected const REQUEST_RELATIONS = [
        'credential:id,client_id,branch_id,code,vault,name,type,category_group,risk,url,owner_id,twofa_method,twofa_email,deleted_at',
        'requester:id,name,designation,department_id,branch_id,employee_code,client_id,user_type',
        'adminUser:id,name,designation', 'managerUser:id,name,designation',
        'adminDecider:id,name,designation', 'managerDecider:id,name,designation',
    ];

    /** Per-request answers that several helpers ask for repeatedly. */
    protected array $memo = [];

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
            // The same 25 types in both. The Normal Vault takes low–high; the Critical Vault is always critical.
            'vaults'      => [
                ['key' => 'normal', 'label' => 'My Vault', 'prefix' => Credential::VAULT_PREFIX['normal'], 'risks' => ['low', 'medium', 'high'], 'two_step' => 'recorded'],
                ['key' => 'critical', 'label' => 'Critical Vault', 'prefix' => Credential::VAULT_PREFIX['critical'], 'risks' => ['critical'], 'two_step' => 'enforced'],
            ],
            'two_step_methods' => [
                ['key' => 'google', 'label' => 'Google Authenticator', 'description' => 'A 6-digit code from Google / Microsoft Authenticator or Authy'],
                ['key' => 'email',  'label' => 'Email code', 'description' => 'A 6-digit code sent by email', 'default_email' => EmailOtp::defaultInbox()],
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
            // Recycle Bin retention: the viewer's branch period, one for both vaults (Policy::binDays).
            'bin_days'         => ['normal' => Policy::binDays($pol, $this->binBranchFor($u)), 'critical' => Policy::binDays($pol, $this->binBranchFor($u))],
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
     *   &vault=normal|critical         one vault (each vault's own list fixes it)
     *   &risk=low|medium|high|critical
     *   &q= &type= &group= &department_id= &member_id= &page= &per_page=
     *
     * member_id (a login) or member_employee_id (a tree node) is the Team Vault
     * "credentials accessible to <person>" filter. It narrows what the caller
     * can already see, so it reveals nothing new and anyone may use it.
     *
     * Tab counts follow the search box: with q, each tab counts its matches.
     * The department and member filters belong to the Team side: the "mine"
     * tab ignores both. tabs.sharedby is the Shared By Me count (active +
     * expiring soon), searched as the Shared By Me list searches.
     */
    public function index(Request $request)
    {
        return $this->listCredentials($request, null);
    }

    /**
     * GET /credvault/dev/totp — LOCAL-ONLY dev helper. Returns the current authenticator
     * code for the caller's client's critical google-2-step credentials, so a developer
     * can test the unlock flow without an authenticator app. Hard-gated to APP_ENV=local;
     * 404 everywhere else. This bypasses 2FA on purpose — it must never ship enabled.
     */
    public function devTotp(Request $request)
    {
        abort_unless(app()->environment('local'), 404);
        $u = $this->tenantUser($request);

        $rows = Credential::where('client_id', $u->client_id)->where('vault', 'critical')
            ->where('twofa_method', 'google')->whereNotNull('totp_secret')
            ->get(['id', 'code', 'name', 'totp_secret'])
            ->map(fn ($c) => ['id' => $c->id, 'code' => $c->code, 'name' => $c->name, 'totp' => Totp::code($c->totp_secret)])
            ->values();

        return response()->json([
            'status' => true,
            'note'   => 'LOCAL dev helper — live 2FA codes, valid ~30s. Never enable outside local.',
            'data'   => $rows,
        ], 200);
    }

    /** index, and each vault's own list — $vault fixes the vault; null lets ?vault= pick one. */
    protected function listCredentials(Request $request, ?string $vault)
    {
        $u = $this->tenantUser($request);
        $f = $request->validate($this->listRules(['all', 'mine', 'team', 'shared', 'others']) + [
            'vault'              => ['nullable', Rule::in(Credential::VAULTS)],
            'risk'               => ['nullable', Rule::in(Credential::RISKS)],
            'type'               => ['nullable', Rule::in(array_keys(Credential::TYPES))],
            'group'              => ['nullable', Rule::in(Credential::GROUPS)],
            'department_id'      => ['nullable', 'integer', 'min:1'],
            'member_id'          => ['nullable', 'integer', 'min:1'],
            'member_employee_id' => ['nullable', 'integer', 'min:1'],
        ]);
        $this->sweepUnlocks($u->client_id);
        $tab = $f['tab'] ?? 'all';

        $vault = $vault ?? ($f['vault'] ?? null);

        // The hierarchy-filter person, resolved first. Credentials they own (shared by them)
        // plus ones shared with them or their department (accessible to them).
        $member = $this->memberFilter($u, $f);
        $memberShareIds = null;
        if ($member) {
            $memberDept = $this->deptOf($member);
            $memberShareIds = CredentialShare::live()->where('client_id', $u->client_id)
                ->where(function ($s) use ($member, $memberDept) {
                    $s->where(fn ($x) => $x->where('recipient_type', 'user')->where('recipient_user_id', $member->id));
                    if ($memberDept) $s->orWhere(fn ($x) => $x->where('recipient_type', 'team')->where('recipient_department_id', $memberDept));
                })->select('credential_id');
        }
        // A viewer who oversees the picked person (Vault Admin, branch admin, HOD, or
        // up the reporting line) sees that person's WHOLE vault, any scope — these are
        // company credentials. The Critical Vault's team side is the whole branch's;
        // the Normal Vault keeps the reporting line.
        $memberFull = $member && $this->managesMember($u, $member);
        $base = $memberFull
            ? Credential::where('credvault_credentials.client_id', $u->client_id)
                ->where(fn ($w) => $w->where('owner_id', $member->id)->orWhereIn('credvault_credentials.id', $memberShareIds))
            : $this->visibleQuery($u, $vault === 'critical');
        if ($vault) $base->where('vault', $vault);
        if (!empty($f['risk']))  $base->where('risk', $f['risk']);
        if (!empty($f['type']))  $base->where('type', $f['type']);
        if (!empty($f['group'])) $base->where('category_group', $f['group']);
        $this->credentialSearch($base, $u, $f['q'] ?? null);

        // The Team-side filters: everything but "mine".
        $teamSide = clone $base;
        if (!empty($f['department_id'])) $teamSide->where('department_id', $f['department_id']);
        // A picked person the viewer does NOT oversee stays bounded by the viewer's own visibility.
        if ($member && !$memberFull) {
            $teamSide->where(fn ($w) => $w->where('owner_id', $member->id)
                ->orWhereIn('credvault_credentials.id', $memberShareIds));
        }

        $sharedIds = $this->sharedWithMeIds($u);
        // Logins this viewer oversees — their credentials (any scope) belong in the team view.
        $overseen = $this->overseenUserIds($u);
        $views = [
            'all'    => fn () => (clone $teamSide),
            'mine'   => fn () => (clone $base)->where('owner_id', $u->id),
            // With a person picked, show their set as-is (any scope). Otherwise: team-scope
            // credentials plus anything owned by the people this viewer oversees.
            'team'   => fn () => $member ? (clone $teamSide)
                : (clone $teamSide)
                    ->where(fn ($w) => $w->where('scope', 'team')->when($overseen, fn ($q) => $q->orWhereIn('owner_id', $overseen)))
                    ->where('owner_id', '!=', $u->id)->whereNotIn('credvault_credentials.id', $sharedIds),
            'shared' => fn () => (clone $teamSide)->where('owner_id', '!=', $u->id)->whereIn('credvault_credentials.id', $sharedIds),
            'others' => fn () => (clone $teamSide)->where('owner_id', '!=', $u->id),
        ];
        $tabs = array_map(fn ($v) => $v()->count(), $views);
        $sharedBy = CredentialShare::live()->where('client_id', $u->client_id)
            ->whereIn('credential_id', Credential::where('client_id', $u->client_id)->where('owner_id', $u->id)->select('id'));
        $this->shareSearch($sharedBy, $u, $f['q'] ?? null);
        $tabs['sharedby'] = $sharedBy->count();

        $q = $views[$tab]();

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
    protected function memberFilter(User $u, array $f): ?User
    {
        if (!empty($f['member_employee_id'])) {
            $e = Employee::where('client_id', $u->client_id)->find($f['member_employee_id'], ['id', 'user_id', 'emp_code', 'client_id'])
                ?? $this->reject('That person is not part of your company.', 'member_employee_id', 404);
            $f['member_id'] = $e->resolved_user_id
                ?? $this->reject('This person has no CredVault login yet, so nothing is shared with them.', 'member_employee_id', 422);
        }
        if (empty($f['member_id'])) return null;

        return User::where('client_id', $u->client_id)->find($f['member_id'], ['id', 'name', 'designation', 'department_id', 'branch_id', 'client_id', 'employee_code', 'user_type'])
            ?? $this->reject('That person is not part of your company.', 'member_id', 404);
    }

    /**
     * The list search: ID, name, username, url, category (type label), group
     * and owner — what the prototype's search box covers.
     */
    protected function credentialSearch(Builder $q, User $u, ?string $term): void
    {
        if ($term === null || trim($term) === '') return;
        $like  = $this->likeTerm($term);
        $needle = mb_strtolower(trim($term));
        $types = collect(Credential::TYPES)->filter(fn ($t) => str_contains(mb_strtolower($t[0]), $needle))->keys()->all();
        // CS-1461: the Risk and Strength columns are searchable by the words the list shows
        // ("High", "Critical", "Weak", "Strong" …), matched like the category label.
        $risks  = array_values(array_filter(Credential::RISKS, fn ($r) => str_contains($r, $needle)));
        $levels = array_keys(array_filter(Credential::STRENGTH_LABELS, fn ($l) => $l !== '' && str_contains(mb_strtolower($l), $needle)));

        $q->where(function ($w) use ($like, $types, $risks, $levels, $u) {
            foreach (['name', 'code', 'username', 'url', 'category_group'] as $col) {
                $w->orWhereRaw("lower(coalesce(credvault_credentials.{$col}, '')) like ?", [$like]);
            }
            if ($types) $w->orWhereIn('credvault_credentials.type', $types);
            if ($risks) $w->orWhereIn('credvault_credentials.risk', $risks);
            // Strength only means something for a password; the rest show N/A.
            if ($levels) $w->orWhere(fn ($s) => $s->where('credvault_credentials.has_password', true)->whereIn('credvault_credentials.strength', $levels));
            $w->orWhereIn('owner_id', User::where('client_id', $u->client_id)->whereRaw('lower(name) like ?', [$like])->select('id'));
        });
    }

    /** GET /credvault/credentials/{id} — the View drawer. Secrets are masked, never sent. */
    public function show(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        $this->sweepUnlocks($u->client_id);
        [$c, $acc] = $this->findCredential($u, $id);
        $d = $this->detail($c, $u, $acc, true);
        // Opening the drawer is logged once by logAccess ('Opened credential details');
        // an actual field reveal is logged by the reveal/copy endpoint. No entry here.

        return response()->json(['status' => true, 'data' => $d], 200);
    }

    /**
     * A share passed on by someone other than the owner rides on that person's Full
     * Access. Whenever they lose it (revoke, downgrade, removal, the credential turning
     * critical) the shares they made end too — repeated until stable, so a chain of
     * re-shares unwinds however deep it goes.
     */
    protected function endOrphanedShares(User $actor, Credential $c): void
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
    protected function ownShareEnd(User $u, Credential $c): ?Carbon
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
    protected function protectionChange(Request $r, Credential $c): ?string
    {
        $on = fn ($v) => filter_var($v, FILTER_VALIDATE_BOOLEAN);
        if ($r->filled('totp_secret') || $r->filled('totp_code') || $r->filled('email_otp_token')) return '2-step verification';
        if ($r->has('twofa_method') && $r->input('twofa_method') !== $c->twofa_method) return '2-step method';
        if ($r->has('twofa_email') && Str::lower(trim((string) $r->input('twofa_email'))) !== Str::lower((string) $c->twofa_email)) return '2-step email';
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
     * DELETE …-vault/credentials/{id}, for either vault — moves to the Recycle Bin. Shares pause while it is there.
     *
     * On a credential someone shared with you it is the prototype's "Remove
     * from your vault?": your own share ends, the credential itself is untouched.
     */
    protected function binCredential(Request $request, int $id, string $vault)
    {
        $u = $this->tenantUser($request);
        [$c, $acc] = $this->findInVault($u, $id, $vault);

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

        if ($c->isCriticalVault() && !in_array($acc[1], ['owner', 'admin', 'branch'], true)) {
            $this->reject('A critical credential can only be moved to the bin by its owner, a Vault Admin or the Branch Admin.', null, 403);
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

        $days = Policy::binDays($pol, $this->binBranchOfCredential($c));

        return response()->json([
            'status'  => true,
            'message' => "“{$c->name}” moved to the Recycle Bin. It can be restored for {$days} days"
                . ($c->vault === 'critical' ? ' — by the Branch Admin.' : '.'),
            'data'    => ['id' => $c->id, 'vault' => $c->vault, 'purges_at' => now()->addDays($days)->toIso8601String()],
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
    protected function plainFieldLabel(Credential $c, string $field): string
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
            // Hide the legacy per-open reveal rows; opening is logged once as 'view'.
            ->whereNot(fn ($w) => $w->where('action', 'reveal')->where('detail', 'All stored values returned by the detail API'))
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

    protected function initials(?string $name): string
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
            // Shared With Me: never back to the person who shared it with you.
            if (isset($this->sharedToMeBy($u, $c)[$to->id])) $this->reject("{$to->name} shared this credential with you — it can't be shared back to them.", 'recipient_id');
            $toName  = $to->name;
            $members = collect([$to]);
            $teamSize = null;
        } else {
            $dep = $this->clientDepartments($u)->firstWhere('id', $d['recipient_id'])
                ?? $this->reject('That team does not exist.', 'recipient_id', 404);
            $toName  = $dep->name;
            $all      = $this->teamMembers($u->client_id, $dep->id);
            $teamSize = $all->count();
            $members  = $all->where('id', '!=', $u->id)->values();   // the sharer is not told of their own share
        }

        $share = $this->inTransaction('share the credential', function () use ($c, $u, $d, $until, $reason, $toName, $members) {
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
            // The bell: the person, or every member of the team.
            $this->notify($members->pluck('id')->all(), 'shared', $renewed ? 'Share updated' : 'Credential shared with ' . ($share->recipient_type === 'team' ? "your team {$toName}" : 'you'),
                "{$u->name} shared “{$c->name}” with " . ($share->recipient_type === 'team' ? "your team {$toName}" : 'you')
                . ' (' . ucfirst($d['permission']) . ($until ? ', until ' . $until->format('d/m/Y') : '') . ').',
                ['credential_id' => $c->id, 'url' => '/credentials-vault/my-vault']);

            return [$share, $renewed];
        });

        [$row, $renewed] = $share;
        $row->load(['credential:id,code,name,type,risk,url,category_group,updated_at', 'recipientUser:id,name,designation,branch_id', 'recipientUser.branch:id,name', 'recipientDepartment:id,name']);
        $mail = $this->mailShare($request, $u, $c, $row, $members, $renewed, $toName, $teamSize);

        return response()->json([
            'status'  => true,
            'message' => ($renewed ? 'Share updated for ' : 'Shared with ') . $toName . '.'
                . ($capped ? ' It ends on ' . $capped->format('d/m/Y') . ', when your own access does.' : '')
                . ($mail['sent'] ? ' Email sent to ' . $mail['sent'] . ' ' . Str::plural('person', $mail['sent']) . '.' : ''),
            'data'    => $this->shareRow($row, $u->client_id) + ['mail' => $mail],
        ], $renewed ? 200 : 201);
    }

    /** Active logins of the company in the team (the same department test as deptOf: the user's, else their HR record's). */
    protected function teamMembers(int $clientId, int $deptId): Collection
    {
        // An HR record links to its login by user_id, or by emp_code = the login's employee_code (as employeeOf).
        $emps = Employee::where('client_id', $clientId)->where('department_id', $deptId)->get(['user_id', 'emp_code']);
        $ids = $emps->pluck('user_id')->filter()->all();
        $codes = $emps->pluck('emp_code')->filter()->all();

        return User::where('client_id', $clientId)->where('status', 'active')
            ->where(fn ($w) => $w->where('department_id', $deptId)
                ->orWhere(fn ($x) => $x->whereNull('department_id')->where(fn ($y) => $y->whereIn('id', $ids)->orWhereIn('employee_code', $codes))))
            ->orderBy('name')->get(['id', 'name', 'email', 'designation']);
    }

    /**
     * The share email — the Share popup's details, never a secret. A person gets their own;
     * a team's members get one in BCC batches of 50. A mail failure is logged and reported
     * in `mail`, and never undoes the share.
     *
     * @return array{status:string, recipients:int, sent:int, failed:int}
     */
    protected function mailShare(Request $request, User $u, Credential $c, CredentialShare $s, Collection $members, bool $renewed, string $toName, ?int $teamSize = null): array
    {
        $to = $members->filter(fn ($m) => filter_var($m->email, FILTER_VALIDATE_EMAIL))->values();
        // A copy of every share email (CC) — php@inhpl.com unless CREDVAULT_SHARE_COPY_EMAIL says otherwise.
        $copy = filter_var((string) config('services.credvault.share_copy_email'), FILTER_VALIDATE_EMAIL) ?: null;
        if ($copy && $to->contains(fn ($m) => strcasecmp($m->email, $copy) === 0)) $copy = null;
        $out = ['status' => 'sent', 'recipients' => $to->count(), 'sent' => 0, 'failed' => 0, 'copy_to' => $copy];
        if (!$to->count()) return ['status' => 'no_recipients'] + $out;
        if (!Settings::shouldSendMail()) return ['status' => 'mail_off'] + $out;

        $def  = Credential::typeDef($c->type);
        $team = $s->recipient_type === 'team' ? ['name' => $toName, 'members' => $teamSize ?? $members->count()] : null;
        $data = [
            'credential' => ['code' => $c->code, 'name' => $c->name, 'type_label' => $def['label'] ?? $c->type, 'group' => $c->category_group,
                             'detail' => $c->username ?: $this->host($c->url), 'risk' => $c->risk],
            'permission' => $s->permission,
            'until'      => $s->expires_at?->format('d/m/Y'),
            'reason'     => $s->reason,
            'shared_by'  => ['name' => $u->name, 'designation' => $u->designation],
            'shared_at'  => now('Asia/Kolkata')->format('d M Y, h:i A'),
            'team'       => $team,
            'renewed'    => $renewed,
            'open_url'   => str_replace('/login', '/credentials-vault/my-vault', PasswordChangedMail::resolveLoginUrl($request)),
        ];
        $brand = BrandingResolver::forUser($u);

        $send = function (callable $fn, int $n) use (&$out, $c) {
            try {
                $fn();
                $out['sent'] += $n;
            } catch (\Throwable $e) {
                $out['failed'] += $n;
                Log::warning('CredVault: share email not sent', ['credential_id' => $c->id, 'error' => $e->getMessage()]);
            }
        };
        if (!$team) {
            $m = $to->first();
            $send(fn () => Mail::to($m->email, $m->name)->cc($copy ? [$copy] : [])->send(new CredVaultShareMail($data, $m->name, $brand)), 1);
        } else {
            foreach ($to->chunk(50)->values() as $i => $batch) {
                $send(fn () => Mail::to((string) config('mail.from.address'), "{$toName} team")
                    ->cc($copy && $i === 0 ? [$copy] : [])   // the copy once, on the first batch
                    ->bcc($batch->map(fn ($m) => ['email' => $m->email, 'name' => $m->name])->values()->all())
                    ->send(new CredVaultShareMail($data, null, $brand)), $batch->count());
            }
        }
        if ($out['failed']) $out['status'] = $out['sent'] ? 'partly_sent' : 'failed';
        $this->audit($u, 'share', $c, "Share email to {$toName}: {$out['sent']} sent" . ($out['failed'] ? ", {$out['failed']} failed" : '') . ($copy ? ", copy to {$copy}" : ''),
            ['share_id' => $s->id, 'mail' => $out]);

        return $out;
    }

    /**
     * GET /credvault/shares — Shared By Me, one row per share, on credentials I own or shares I made.
     *
     *   tab            all | active | soon | expired | revoked    (counts in `tabs` ignore the search and filters)
     *   q              credential ID / name / group / type, person, team, reason, permission label
     *   credential_id  one credential (Password Health's "Fix" for an over-shared one)
     *   permission     use | view | copy | full   — one, or several comma-separated
     *   recipient_type user | team;  recipient_id  one person or one team (needs recipient_type)
     *   vault          normal | critical;  risk  low | medium | high | critical;  type;  group
     *   shared_from / shared_to    shared on, Y-m-d (in tz)
     *   expires_from / expires_to  expiry date, Y-m-d (in tz)
     *   sort           status (default: expiring soon first) | shared_at | expires_at | name;  dir  asc | desc
     *   tz             the viewer's timezone for the dates shown and the date filters
     *   page, per_page
     */
    public function sharedByMe(Request $request)
    {
        $u = $this->tenantUser($request);
        $f = $request->validate($this->listRules(['all', 'active', 'soon', 'expired', 'revoked']) + [
            'credential_id'  => ['nullable', 'integer', 'min:1'],
            'permission'     => ['nullable', 'string', 'regex:/^(use|view|copy|full)(,(use|view|copy|full))*$/'],
            'recipient_type' => ['nullable', Rule::in(CredentialShare::RECIPIENTS)],
            'recipient_id'   => ['nullable', 'integer', 'min:1'],
            'vault'          => ['nullable', Rule::in(Credential::VAULTS)],
            'risk'           => ['nullable', Rule::in(Credential::RISKS)],
            'type'           => ['nullable', Rule::in(array_keys(Credential::TYPES))],
            'group'          => ['nullable', Rule::in(Credential::GROUPS)],
            'shared_from'    => ['nullable', 'date_format:Y-m-d'],
            'shared_to'      => ['nullable', 'date_format:Y-m-d', 'after_or_equal:shared_from'],
            'expires_from'   => ['nullable', 'date_format:Y-m-d'],
            'expires_to'     => ['nullable', 'date_format:Y-m-d', 'after_or_equal:expires_from'],
            'sort'           => ['nullable', Rule::in(['status', 'shared_at', 'expires_at', 'name'])],
            'dir'            => ['nullable', Rule::in(['asc', 'desc'])],
            'tz'             => ['nullable', 'timezone:all_with_bc'],
        ], ['permission.regex' => 'Permission is use, view, copy or full (comma-separated for several).']);
        if (!empty($f['recipient_id']) && empty($f['recipient_type'])) $this->reject('Say whether recipient_id is a user or a team (recipient_type).', 'recipient_type');
        $tz = $f['tz'] ?? config('app.timezone');

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

        $this->shareSearch($base, $u, $f['q'] ?? null);
        if (($tab = $f['tab'] ?? 'all') !== 'all') $states[$tab]($base);

        // The filters.
        if (!empty($f['permission'])) $base->whereIn('permission', array_unique(explode(',', $f['permission'])));
        if (!empty($f['recipient_type'])) {
            $base->where('recipient_type', $f['recipient_type']);
            if (!empty($f['recipient_id'])) $base->where($f['recipient_type'] === 'user' ? 'recipient_user_id' : 'recipient_department_id', $f['recipient_id']);
        }
        $credFilter = array_filter(['vault' => $f['vault'] ?? null, 'risk' => $f['risk'] ?? null, 'type' => $f['type'] ?? null, 'category_group' => $f['group'] ?? null]);
        if ($credFilter) $base->whereIn('credential_id', Credential::where('client_id', $u->client_id)->where($credFilter)->select('id'));
        $day = fn (string $d, bool $end) => Carbon::createFromFormat('Y-m-d', $d, $tz)->{$end ? 'endOfDay' : 'startOfDay'}()->utc();
        if (!empty($f['shared_from']))  $base->where('created_at', '>=', $day($f['shared_from'], false));
        if (!empty($f['shared_to']))    $base->where('created_at', '<=', $day($f['shared_to'], true));
        if (!empty($f['expires_from'])) $base->where('expires_at', '>=', $day($f['expires_from'], false));
        if (!empty($f['expires_to']))   $base->where('expires_at', '<=', $day($f['expires_to'], true));

        $dir = $f['dir'] ?? null;
        match ($f['sort'] ?? 'status') {
            'shared_at'  => $base->orderBy('created_at', $dir ?? 'desc'),
            'expires_at' => $base->orderByRaw('expires_at is null')->orderBy('expires_at', $dir ?? 'asc'),
            'name'       => $base->orderBy(Credential::select('name')->whereColumn('credvault_credentials.id', 'credvault_shares.credential_id')->limit(1), $dir ?? 'asc'),
            default      => $base->orderByRaw('case when revoked_at is not null then 3 when expires_at is not null and expires_at <= ? then 2 when expires_at is not null and expires_at < ? then 0 else 1 end', [now(), $soon]),
        };
        $base->orderByDesc('created_at')->orderByDesc('id');

        $page = $base->with(['credential:id,code,vault,name,type,risk,url,username,category_group,created_at,updated_at', 'recipientUser:id,name,designation,branch_id', 'recipientUser.branch:id,name', 'recipientDepartment:id,name'])
            ->paginate($f['per_page'] ?? self::PAGE_SIZE, ['*'], 'page', $f['page'] ?? 1);
        $from = ($page->currentPage() - 1) * $page->perPage();

        return response()->json([
            'status'  => true,
            'data'    => collect($page->items())->values()->map(fn ($s, $i) => ['sr_no' => $from + $i + 1] + $this->shareRow($s, $u->client_id, $tz, $u))->values(),
            'tabs'    => $tabs,
            'filters' => array_filter(array_intersect_key($f, array_flip(['tab', 'q', 'credential_id', 'permission', 'recipient_type', 'recipient_id', 'vault', 'risk', 'type', 'group',
                'shared_from', 'shared_to', 'expires_from', 'expires_to', 'sort', 'dir'])), fn ($v) => $v !== null && $v !== ''),
            'meta'    => $this->pageMeta($page),
        ], 200);
    }

    /** The Shared By Me search: credential ID / name / group / type, person, team, reason, permission label. */
    protected function shareSearch(Builder $base, User $u, ?string $term): void
    {
        if ($term === null || trim($term) === '') return;
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

    /** DELETE /credvault/shares/{id} — revoke. The row stays as the record of who had access. */
    public function revokeShare(Request $request, int $id)
    {
        $u = $this->tenantUser($request);

        $share = CredentialShare::where('client_id', $u->client_id)->with('credential')->find($id)
            ?? $this->reject('Share not found.', null, 404);
        $c = $share->credential;
        $allowed = $c && ($c->owner_id === $u->id || $share->shared_by === $u->id
            || ($c->scope === 'team' && in_array($this->accessMap(collect([$c]), $u)[$c->id][1] ?? null, ['admin', 'branch', 'manager', 'hod'], true)));
        if (!$allowed) $this->reject('Only the owner, the person who shared it, a Vault Admin or a manager above the owner can revoke this share.', null, 403);

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
        $fresh->load(['credential:id,code,name,type,risk,url,category_group,updated_at', 'recipientUser:id,name,designation,branch_id', 'recipientUser.branch:id,name', 'recipientDepartment:id,name']);

        return response()->json(['status' => true, 'message' => 'Access revoked.', 'data' => $this->shareRow($fresh, $u->client_id)], 200);
    }

    /* ════════════════════════════ TEAM VAULT ════════════════════════════ */

    /** The prototype's six levels, in display order. */
    protected const LEVELS = [
        'admin'  => 'Admin',
        'hod'    => 'HOD',
        'tl'     => 'Team Lead',
        'exec'   => 'Executive',
        'emp'    => 'Employee',
        'intern' => 'Intern',
    ];

    /** A member's level, read from the HR designation (Head of Department, Team Leader, Executive, Intern / Trainee …). */
    protected function levelOf(?string $designation): string
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

        $branch = $this->teamBranchOf($u);
        $levels = $this->levelCounts($u->client_id, $branch);
        $creds  = Credential::where('client_id', $u->client_id)->where('scope', 'team')
            ->when($branch !== null, fn ($q) => $q->where('branch_id', $branch))
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
     * Members come flat (each with manager_employee_id and a level) and as `tree`, ready to draw:
     * the Vault Admin at the root, then each member under their manager — a member whose manager
     * sits outside the set hangs from the root (in the organisation view, from their department's
     * node). Every node carries children_count (direct reports, the "2 ▾" badge) and team_size.
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

    protected function hierarchy(User $u, ?Departments $dep): array
    {
        $branch = $this->teamBranchOf($u);
        $emps = $this->onTeam(Employee::where('employees.client_id', $u->client_id))
            ->when($branch !== null, fn ($q) => $q->where('employees.branch_id', $branch))
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
        $admins = User::whereIn('id', $this->adminIds($u->client_id))->orderBy('id')->get(['id', 'name']);
        $counts = ['admin' => $admins->count()] + $counts;   // the department's "Admin" chip: the Vault Admin(s)

        $creds = Credential::where('client_id', $u->client_id)->where('scope', 'team')
            ->when($branch !== null, fn ($q) => $q->where('branch_id', $branch))
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
            'tree'    => $this->hierarchyTree($members, $admins, $dep),
        ];
    }

    /** The members as nested nodes under the Vault Admin; cycle-safe, children ordered by level then name. */
    protected function hierarchyTree(Collection $members, Collection $admins, ?Departments $dep): array
    {
        $rank = array_flip(array_keys(self::LEVELS));
        $kids = $members->groupBy(fn ($m) => $m['manager_employee_id'] ?? 0);
        $seen = [];
        $build = function (array $m) use (&$build, $kids, $rank, &$seen): array {
            $seen[$m['employee_id']] = true;
            $children = collect($kids[$m['employee_id']] ?? [])->reject(fn ($c) => isset($seen[$c['employee_id']]))
                ->sortBy([fn ($a, $b) => ($rank[$a['level']] ?? 9) <=> ($rank[$b['level']] ?? 9), fn ($a, $b) => strcasecmp($a['name'], $b['name'])])
                ->map(fn ($c) => $build($c))->values()->all();

            return ['type' => 'member', 'employee_id' => $m['employee_id'], 'user_id' => $m['user_id'], 'name' => $m['name'], 'initials' => $m['initials'],
                    'designation' => $m['designation'], 'level' => $m['level'], 'level_label' => $m['level_label'], 'department' => $m['department'],
                    'children_count' => count($children), 'team_size' => array_sum(array_map(fn ($c) => 1 + $c['team_size'], $children)), 'children' => $children];
        };
        $sortRoots = fn ($c) => $c->sortBy([fn ($a, $b) => ($rank[$a['level']] ?? 9) <=> ($rank[$b['level']] ?? 9), fn ($a, $b) => strcasecmp($a['name'], $b['name'])]);
        $roots = $sortRoots(collect($kids[0] ?? []));

        if ($dep) {
            $children = $roots->map(fn ($m) => $build($m))->values()->all();
        } else {
            // The organisation: a node per department between the Vault Admin and its people.
            $children = $roots->groupBy(fn ($m) => $m['department']['id'])->map(function ($g) use ($build, $members) {
                $nodes = $g->map(fn ($m) => $build($m))->values()->all();
                $d = $g->first()['department'];
                return ['type' => 'department', 'department_id' => $d['id'], 'name' => $d['name'], 'initials' => $this->initials($d['name']),
                        'members' => $members->where('department.id', $d['id'])->count(),
                        'children_count' => count($nodes), 'team_size' => array_sum(array_map(fn ($c) => 1 + $c['team_size'], $nodes)), 'children' => $nodes];
            })->sortBy('name', SORT_NATURAL | SORT_FLAG_CASE)->values()->all();
        }
        $a = $admins->first();

        return ['type' => 'admin', 'user_id' => $a?->id, 'name' => $a?->name ?? 'Vault Admin', 'initials' => $this->initials($a?->name ?? 'Vault Admin'),
                'designation' => 'Vault Administrator', 'level' => 'admin', 'level_label' => self::LEVELS['admin'] ?? 'Admin',
                'children_count' => count($children), 'team_size' => array_sum(array_map(fn ($c) => ($c['type'] === 'department' ? 0 : 1) + $c['team_size'], $children)),
                'children' => $children];
    }

    /** [department_id => [level => active members]] for the tenant, in one query. */
    /**
     * Team Details for a Branch Admin (branch_user) covers only their own branch — a client with two
     * branches must not show branch A's admin the employees of branch B. Everyone else: null (no branch
     * filter; a client admin sees every branch, a manager is narrowed to their reporting line client-side).
     * A branch_user with no branch on file gets 0, which matches nobody, rather than the whole company.
     */
    protected function teamBranchOf(User $u): ?int
    {
        return $u->user_type === 'branch_user' ? (int) ($u->branch_id ?? 0) : null;
    }

    /**
     * Team Details shows only people actually on the team (CS-1447): Active, onboarding finished
     * (all 6 HR stages — the app-wide rule Announcements and Attendance use), and not exited. The
     * exit guard mirrors ExitController: a finished exit (Closed / Exited, not rehired) whose
     * employees.status was never written back still counts as gone.
     */
    protected function onTeam(Builder $q): Builder
    {
        return $q->where('employees.status', 'Active')
            ->where('employees.onboarding_stage_completed', '>=', 6)
            ->whereDoesntHave('exit', fn ($x) => $x->whereNull('rehired_at')
                ->where(fn ($w) => $w->where('exit_case_status', 'Closed')->orWhere('final_employee_status', 'Exited')));
    }

    protected function levelCounts(int $clientId, ?int $branchId = null): array
    {
        return $this->memo("levels:{$clientId}:" . ($branchId ?? 'all'), function () use ($clientId, $branchId) {
            $rows = $this->onTeam(Employee::where('employees.client_id', $clientId))->whereNotNull('employees.department_id')
                ->when($branchId !== null, fn ($q) => $q->where('employees.branch_id', $branchId))
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

    protected function levelList(array $counts): array
    {
        return collect(self::LEVELS)->map(fn ($label, $key) => ['level' => $key, 'label' => $label, 'count' => $counts[$key] ?? 0])
            ->filter(fn ($l) => $l['count'] > 0)->values()->all();
    }

    /* ═════════════════════════ ACCESS REQUESTS ═════════════════════════ */

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

        $tab  = $f['tab'] ?? 'all';
        $per  = $f['per_page'] ?? self::PAGE_SIZE;
        $pg   = $f['page'] ?? 1;
        $term = mb_strtolower(trim((string) ($f['q'] ?? '')));

        // The tab counts follow the search: each badge is what that tab lists for the term typed.
        $matched = $term === '' ? $issues : $issues->filter(fn ($i) => str_contains(mb_strtolower(implode(' ', [
            $i['credential']['code'], $i['credential']['name'], $i['credential']['type_label'], $i['credential']['category_group'],
            $i['credential']['owner'], $i['issue'],
        ])), $term))->values();
        $tabs = ['all' => $matched->count()];
        foreach (self::HEALTH_TYPES as $t) $tabs[$t] = $matched->where('type', $t)->count();
        $resolved = AuditLog::where('client_id', $u->client_id)->where('action', 'health_fixed')
            ->where(fn ($w) => $w->where('user_id', $u->id)->orWhereIn('credential_id', $creds->pluck('id')->all()));
        if ($term !== '') {
            $like = $this->likeTerm($term);
            $resolved->where(fn ($w) => $w->whereRaw('lower(coalesce(credential_name, \'\')) like ?', [$like])
                ->orWhereRaw('lower(coalesce(credential_code, \'\')) like ?', [$like])
                ->orWhereRaw('lower(coalesce(detail, \'\')) like ?', [$like]));
        }
        $tabs['fixed'] = (clone $resolved)->count();

        if ($tab === 'fixed') {
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
            $list = $matched->when($tab !== 'all', fn ($c) => $c->where('type', $tab))->values();
            $data = $list->slice(($pg - 1) * $per, $per)->values();
            $meta = ['current_page' => $pg, 'per_page' => $per, 'total' => $list->count(), 'last_page' => max(1, (int) ceil($list->count() / $per))];
        }

        return response()->json([
            'status'  => true,
            'summary' => $this->healthSummary($creds, $issues, $pol),
            'data'    => $data,
            'tabs'    => $tabs,
            'meta'    => $meta,
        ], 200);
    }

    /**
     * GET /credvault/health/summary — the score card and the five issue cards
     * alone, without the list: how many credentials passed and failed, and of
     * the failed ("need attention") how many are weak, reused, missing 2FA,
     * rotation due and over-shared.
     */
    public function healthSummaryView(Request $request)
    {
        $u = $this->tenantUser($request);
        $pol = Policy::for($u->client_id);
        $creds = $this->healthScope($u);

        return response()->json(['status' => true, 'data' => $this->healthSummary($creds, collect($this->healthIssues($creds, $pol, $u)), $pol)], 200);
    }

    /**
     * GET /credvault/health/attention?type=all|weak|reused|twofa|rotation|shared&q=&page=&per_page=
     *
     * The credentials that need attention — one row per credential (the list
     * on /health is one row per issue), each with every issue it has. type
     * keeps the credentials with that issue; counts are per credential.
     */
    public function healthAttention(Request $request)
    {
        $u = $this->tenantUser($request);
        $f = $request->validate($this->listRules(array_merge(['all'], self::HEALTH_TYPES)));
        $pol = Policy::for($u->client_id);
        $creds = $this->healthScope($u);
        $issues = collect($this->healthIssues($creds, $pol, $u));

        $rows = $issues->groupBy('credential.id')->map(function (Collection $list) {
            $types = $list->pluck('type')->unique()->values()->all();
            $sev = $list->pluck('severity')->sortBy(fn ($s) => self::SEVERITY_RANK[$s] ?? 9)->first();
            return [
                'credential'  => $list->first()['credential'],
                'can_fix'     => $list->first()['can_fix'],
                'issue_count' => $list->count(),
                'types'       => $types,
                'severity'    => $sev,
                'issues'      => $list->map(fn ($i) => array_intersect_key($i, array_flip(['type', 'severity', 'issue', 'detail', 'details', 'action'])))->values()->all(),
            ];
        })->sortBy(fn ($r) => [self::SEVERITY_RANK[$r['severity']] ?? 9, -$r['issue_count'], $r['credential']['code']])->values();

        $tab  = $f['tab'] ?? 'all';
        $term = mb_strtolower(trim((string) ($f['q'] ?? '')));
        // The tab counts follow the search, like the list.
        $matched = $term === '' ? $rows : $rows->filter(fn ($r) => str_contains(mb_strtolower(implode(' ', [
            $r['credential']['code'], $r['credential']['name'], $r['credential']['type_label'], $r['credential']['owner'],
            implode(' ', array_column($r['issues'], 'issue')),
        ])), $term))->values();
        $counts = ['all' => $matched->count()];
        foreach (self::HEALTH_TYPES as $t) $counts[$t] = $matched->filter(fn ($r) => in_array($t, $r['types'], true))->count();

        $list = $matched->when($tab !== 'all', fn ($c) => $c->filter(fn ($r) => in_array($tab, $r['types'], true)))->values();
        $per = $f['per_page'] ?? self::PAGE_SIZE;
        $pg  = $f['page'] ?? 1;

        return response()->json([
            'status' => true,
            'data'   => $list->slice(($pg - 1) * $per, $per)->values(),
            'tabs'   => $counts,
            'meta'   => ['current_page' => $pg, 'per_page' => $per, 'total' => $list->count(), 'last_page' => max(1, (int) ceil($list->count() / $per))],
        ], 200);
    }

    protected const HEALTH_TYPES = ['weak', 'reused', 'twofa', 'rotation', 'shared'];
    protected const SEVERITY_RANK = ['critical' => 0, 'high' => 1, 'medium' => 2];

    /**
     * The score card and the five cards. Passed = a credential with no open
     * issue, failed = one with at least one ("need attention"). Each type is
     * counted per credential and out of the credentials that check applies to:
     *   weak, reused   — credentials with a password
     *   twofa          — credentials whose risk level the policy requires 2FA for (2FA not "N/A")
     *   rotation       — credentials with a password and a rotation period
     *   shared         — every credential checked
     * A credential can fail several checks, so the five add up to more than
     * `failed`; `attention.multiple` is how many fail more than one.
     */
    protected function healthSummary(Collection $creds, Collection $issues, array $pol): array
    {
        $total   = $creds->count();
        $risky   = $issues->pluck('credential.id')->unique();
        $failed  = $risky->count();
        $passed  = $total - $failed;
        $score   = $total ? (int) round($passed / $total * 100) : 100;
        $pct     = fn ($n, $of) => $of ? (int) round($n / $of * 100) : 0;
        $withPw  = $creds->where('has_password', true);
        $of = [
            'weak'     => $withPw->count(),
            'reused'   => $withPw->count(),
            'twofa'    => $creds->filter(fn ($c) => $c->twofa !== 'na' && in_array($c->risk, $pol['twofa_risks'], true))->count(),
            'rotation' => $withPw->filter(fn ($c) => (int) $c->rotation_days > 0)->count(),
            'shared'   => $total,
        ];
        $card = [
            'weak'     => ['Weak passwords', 'passwords below policy'],
            'reused'   => ['Reused passwords', 'share a password'],
            'twofa'    => ['Missing 2FA', 'credentials that need 2FA have it off'],
            'rotation' => ['Rotation due', 'passwords past or near policy age'],
            'shared'   => ['Over-shared', 'credentials shared too widely'],
        ];
        $perCred = $issues->groupBy('credential.id')->map(fn ($l) => $l->pluck('type')->unique()->count());

        $cards = [];
        foreach (self::HEALTH_TYPES as $t) {
            $ofType = $issues->where('type', $t);
            $n = $ofType->pluck('credential.id')->unique()->count();
            $cards[$t] = [
                'key' => $t, 'label' => $card[$t][0],
                'failed'      => $n,
                'passed'      => max(0, $of[$t] - $n),
                'of'          => $of[$t],
                'pct'         => $pct($n, $of[$t]),
                'issues'      => $ofType->count(),
                'critical'    => $ofType->where('severity', 'critical')->count(),
                'sub'         => "{$n} of {$of[$t]} {$card[$t][1]}",
                // Share of the credentials that need attention.
                'pct_of_attention' => $pct($n, $failed),
            ];
        }

        return [
            'score'           => $score,
            'level'           => $score >= 80 ? 'Good' : ($score >= 60 ? 'Fair' : 'At risk'),
            'checked'         => $total,
            'total'           => $total,
            'passed'          => $passed,
            'failed'          => $failed,
            'with_passwords'  => $withPw->count(),
            'open_issues'     => $issues->count(),
            'at_risk'         => $failed,
            'critical_issues' => $issues->where('severity', 'critical')->count(),
            // "Strong & safe": credentials with no open issue.
            'safe'            => $passed,
            'pct'             => [
                'passed'          => $pct($passed, $total),
                'failed'          => $pct($failed, $total),
                'with_passwords'  => $pct($withPw->count(), $total),
                'at_risk'         => $pct($failed, $total),
                'critical_issues' => $pct($issues->where('severity', 'critical')->count(), $issues->count()),
                'safe'            => $pct($passed, $total),
            ],
            'attention'       => [
                'total'      => $failed,
                'issues'     => $issues->count(),
                'single'     => $perCred->filter(fn ($n) => $n === 1)->count(),
                'multiple'   => $perCred->filter(fn ($n) => $n > 1)->count(),
                'by_type'    => collect($cards)->mapWithKeys(fn ($c, $t) => [$t => $c['failed']])->all(),
                'label'      => "{$failed} need attention",
                'note'       => $failed && $perCred->filter(fn ($n) => $n > 1)->count()
                    ? 'A credential can have more than one issue, so the five counts add up to more than ' . $failed . '.'
                    : null,
            ],
            'cards'           => array_values($cards),
        ];
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
    protected function policyWarnings(array $pol): array
    {
        return !$pol['cp_admin'] && !$pol['cp_manager'] && !$pol['cp_otp']
            ? [['key' => 'critical_unprotected', 'section' => 'critical', 'message' => 'With every check off, critical credentials open without any approval.']]
            : [];
    }

    /**
     * Each card's insight box and the "Live in your vault" numbers the
     * prototype prints under it (polStats / polInsightHtml).
     */
    protected function policyInsights(User $u, array $pol): array
    {
        $creds   = $this->healthScope($u);
        $pw      = $creds->where('has_password', true);
        $issues  = collect($this->healthIssues($creds, $pol));
        $shares  = $this->liveShareCounts($creds->pluck('id')->all());
        $bin     = $this->binQuery($u)->orderBy('deleted_at')->select(['id', 'code', 'name', 'risk', 'deleted_at'])->selectRaw(self::BIN_BRANCH_SQL . ' as bin_branch')->get();
        $admin   = $this->isAdmin($u);
        $reqs    = AccessRequest::where('client_id', $u->client_id)
            ->when(!$admin, fn ($q) => $q->where(fn ($w) => $w->where('requester_id', $u->id)->orWhere('admin_user_id', $u->id)->orWhere('manager_user_id', $u->id)));
        $required = $creds->whereIn('risk', $pol['twofa_risks']);
        $critIds  = $creds->where('risk', 'critical')->pluck('id')->all();
        $soonBin  = $bin->filter(fn ($c) => $c->deleted_at->copy()->addDays(Policy::binDays($pol, $c->bin_branch))->lte(now()->addDays(7)));

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
                    'purges_at' => $c->deleted_at->copy()->addDays(Policy::binDays($pol, $c->bin_branch))->toIso8601String(),
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

    protected function policyHistoryStats(User $u): array
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

    /** The audit screens show the company's local time unless the viewer sends `tz`. */
    protected const AUDIT_TZ = 'Asia/Kolkata';

    /**
     * GET /credvault/audit-logs?tab=all|mine|team|alerts&range=24h|7d|30d|all|custom&from=&to=&tz=&action=&credential_id=&q=&page=&per_page=
     *
     * Tabs: All Activity · My Activity · Team Activity (everyone else the viewer may see) ·
     * Security Alerts (critical events). Who sees what: a Vault Admin the whole company; a
     * Branch Admin their branch's people; a manager their reporting line (HOD → TL → Employee
     * → Intern); everyone their own events and the events on credentials they own.
     *
     * The tab counts and the summary follow the time range and the search — switching tab
     * narrows only the timeline. `groups` heads the timeline by day ("Today · 05/11/2026 ·
     * 15 events"), counted over every page; times are the viewer's (`tz`, default India).
     */
    public function auditLogs(Request $request)
    {
        $u = $this->tenantUser($request);
        $f = $request->validate($this->auditRules(), $this->auditMessages());
        $f['tz'] ??= self::AUDIT_TZ;
        $ranged = $this->auditQuery($u, array_diff_key($f, array_flip(['tab', 'page', 'per_page'])));

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
        $rows = $this->eventRows(collect($page->items()), $u, $f['tz']);

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
                'range'           => ['range' => $f['range'] ?? '30d', 'from' => $f['from'] ?? null, 'to' => $f['to'] ?? null, 'tz' => $f['tz']],
            ],
            'data'    => $rows,
            'groups'  => $this->auditDayGroups($u, $f, $rows->pluck('date')->unique()->values()->all()),
            'tabs'    => $tabs,
            'meta'    => $this->pageMeta($page),
        ], 200);
    }

    /**
     * The timeline's day headers for the days on this page: date, "Today" / "Yesterday" /
     * "Tuesday, 03/11/2026", and the day's event count over the whole filtered view.
     */
    protected function auditDayGroups(User $u, array $f, array $dates): array
    {
        if (!$dates) return [];
        $tz = $f['tz'];
        $day = "to_char((credvault_audit_logs.created_at AT TIME ZONE 'UTC') AT TIME ZONE ?, 'YYYY-MM-DD')";
        $counts = $this->auditQuery($u, $f)->selectRaw("{$day} as d, count(*) as n", [$tz])
            ->whereRaw("{$day} in (" . implode(',', array_fill(0, count($dates), '?')) . ')', array_merge([$tz], $dates))
            ->groupBy('d')->pluck('n', 'd');
        $today = now($tz)->toDateString();
        $yday  = now($tz)->subDay()->toDateString();

        return array_map(function ($d) use ($counts, $today, $yday) {
            $c = Carbon::createFromFormat('Y-m-d', $d);
            $n = (int) ($counts[$d] ?? 0);
            return [
                'date' => $d, 'date_display' => $c->format('d/m/Y'),
                'label' => $d === $today ? 'Today' : ($d === $yday ? 'Yesterday' : $c->format('l')),
                'heading' => ($d === $today ? 'Today' : ($d === $yday ? 'Yesterday' : $c->format('l') . ',')) . ' ' . $c->format('d/m/Y'),
                'events' => $n, 'events_label' => $n . ' ' . Str::plural('event', $n),
            ];
        }, $dates);
    }

    /**
     * GET /credvault/audit-logs/export?format=csv|xlsx + the list's filters (tab, range, from, to, tz, q, action,
     * credential_id) — Export Logs: exactly the view on screen, every event (up to 10,000), in the viewer's time.
     */
    public function exportAuditLogs(Request $request)
    {
        $u = $this->tenantUser($request);
        $f = $request->validate($this->auditRules() + ['format' => ['nullable', Rule::in(['csv', 'xlsx'])]], $this->auditMessages());
        $f['tz'] ??= self::AUDIT_TZ;
        $fmt = $f['format'] ?? 'csv';

        $rows = $this->auditQuery($u, $f)->with('user:id,name')->orderByDesc('created_at')->orderByDesc('id')->limit(10000)->get();
        if ($rows->isEmpty()) $this->reject('There are no events in this view to export.', null, 422);
        $this->userInfo($rows->pluck('user_id')->filter()->unique()->all());
        $risks = Credential::withTrashed()->whereIn('id', $rows->pluck('credential_id')->filter()->unique()->all())->pluck('risk', 'id');

        $cols = ['Event ID', 'Date', 'Time', 'User', 'Role', 'Action', 'Credential ID', 'Credential', 'Risk', 'Details', 'Module', 'Severity', 'IP'];
        $data = $rows->map(function ($e) use ($f, $risks) {
            $t = $e->created_at->copy()->setTimezone($f['tz']);
            return [
                'Event ID'      => 'EVT-' . $e->id,
                'Date'          => $t->format('d/m/Y'),
                'Time'          => $t->format('H:i:s'),
                'User'          => $e->user?->name ?? 'System',
                'Role'          => $e->user_id ? ($this->userInfo([$e->user_id])[$e->user_id]['role_line'] ?? '') : 'CredVault',
                'Action'        => AuditLog::ACTIONS[$e->action][0] ?? $e->action,
                'Credential ID' => $e->credential_code,
                'Credential'    => $e->credential_name ?? 'Vault settings',
                'Risk'          => isset($risks[$e->credential_id]) ? ucfirst($risks[$e->credential_id]) : '',
                'Details'       => $e->detail,
                'Module'        => $e->module,
                'Severity'      => AuditLog::SEVERITY_LABELS[$e->severity] ?? $e->severity,
                'IP'            => $e->ip,
            ];
        })->all();
        $body = $fmt === 'xlsx'
            ? VaultFile::xlsx([['name' => 'Audit Logs', 'head' => true, 'freeze' => true, 'widths' => [12, 11, 9, 24, 26, 20, 14, 30, 10, 50, 18, 10, 14],
                'rows' => array_merge([$cols], array_map('array_values', $data))]])
            : VaultFile::build($cols, $data, 'csv');

        // The log leaving the system is itself on the record (as info — it carries no secret).
        $this->writeAudit($u->client_id, $u->id, $u->branch_id, 'export', null, 'Audit log exported · ' . $rows->count() . ' events', ['rows' => $rows->count(), 'kind' => 'audit_log'], 'Audit Logs', 'info');
        $tab = ['all' => 'all-activity', 'mine' => 'my-activity', 'team' => 'team-activity', 'alerts' => 'security-alerts'][$f['tab'] ?? 'all'];

        return $this->download($body, "credvault-audit-log-{$tab}-" . now($f['tz'])->format('Ymd') . ".{$fmt}", $this->mime($fmt), ['X-CredVault-Count' => (string) $rows->count()]);
    }

    /* ══════════════════════════ IMPORT & RECOVERY ══════════════════════════ */

    /** The sample file's two rows, and the extra rows "Try it with sample data" adds — the prototype's IR_EXAMPLE / irTry. */
    protected const IMPORT_EXAMPLE = [
        ['Zoho Books Admin', 'https://books.zoho.in', 'admin@inorbvict.com', 'Zoho#Books2026!', 'Finance', 'Main accounting login'],
        ['Canva Team', 'https://www.canva.com', 'design@inorbvict.com', 'Canva!Team#2026x', 'Marketing', 'Shared design workspace'],
    ];
    protected const IMPORT_TRY_EXTRA = [
        ['Old Intranet', 'http://intranet.local', 'admin', 'admin@123', 'IT', 'Legacy server'],
        ['Practo Doctor Portal', 'https://practo.com', 'clinic@inhpl.com', 'Pr@cto_Clinic26!', 'Healthcare', ''],
        ['Tally Backup FTP', 'ftp://backup.inorbvict.com', 'tally_bk', '', 'IT', 'Password not stored'],
    ];
    protected const IMPORT_COLUMNS = ['name', 'url', 'username', 'password', 'category', 'notes'];

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
        if ($request->filled('type')) return $this->importPreviewTyped($request, $u);
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

    /** Set while an import saves its rows: a weak password is imported (and counted), a file the sheet cannot carry is attached later. */
    protected bool $importing = false;

    /**
     * POST /credvault/imports/preview  (multipart: type, file) — Import by category.
     *
     * type is one of the 25 forms. The file is that type's sheet (the sample's layout): an
     * .xlsx is read at the tab named for the type (or its first tab), a CSV as it is. Every
     * row is checked exactly as the type's Add form checks it — required fields, web
     * addresses, emails, phones, dates, the select lists, card number and expiry, IFSC,
     * CVV / PIN, seed phrases, setup keys, lengths, name, risk, rotation — and nothing is
     * saved. Rows that fail come back in `failed` with the sheet row number and each
     * reason; the rest are parked behind a token for POST /imports. No secret is returned.
     *
     * Flags on a valid row: dup (a credential of this type and name is already yours),
     * dupfile (the name repeats in the file), weak (a password below the policy minimum —
     * still importable, counted as weak). selected = valid and not a duplicate.
     */
    protected function importPreviewTyped(Request $request, User $u)
    {
        $d = $request->validate([
            'type' => ['required', Rule::in(array_keys(Credential::TYPES))],
            'file' => ['required', 'file', 'max:5120', 'extensions:xlsx,csv,tsv,txt'],
        ], ['type.in' => 'Choose one of the 25 credential types.', 'file.required' => 'Choose a file to import.',
            'file.extensions' => 'Upload the Excel (.xlsx) or CSV sheet of this category — download the sample to see the layout.']);
        $type = $d['type'];
        $def  = Credential::typeDef($type);
        $file = $request->file('file');
        $ext  = strtolower($file->getClientOriginalExtension());

        try {
            $sheet = '';
            if ($ext === 'xlsx') {
                $sheets = VaultFile::xlsxSheets($file->getRealPath());
                $named  = collect(array_keys($sheets))->first(fn ($n) => ImportTemplate::typeOfSheet($n) === $type);
                $other  = collect(array_keys($sheets))->first(fn ($n) => ($t = ImportTemplate::typeOfSheet($n)) && $t !== $type);
                if (!$named && $other && count($sheets) > 2) {
                    $this->reject("This workbook has no “" . ImportTemplate::sheetName($type) . "” tab. Pick the category of the tab you filled, or upload that tab's sheet.", 'file');
                }
                [$sheet, $raw] = VaultFile::readXlsxSheet($file->getRealPath(), fn ($n) => $named ? $n === $named : ImportTemplate::norm($n) !== ImportTemplate::norm('How to fill'));
            } else {
                $raw = VaultFile::read($file->getRealPath(), $ext);
            }
        } catch (\RuntimeException $e) {
            $this->reject($e->getMessage(), 'file');
        }
        if (!$raw) $this->reject('The sheet has no rows to import. Add one credential per row under the header.', 'file');

        [$map, $missing, $unknown] = ImportTemplate::mapHeaders($type, array_keys($raw[0]));
        if ($missing) {
            $this->reject("The sheet is not a {$def['label']} sheet — missing column" . (count($missing) > 1 ? 's' : '') . ': ' . implode(', ', $missing)
                . '. Download the sample for this category and keep its header row.', 'file');
        }

        $pol  = Policy::for($u->client_id);
        $cols = collect(ImportTemplate::columns($type))->keyBy('key');
        $mine = Credential::where('client_id', $u->client_id)->where('owner_id', $u->id)->where('type', $type)->get(['id', 'code', 'name'])
            ->keyBy(fn ($c) => Str::lower(trim($c->name)));
        $metaRules = array_intersect_key($this->credentialRules(true), array_flip(['name', 'risk', 'rotation_days', 'notes', 'reg_email', 'reg_phone', 'recovery_key']));
        $metaRules['risk'] = ['nullable', Rule::in(['low', 'medium', 'high'])];
        $label = fn (string $k) => $k === 'name' ? ImportTemplate::NAME : ($cols[$k]['label'] ?? ($cols[str_replace('fields.', '', $k)]['label'] ?? $k));

        $this->importing = true;
        $seen = [];
        $rows = [];
        foreach ($raw as $i => $r) {
            $p = ImportTemplate::toPayload($type, $r, $map);
            $errors = [];
            $v = Validator::make($p, $metaRules, [
                'name.required' => 'Enter the Credential Name.', 'name.min' => 'The Credential Name needs at least 2 characters.',
                'risk.in' => 'Risk is Low, Medium or High.', 'rotation_days.in' => 'Rotation is 30, 60, 90 or 180 days.',
                'reg_phone.regex' => 'Enter a phone number of 10 to 16 digits.', 'reg_email.email' => 'Enter a valid Registered Email.',
            ]);
            foreach ($v->errors()->messages() as $k => $m) $errors[] = ['field' => $k, 'label' => $label($k), 'message' => $m[0]];
            try {
                $fields = $this->validateTypeFields($def, array_diff_key($p['fields'], ['twofa' => 1]), [], $request, null);
            } catch (ValidationException $e) {
                $fields = [];
                foreach ($e->errors() as $k => $m) $errors[] = ['field' => str_replace('fields.', '', $k), 'label' => $label(str_replace('fields.', '', $k)), 'message' => $m[0]];
            }

            $name  = trim((string) ($p['name'] ?? ''));
            $key   = Str::lower($name);
            $dupOf = $name !== '' ? $mine->get($key) : null;
            $flags = [];
            if ($dupOf) $flags[] = 'dup';
            elseif ($name !== '' && isset($seen[$key])) $flags[] = 'dupfile';
            if ($name !== '') $seen[$key] = true;
            $secret   = $def['sec'] ? ($fields[$def['sec']] ?? null) : null;
            $strength = Credential::secretIsPassword($type) && $secret ? Credential::strengthOf($secret) : null;
            if ($strength !== null && $strength < $pol['min_strength']) $flags[] = 'weak';
            $valid = !$errors;
            $notes = array_map(fn ($f) => "Attach the {$f['label']} in the form after the import.", array_filter(ImportTemplate::fileFields($type), fn ($f) => $f['required']));

            $rows[] = [
                'index' => $i, 'row' => $i + 2, 'name' => Str::limit($name, 150, ''), 'status' => $valid ? 'valid' : 'failed',
                'errors' => $errors, 'flags' => $flags, 'notes' => $valid ? array_values($notes) : [],
                'strength' => $strength !== null ? (Credential::STRENGTH_LABELS[$strength] ?? null) : null,
                'dup_of' => $dupOf ? ['id' => $dupOf->id, 'code' => $dupOf->code, 'name' => $dupOf->name] : null,
                'selected' => $valid && !array_intersect($flags, ['dup', 'dupfile']),
                'payload' => $p,
            ];
        }
        $this->importing = false;

        $token  = Str::random(40);
        $format = $ext === 'txt' ? 'tsv' : $ext;
        Cache::put($this->importCacheKey($u, $token), Crypt::encrypt(['typed' => true, 'type' => $type, 'rows' => $rows,
            'file_name' => $file->getClientOriginalName(), 'format' => $format, 'source' => ImportTemplate::sheetName($type) . ' sheet']), self::IMPORT_TTL);
        $c = collect($rows);
        $public = fn ($r) => collect($r)->except('payload')->all();

        return response()->json(['status' => true, 'data' => [
            'token'        => $token,
            'expires_in'   => self::IMPORT_TTL,
            'type'         => $type,
            'type_label'   => $def['label'],
            'file_name'    => $file->getClientOriginalName(),
            'sheet'        => $sheet ?: null,
            'format'       => $format,
            'format_label' => Transfer::FORMAT_LABELS[$format] ?? strtoupper($format),
            'columns'      => ['matched' => $map, 'ignored' => $unknown],
            'stats'        => [
                'rows'       => $c->count(),
                'valid'      => $c->where('status', 'valid')->count(),
                'failed'     => $c->where('status', 'failed')->count(),
                'duplicates' => $c->filter(fn ($r) => array_intersect(['dup', 'dupfile'], $r['flags']))->count(),
                'weak'       => $c->filter(fn ($r) => in_array('weak', $r['flags'], true))->count(),
                'selected'   => $c->where('selected', true)->count(),
            ],
            'rows'   => $c->map($public)->values(),
            'failed' => $c->where('status', 'failed')->map(fn ($r) => ['row' => $r['row'], 'name' => $r['name'], 'errors' => $r['errors']])->values(),
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

            $result = !empty($payload['typed'])
                ? $this->runTypedImport($u, $d, $payload, $scope, $deptId)
                : $this->runImport($u, $d, $payload, $pol, $scope, $deptId);
            Cache::forget($cacheKey);
        } finally {
            Cache::forget("{$cacheKey}:running");
        }
        return $result;
    }

    /**
     * Import by category: each picked valid row is saved through the type's Add form
     * (persistCredential), so it gets the same code, encryption, strength, risk, audit and
     * checks as one typed in. A row the form still refuses joins the failed list. History
     * counts: imported · skipped (every row not imported) · weak · duplicates · failed.
     */
    protected function runTypedImport(User $u, array $d, array $payload, string $scope, ?int $deptId)
    {
        $picked = array_flip($d['rows']);
        $def    = Credential::typeDef($payload['type']);
        $failed = [];
        $items  = $weak = 0;
        $codes  = [];

        $t = $this->inTransaction('import the credentials', function () use ($u, $d, $payload, $scope, $deptId, $picked, &$failed, &$items, &$weak, &$codes) {
            $this->importing = true;
            try {
                foreach ($payload['rows'] as $row) {
                    if ($row['status'] === 'failed') { $failed[] = ['row' => $row['row'], 'name' => $row['name'], 'errors' => $row['errors']]; continue; }
                    if (!isset($picked[$row['index']])) continue;
                    $isDup = (bool) array_intersect(['dup', 'dupfile'], $row['flags']);
                    if ($isDup && $d['duplicates'] === 'skip') continue;

                    $p = $row['payload'] + ['scope' => $scope] + ($deptId ? ['department_id' => $deptId] : []);
                    if ($isDup) $p['name'] = Str::limit($p['name'], 139, '') . ' (imported)';
                    try {
                        $res = DB::transaction(fn () => $this->persistCredential(Request::create('/', 'POST', $p), $u, null, 'normal'));
                        $codes[] = $res->getData(true)['data']['code'] ?? null;
                        $items++;
                        if (in_array('weak', $row['flags'], true)) $weak++;
                    } catch (ValidationException $e) {
                        $failed[] = ['row' => $row['row'], 'name' => $row['name'], 'errors' => collect($e->errors())->map(fn ($m, $k) => ['field' => str_replace('fields.', '', $k), 'label' => $k, 'message' => $m[0]])->values()->all()];
                    } catch (HttpResponseException $e) {
                        $b = $e->getResponse()->getData(true);
                        $failed[] = ['row' => $row['row'], 'name' => $row['name'], 'errors' => [['field' => array_key_first($b['errors'] ?? []) ?? 'row', 'label' => '', 'message' => $b['message'] ?? 'Could not be imported.']]];
                    }
                }
            } finally {
                $this->importing = false;
            }

            $all = collect($payload['rows']);
            $t = Transfer::create([
                'client_id' => $u->client_id, 'kind' => 'import', 'code' => $this->nextCode('credvault_transfers', 'IM', $u->client_id),
                'user_id' => $u->id, 'scope' => $scope === 'team' ? 'team' : 'mine', 'format' => $payload['format'],
                'file_name' => Str::limit($payload['file_name'], 191, ''), 'source' => Str::limit($payload['source'], 40, ''), 'credential_type' => $payload['type'],
                'items' => $items, 'skipped' => $all->count() - $items, 'weak' => $weak,
                'duplicates' => $all->filter(fn ($r) => array_intersect(['dup', 'dupfile'], $r['flags']))->count(),
                'failed' => count($failed), 'failed_rows' => array_slice($failed, 0, 500),
                'status' => $items ? 'done' : 'failed', 'failure_reason' => $items ? null : 'No row could be imported',
            ]);
            $this->audit($u, 'importx', null, "{$t->code} · {$items} {$payload['type']} credentials imported" . ($failed ? ' · ' . count($failed) . ' failed' : ''),
                ['transfer' => $t->code, 'items' => $items, 'weak' => $weak, 'failed' => count($failed)], 'Import & Recovery');

            return $t;
        });
        $t->load('user:id,name');
        $to = $scope === 'team' ? 'Team Vault' : 'My Vault';

        return response()->json([
            'status'  => (bool) $items,
            'message' => $items
                ? "{$items} {$def['label']} " . Str::plural('credential', $items) . " imported to {$to}" . ($failed ? ' · ' . count($failed) . ' failed — see the failed list' : '')
                    . ($weak ? " · {$weak} with weak passwords — see Password Health" : '') . '.'
                : 'Nothing was imported — every picked row failed. See the failed list.',
            'data'    => $this->transferRow($t, $u) + ['imported_codes' => array_values(array_filter($codes)), 'failed_rows' => $failed],
        ], $items ? 201 : 422);
    }

    protected function runImport(User $u, array $d, array $payload, array $pol, string $scope, ?int $deptId)
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

    /** GET /credvault/imports — Imported Credentials History. */
    public function imports(Request $request)
    {
        return $this->transferHistory($request, 'import');
    }

    /** GET /credvault/imports/{id} — one import, with its failed list (row, name, reasons). */
    public function importShow(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        $t = Transfer::where('client_id', $u->client_id)->where('kind', 'import')
            ->when(!$this->isAdmin($u), fn ($q) => $q->where('user_id', $u->id))->with('user:id,name')->find($id)
            ?? $this->reject('Import not found.', null, 404);

        return response()->json(['status' => true, 'data' => $this->transferRow($t, $u) + ['failed_rows' => $t->failed_rows ?? []]], 200);
    }

    /**
     * GET /credvault/imports/types — the 25 categories the import screen offers, each with its
     * sheet (tab) name, its columns (required, hint, options) and the files attached later.
     */
    public function importTypes(Request $request)
    {
        $this->tenantUser($request);

        return response()->json(['status' => true, 'data' => collect(array_keys(Credential::TYPES))->map(function ($t) {
            $def = Credential::typeDef($t);
            return [
                'key' => $t, 'label' => $def['label'], 'group' => $def['group'], 'icon' => $def['icon'], 'sheet' => ImportTemplate::sheetName($t),
                'columns' => array_map(fn ($c) => array_intersect_key($c, array_flip(['key', 'header', 'label', 'required', 'kind', 'options', 'hint'])), ImportTemplate::columns($t)),
                'attach_later' => ImportTemplate::fileFields($t),
            ];
        })->values(), 'meta' => ['formats' => ['xlsx' => 'Excel', 'csv' => 'CSV'], 'max_rows' => VaultFile::MAX_ROWS, 'max_mb' => 5]], 200);
    }

    /**
     * GET /credvault/imports/sample?format=xlsx|csv&type=&layout=types|simple — Download sample file.
     *
     * layout types (the default) — one sheet per credential type, laid out as that type's form,
     * each with two example rows that pass every check:
     *   xlsx            one workbook: 25 tabs (Login … Outdoor License) and "How to fill"
     *   xlsx + type     that type's tab and "How to fill"
     *   csv + type      that type's sheet as a CSV
     *   csv             a .zip with the 25 CSVs (a CSV has no tabs) and how-to-fill.csv
     * layout simple — the older any-type sample (name, url, username, password, category, notes).
     */
    public function importSample(Request $request)
    {
        $this->tenantUser($request);
        $d = $request->validate([
            'format' => ['nullable', Rule::in(['csv', 'json', 'xlsx'])],
            'type'   => ['nullable', Rule::in(array_keys(Credential::TYPES))],
            'layout' => ['nullable', Rule::in(['types', 'simple'])],
        ], ['type.in' => 'Choose one of the 25 credential types.']);
        $fmt = $d['format'] ?? 'xlsx';

        if (($d['layout'] ?? 'types') === 'types' && $fmt !== 'json') {
            $types = !empty($d['type']) ? [$d['type']] : array_keys(Credential::TYPES);
            $one   = count($types) === 1;
            $base  = $one ? 'credvault-import-sample-' . $types[0] : 'credvault-import-sample';
            if ($fmt === 'xlsx') {
                $sheets = array_map(fn ($t) => ImportTemplate::sheet($t, ImportTemplate::sampleRows($t)), $types);
                $sheets[] = ImportTemplate::guideSheet($types);

                return $this->download(VaultFile::xlsx($sheets), "{$base}.xlsx", $this->mime('xlsx'), ['X-CredVault-Sheets' => (string) count($sheets)]);
            }
            $csv = fn ($t) => VaultFile::csv(array_column(ImportTemplate::columns($t), 'header'),
                array_map(fn ($r) => array_map(fn ($c) => $r[$c['key']] ?? '', ImportTemplate::columns($t)), ImportTemplate::sampleRows($t)));
            if ($one) return $this->download($csv($types[0]), "{$base}.csv", $this->mime('csv'));

            $files = [];
            foreach ($types as $i => $t) $files[sprintf('%02d-%s.csv', $i + 1, Str::slug(ImportTemplate::sheetName($t)))] = $csv($t);
            $guide = ImportTemplate::guideSheet($types)['rows'];
            $files['how-to-fill.csv'] = VaultFile::csv(array_shift($guide), $guide);

            return $this->download(VaultFile::bundle($files), "{$base}-csv.zip", 'application/zip', ['X-CredVault-Sheets' => (string) count($files)]);
        }

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
     * backup's id, date, author and vault. A locked backup is an .xlsx with
     * Excel's own password encryption (AES-256): Excel asks for the password
     * when it opens, no zip. A CSV or JSON file cannot carry a password, so
     * only Excel can be locked. Passwords without a lock would be a
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
        ], ['password.required' => 'Set a password for the backup file, or turn the lock off.', 'password.min' => 'Use 8+ characters with letters, numbers & symbols for the backup password.']);
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
        // The screen's rule: 8+ characters with letters, numbers and a symbol (Good or stronger, D34).
        if ($d['lock'] && $d['format'] !== 'xlsx') {
            $this->reject('A ' . $fmtLabel . ' file cannot hold a password. Choose Excel to lock the backup, or turn the lock off.', 'lock');
        }
        if ($d['lock'] && Credential::strengthOf($d['password']) < 3) {
            $this->reject('Use 8+ characters with letters, numbers & symbols for the backup password.', 'password');
        }
        if ($d['lock'] && $d['password'] !== $d['password_confirmation']) $fail('Passwords did not match', 'password_confirmation');
        if ($d['include_passwords'] && !$d['lock']) {
            if (!filled($d['account_password'] ?? null)) $this->reject('A backup with readable passwords needs your account password. Or lock the file with a password.', 'account_password');
            if (!Hash::check((string) $d['account_password'], $u->password)) $fail('Account password incorrect', 'account_password');
        }

        $creds = $this->fileScope($u, $d['scope']);
        if ($creds->isEmpty()) $this->reject('There are no credentials in this vault to back up.', 'scope');

        [$keys, $rows, $withheld] = $this->backupRows($creds, $d['include_passwords']);
        $typeSheets = $d['format'] === 'xlsx' ? $this->backupTypeSheets($creds, $d['include_passwords']) : [];
        $name  = "credvault-{$d['scope']}-backup-" . now()->format('Ymd');
        // Built inside the transaction below with the code it is recorded under, so the
        // Backup ID in the file always matches the history row.
        $build = fn (string $code) => match ($d['format']) {
            // (xlsx below: the summary, one tab per type in the import layout, About)
            'csv'  => VaultFile::csv(array_values($keys), array_map(fn ($r) => array_values(array_intersect_key(array_replace($keys, $r), $keys)), $rows)),
            'json' => json_encode(['format' => 'CredVault backup', 'id' => $code, 'created' => now()->toIso8601String(), 'by' => $u->name,
                'scope' => $scopeLabel, 'count' => count($rows), 'credentials' => $rows], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            default => VaultFile::xlsx(array_merge([
                ['name' => 'Credentials', 'head' => true, 'freeze' => true,
                    'widths' => array_values(array_map(fn ($k) => ['name' => 28, 'url' => 30, 'username' => 28, 'password' => 22, 'notes' => 30, 'category' => 16][$k] ?? 14, array_keys($keys))),
                    'rows' => array_merge([array_values($keys)], array_map(fn ($r) => array_values(array_intersect_key(array_replace($keys, $r), $keys)), $rows))],
            ], $typeSheets, [
                ['name' => 'About', 'head' => true, 'widths' => [22, 60], 'rows' => [
                    ['CredVault backup', ''], ['Backup ID', $code], ['Created', now()->format('d/m/Y, H:i:s')], ['Created by', $u->name],
                    ['Vault', $scopeLabel], ['Credentials', (string) count($rows)], ['Passwords included', $d['include_passwords'] ? 'Yes' : 'No'],
                    ['Recovery', 'Each type tab uses the import layout: choose that category on Import & Recovery and upload this file to restore it.'],
                ]],
            ])),
        };
        $file = "{$name}.{$d['format']}";
        $body = null;

        $t = $this->inTransaction('record the backup', function () use ($u, $d, $rows, $build, $name, $file, &$body, $fmtLabel, $scopeLabel) {
            $code = $this->nextCode('credvault_transfers', 'BK', $u->client_id);
            $body = $build($code);
            if ($d['lock']) $body = ExcelLock::encrypt($body, $d['password']);
            $t = Transfer::create([
                'client_id' => $u->client_id, 'kind' => 'backup', 'code' => $code,
                'user_id' => $u->id, 'scope' => $d['scope'], 'format' => $d['format'], 'file_name' => $file,
                'items' => count($rows), 'size_bytes' => strlen($body), 'include_passwords' => $d['include_passwords'], 'locked' => $d['lock'],
            ]);
            $this->audit($u, 'backup', null, "{$t->code} · {$fmtLabel} · {$scopeLabel} · " . count($rows) . ' items · ' . ($d['lock'] ? 'password-locked' : 'not password-locked'),
                ['transfer' => $t->code], 'Import & Recovery');

            return $t;
        });

        return $this->download($body, $file, $this->mime($d['format']), [
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
        $res['lock_note'] = 'Locked with Excel’s own password (AES-256) — Excel asks for it when the file opens. Only Excel backups can be locked.';

        return response()->json($res, 200);
    }

    /**
     * The export's selection, exactly the table's: tab mine (My Credentials) or team (Team
     * Credentials — the team's, not yours, not shared with you), then the table's filters.
     * `scope` (team | personal) is the older name of the tab and still accepted.
     */
    protected function exportRules(): array
    {
        return [
            'tab'           => ['nullable', Rule::in(['mine', 'team'])],
            'scope'         => ['nullable', Rule::in(['team', 'personal', 'mine'])],
            'department_id' => ['nullable', 'integer', 'min:1'],
            'vault'         => ['nullable', Rule::in(Credential::VAULTS)],
            'risk'          => ['nullable', Rule::in(Credential::RISKS)],
            'type'          => ['nullable', Rule::in(array_keys(Credential::TYPES))],
            'q'             => ['nullable', 'string', 'max:100'],
            'groups'        => ['nullable', 'array'],
            'groups.*'      => ['distinct', Rule::in(Credential::GROUPS)],
        ];
    }

    protected function exportTab(array $d): string
    {
        return $d['tab'] ?? (in_array($d['scope'] ?? 'team', ['personal', 'mine'], true) ? 'mine' : 'team');
    }

    /** @return Collection the credentials of the selection (groups not applied), with _rank for fileSecret */
    protected function exportSet(User $u, array $d, bool $light = false): Collection
    {
        $tab = $this->exportTab($d);
        $q = $this->visibleQuery($u)->with(['owner:id,name', 'department:id,name']);
        foreach (['vault' => 'vault', 'risk' => 'risk', 'type' => 'type'] as $k => $col) {
            if (!empty($d[$k])) $q->where("credvault_credentials.{$col}", $d[$k]);
        }
        if ($tab === 'mine') {
            $q->where('owner_id', $u->id);
        } else {
            $q->where('scope', 'team')->where('owner_id', '!=', $u->id)->whereNotIn('credvault_credentials.id', $this->sharedWithMeIds($u));
            if (!empty($d['department_id'])) $q->where('department_id', $d['department_id']);
        }
        $this->credentialSearch($q, $u, $d['q'] ?? null);
        $all = $q->orderBy('code')->get($light ? self::LIGHT_COLUMNS : ['*']);
        $acc = $this->accessMap($all, $u);

        return $all->each(fn ($c) => $c->setAttribute('_rank', $acc[$c->id][0] ?? self::RANK_USE)->setAttribute('_via', $acc[$c->id][1] ?? null))->values();
    }

    /**
     * GET /credvault/exports/preview?tab=mine|team&department_id=&vault=&risk=&type=&q= — the Export
     * popup before anything downloads: a count per category (the "What to export" boxes), the total,
     * how many are protected, and both tab counts — the same numbers as the table's tabs.
     */
    public function exportPreview(Request $request)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate($this->exportRules());
        $tab = $this->exportTab($d);
        $creds = $this->exportSet($u, $d, true);
        $picked = !empty($d['groups']) ? $creds->whereIn('category_group', $d['groups']) : $creds;

        return response()->json(['status' => true, 'data' => [
            'tab'       => $tab,
            'scope'     => $tab === 'mine' ? 'personal' : 'team',
            'filters'   => array_filter(array_intersect_key($d, array_flip(['department_id', 'vault', 'risk', 'type', 'q', 'groups'])), fn ($v) => $v !== null && $v !== '' && $v !== []),
            'total'     => $creds->count(),
            'selected'  => $picked->count(),
            'groups'    => collect(Credential::GROUPS)->map(fn ($g) => ['group' => $g, 'count' => $creds->where('category_group', $g)->count(),
                'selected' => empty($d['groups']) || in_array($g, $d['groups'], true)])->values(),
            'protected' => $picked->filter(fn ($c) => $c->isProtected())->count(),
            'tabs'      => ['mine' => $this->exportSet($u, ['tab' => 'mine'] + $d, true)->count(), 'team' => $this->exportSet($u, ['tab' => 'team'] + $d, true)->count()],
            'columns'   => ['always' => self::EXPORT_COLUMNS, 'with_passwords' => 'Password / Secret', 'with_notes' => 'Notes'],
        ]], 200);
    }

    /**
     * POST /credvault/exports { tab: mine|team, department_id?, vault?, risk?, type?, q?, groups?[],
     *                          format: csv|json, include_notes, include_passwords, acknowledge, account_password }
     *
     * The "Export Credentials" popup: the table's selection (tab + filters), narrowed to the ticked
     * categories, with every column the table shows (EXPORT_COLUMNS).
     * The file is plain text, so including passwords takes the acknowledgement
     * AND the account password; secrets of protected credentials are written
     * as "[Protected — unlock in CredVault]".
     */
    public function export(Request $request)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate($this->exportRules() + [
            'format'            => ['required', Rule::in(['csv', 'json'])],
            'include_notes'     => ['sometimes', 'boolean'],
            'include_passwords' => ['required', 'boolean'],
            'acknowledge'       => ['exclude_unless:include_passwords,true,1', 'accepted'],
            'account_password'  => ['exclude_unless:include_passwords,true,1', 'required', 'string'],
        ], ['acknowledge.accepted' => 'Confirm you understand the risk of exporting readable passwords.', 'account_password.required' => 'Enter your account password to export readable passwords.']);

        if ($d['include_passwords'] && !Hash::check((string) $d['account_password'], $u->password)) {
            $this->reject('Your account password is incorrect.', 'account_password');
        }

        if (empty($d['tab']) && empty($d['scope'])) $this->reject('Choose what to export: tab mine (My Credentials) or team (Team Credentials).', 'tab');
        $tab = $this->exportTab($d);
        $d['scope'] = $tab === 'mine' ? 'personal' : 'team';
        $creds = $this->exportSet($u, $d)
            ->when(!empty($d['groups']), fn ($c) => $c->whereIn('category_group', $d['groups']))->values();
        if ($creds->isEmpty()) $this->reject('No credentials match this selection.', 'groups');

        [$cols, $rows, $withheld] = $this->exportRows($creds, $d['include_passwords'], $d['include_notes'] ?? true);
        $file = ($tab === 'team' ? 'team' : 'my') . '-credentials-' . now()->format('Ymd') . '.' . $d['format'];
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

    /** The bin's four tabs, on a query already narrowed to one vault. */
    protected function binTabCounts(Builder $q, User $u, array $pol): array
    {
        return [
            'all'  => (clone $q)->count(),
            'mine' => (clone $q)->where('deleted_by', $u->id)->count(),
            'team' => (clone $q)->where('scope', 'team')->count(),
            'soon' => $this->wherePastRetention(clone $q, $pol, 7)->count(),
        ];
    }

    /** The bin search: ID, name, category, group, type label, owner and who deleted it. */
    protected function binSearch(Builder $q, User $u, ?string $term): void
    {
        if ($term === null || trim($term) === '') return;
        $like   = $this->likeTerm($term);
        $types  = collect(Credential::TYPES)->filter(fn ($x) => str_contains(mb_strtolower($x[0]), mb_strtolower(trim($term))))->keys()->all();
        $people = User::where('client_id', $u->client_id)->whereRaw('lower(name) like ?', [$like])->select('id');
        $q->where(function ($w) use ($like, $types, $people) {
            foreach (['name', 'code', 'category_group'] as $col) $w->orWhereRaw("lower(coalesce(credvault_credentials.{$col}, '')) like ?", [$like]);
            if ($types) $w->orWhereIn('type', $types);
            $w->orWhereIn('owner_id', $people)->orWhereIn('deleted_by', $people);
        });
    }

    /**
     * GET /credvault/recycle-bin?vault=normal|critical&tab=all|mine|team|soon&q=&page=&per_page=
     *
     * The four tabs (All Items · Deleted by Me · Team Credentials · Expiring Soon), each split
     * into Normal Vault and Critical Vault. `vault` (default normal) picks the sub-tab; `tabs`
     * are its four counts and `counts` all eight. Counts follow the search box.
     *
     * One retention period covers both vaults, set per branch (Policy::binDays): each item
     * follows its branch's period, and `retention_days` is the viewer's. Critical items can be
     * restored or deleted only by the Branch Admin (`can_restore`, `can_purge`).
     * Expired items are purged first; `purged` says how many went. "expiring" = "soon".
     */
    public function recycleBin(Request $request)
    {
        $u = $this->tenantUser($request);
        if ($request->query('tab') === 'expiring') $request->merge(['tab' => 'soon']);
        $f = $request->validate($this->listRules(['all', 'mine', 'team', 'soon']) + ['vault' => ['nullable', Rule::in(Credential::VAULTS)]]);
        $pol    = Policy::for($u->client_id);
        $purged = $this->purgeExpired($u->client_id, $pol);
        $vault  = $f['vault'] ?? 'normal';
        $days   = Policy::binDays($pol, $this->binBranchFor($u));
        $term   = $f['q'] ?? null;

        $counts = [];
        foreach (Credential::VAULTS as $v) {
            $q = $this->binQuery($u, $v);
            $this->binSearch($q, $u, $term);
            $counts[$v] = $this->binTabCounts($q, $u, $pol);
        }
        $counts['total'] = array_map(fn ($k) => $counts['normal'][$k] + $counts['critical'][$k], ['all' => 'all', 'mine' => 'mine', 'team' => 'team', 'soon' => 'soon']);

        $base = $this->binQuery($u, $vault);
        $next = (clone $base)->select(['id', 'name', 'deleted_at'])->selectRaw(self::BIN_BRANCH_SQL . ' as bin_branch')->get()
            ->map(fn ($c) => $c->setAttribute('_purge', $c->deleted_at->copy()->addDays(Policy::binDays($pol, $c->bin_branch))))
            ->sortBy('_purge')->first();
        $branchAdmin = (bool) $this->adminBranchOf($u);
        $binAdmin = $this->binAdmin($u);
        $summary = [
            'vault'                => $vault,
            'retention_days'       => $days,
            'retention_scope'      => $this->binRetentionScope($u, $pol),
            'retention_fixed'      => false,
            'can_change_retention' => $binAdmin,
            'retention_options'    => Policy::OPTIONS['bin_days'],
            'purge_allowed'        => (bool) $pol['bin_purge'],
            'is_bin_admin'         => $binAdmin,
            'can_empty'            => (bool) $pol['bin_purge'] && $binAdmin && ($vault === 'normal' || $branchAdmin),
            'critical_actions'     => $branchAdmin ? 'branch_admin' : 'none',
            'items'                => (clone $base)->count(),
            'deleted_by_me'        => (clone $base)->where('deleted_by', $u->id)->count(),
            'expiring_soon'        => $this->wherePastRetention(clone $base, $pol, 7)->count(),
            'critical'             => (clone $base)->where('risk', 'critical')->count(),
            'next_deletion'        => $next ? [
                'name' => $next->name, 'at' => $next->_purge->toIso8601String(),
                'days' => max(1, (int) ceil(now()->diffInHours($next->_purge, false) / 24)),
            ] : null,
        ];

        match ($f['tab'] ?? 'all') {
            'mine'  => $base->where('deleted_by', $u->id),
            'team'  => $base->where('scope', 'team'),
            'soon'  => $this->wherePastRetention($base, $pol, 7),
            default => null,
        };
        $this->binSearch($base, $u, $term);

        $page = $base->select(array_merge(self::LIGHT_COLUMNS, ['deleted_at', 'deleted_by', 'branch_id']))->selectRaw(self::BIN_BRANCH_SQL . ' as bin_branch')
            ->with(['owner:id,name'])->orderBy('deleted_at')
            ->paginate($f['per_page'] ?? self::PAGE_SIZE, ['*'], 'page', $f['page'] ?? 1);
        $deleters = User::whereIn('id', collect($page->items())->pluck('deleted_by')->filter()->unique()->all())->pluck('name', 'id');
        $from = ($page->currentPage() - 1) * $page->perPage();

        return response()->json([
            'status'  => true,
            'purged'  => $purged,
            'summary' => $summary,
            'data'    => collect($page->items())->values()->map(function ($c, $i) use ($pol, $deleters, $u, $from, $binAdmin) {
                $total = Policy::binDays($pol, $c->bin_branch);
                $purge = $c->deleted_at->copy()->addDays($total);
                // Never "0 days": an item still in the bin goes on its last day.
                $days  = max(1, (int) ceil(now()->diffInHours($purge, false) / 24));
                $deny  = $this->binDenial($u, $c);

                return [
                    'sr_no' => $from + $i + 1,
                    'id' => $c->id, 'code' => $c->code, 'vault' => $c->vault, 'name' => $c->name, 'type' => $c->type,
                    'type_label' => Credential::typeDef($c->type)['label'] ?? $c->type, 'category_group' => $c->category_group,
                    'url' => $c->url, 'scope' => $c->scope, 'scope_label' => $c->scope === 'team' ? 'Team' : 'Personal', 'risk' => $c->risk,
                    'owner' => ['id' => $c->owner_id, 'name' => $c->owner?->name, 'initials' => $this->initials($c->owner?->name), 'is_me' => $c->owner_id === $u->id],
                    'deleted_by' => ['id' => $c->deleted_by, 'name' => $c->deleted_by === $u->id ? 'You' : ($deleters[$c->deleted_by] ?? null),
                        'initials' => $this->initials($deleters[$c->deleted_by] ?? ($c->deleted_by === $u->id ? $u->name : null))],
                    'deleted_at' => $c->deleted_at->toIso8601String(),
                    'retention_days' => $total, 'branch_id' => $c->bin_branch ? (int) $c->bin_branch : null,
                    'purges_at' => $purge->toIso8601String(), 'days_left' => $days,
                    'left_pct' => (int) round(min($days, $total) / max(1, $total) * 100),
                    'urgency' => $days <= 3 ? 'bad' : ($days <= 7 ? 'warn' : 'ok'),
                    'can_restore' => $deny === null,
                    'can_purge' => $deny === null && (bool) $pol['bin_purge'] && $binAdmin,
                    'locked_reason' => $deny,
                ];
            })->values(),
            'tabs'    => $counts[$vault],
            'counts'  => $counts,
            'meta'    => $this->pageMeta($page),
        ], 200);
    }

    /** POST /credvault/recycle-bin/{id}/restore — a Critical Vault item: the Branch Admin only. */
    public function restore(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        $c = $this->binQuery($u)->find($id) ?? $this->reject('That item is not in your Recycle Bin.', null, 404);
        if ($why = $this->binDenial($u, $c)) $this->reject($why, null, 403);

        $this->inTransaction('restore the credential', function () use ($c, $u) {
            $c->restore();
            $c->forceFill(['deleted_by' => null, 'updated_by' => $u->id])->saveQuietly();
            $this->audit($u, 'restore', $c, 'Restored from Recycle Bin');
        });
        $to = $c->vault === 'critical' ? 'Critical Vault' : ($c->scope === 'team' ? 'Team Vault' : 'My Vault');

        return response()->json(['status' => true, 'message' => "“{$c->name}” restored to {$to}.", 'data' => ['id' => $c->id, 'vault' => $c->vault, 'restored_to' => $to]], 200);
    }

    /** DELETE /credvault/recycle-bin/{id} { confirm: true } — gone for good. A Critical Vault item: the Branch Admin only. */
    public function purge(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        $request->validate(['confirm' => ['accepted']], ['confirm.accepted' => 'Confirm that you understand this cannot be undone.']);
        $pol = Policy::for($u->client_id);
        if (!$pol['bin_purge']) $this->reject('Permanent delete is turned off in CredVault Policies.', null, 403);
        if (!$this->binAdmin($u)) $this->reject('Only a Vault Admin (the client admin or a Branch Admin) can delete permanently. You can restore it.', null, 403);

        $c = $this->binQuery($u)->find($id) ?? $this->reject('That item is not in your Recycle Bin.', null, 404);
        if ($why = $this->binDenial($u, $c)) $this->reject($why, null, 403);
        $this->inTransaction('delete the credential permanently', fn () => $this->purgeOne($c, $u->id, 'Deleted permanently'));

        return response()->json(['status' => true, 'message' => "“{$c->name}” deleted permanently.", 'data' => ['id' => $c->id, 'vault' => $c->vault]], 200);
    }

    /**
     * DELETE /credvault/recycle-bin { confirm: true, vault?: normal|critical|all } — Empty Bin.
     *
     * vault all (the default) empties both vaults in one call: every Normal Vault item the
     * user sees in the bin, and — for the Branch Admin — every Critical Vault item of the
     * branch. Critical items anyone else sees are left and counted in `skipped`.
     */
    public function emptyBin(Request $request)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate(['confirm' => ['accepted'], 'vault' => ['nullable', Rule::in(array_merge(Credential::VAULTS, ['all']))]],
            ['confirm.accepted' => 'Confirm that you understand this cannot be undone.']);
        $pol = Policy::for($u->client_id);
        if (!$pol['bin_purge']) $this->reject('Permanent delete is turned off in CredVault Policies.', null, 403);
        if (!$this->binAdmin($u)) $this->reject('Only a Vault Admin (the client admin or a Branch Admin) can empty the Recycle Bin.', null, 403);
        $vault = $d['vault'] ?? 'all';

        $items = $this->binQuery($u, $vault === 'all' ? null : $vault)->get();
        if ($items->isEmpty()) $this->reject('The Recycle Bin is already empty.', null, 409);
        [$go, $kept] = $items->partition(fn ($c) => $this->binDenial($u, $c) === null);
        if ($go->isEmpty()) $this->reject('Only the Branch Admin can delete Critical Vault items in the Recycle Bin.', null, 403);

        $this->inTransaction('empty the Recycle Bin', function () use ($go, $u) {
            foreach ($go as $c) $this->purgeOne($c, $u->id, 'Deleted permanently (Empty Bin)');
        });
        $by = fn ($set, $v) => $set->where('vault', $v)->count();

        return response()->json([
            'status'  => true,
            'message' => $go->count() . ' ' . Str::plural('item', $go->count()) . ' deleted permanently'
                . ($kept->count() ? " · {$kept->count()} Critical Vault " . Str::plural('item', $kept->count()) . ' left for the Branch Admin' : '') . '.',
            'data'    => [
                'vault'   => $vault,
                'deleted' => ['normal' => $by($go, 'normal'), 'critical' => $by($go, 'critical'), 'total' => $go->count()],
                'skipped' => ['critical' => $kept->count(), 'reason' => $kept->count() ? 'Only the Branch Admin can delete Critical Vault items.' : null],
            ],
        ], 200);
    }

    /**
     * GET /credvault/recycle-bin/retention[?days=7][&branch_id=3] — the Change period popup.
     *
     * One period covers both vaults (My Vault and Critical Vault), set per branch: `days` is the
     * viewer's (their branch's own, else the company's), `normal` / `critical` repeat it per vault.
     * A Branch Admin changes their branch's; a Vault Admin the company default (`branch_id`
     * omitted) or one branch's, and gets `branches[]` with each branch's period.
     *
     * With `days`, `preview` says what that period would delete right away: the bin items of the
     * branch (or of the branches on the company period) older than it (`total`), and those the
     * user can see in their own bin (`items`).
     */
    public function binRetention(Request $request)
    {
        $u   = $this->tenantUser($request);
        $f   = $request->validate([
            'days'      => ['nullable', 'integer', Rule::in(Policy::OPTIONS['bin_days'])],
            'branch_id' => ['nullable', 'integer', 'min:1'],
        ], ['days.in' => 'Choose 7, 15, 30, 60 or 90 days.']);
        $pol    = Policy::for($u->client_id);
        $target = $this->retentionTarget($u, $f['branch_id'] ?? null, false);
        $days   = $target ? Policy::binDays($pol, $target) : (int) $pol['bin_days'];
        $can    = $this->binAdmin($u);
        $vault  = fn () => ['days' => $days, 'options' => Policy::OPTIONS['bin_days'], 'can_change' => $can, 'fixed' => false];

        return response()->json(['status' => true, 'data' => array_filter([
            'days'         => $days,
            'applies_to'   => 'both',
            'scope'        => $target ? 'branch' : 'company',
            'branch'       => $target ? ['id' => $target, 'name' => Branch::whereKey($target)->value('name'),
                'source' => isset($pol['bin_branch_days'][$target]) ? 'branch' : 'company'] : null,
            'company_days' => (int) $pol['bin_days'],
            'options'      => Policy::OPTIONS['bin_days'],
            'can_change'   => $can,
            'normal'       => $vault(),
            'critical'     => $vault(),
            'branches'     => $this->isAdmin($u) ? Branch::where('client_id', $u->client_id)->orderBy('name')->get(['id', 'name'])
                ->map(fn ($b) => ['id' => $b->id, 'name' => $b->name, 'days' => Policy::binDays($pol, $b->id),
                    'source' => isset($pol['bin_branch_days'][$b->id]) ? 'branch' : 'company'])->values() : null,
            'note'         => 'One period for My Vault and Critical Vault. Items already older than the new period are deleted right away.',
            'preview'      => isset($f['days']) ? $this->retentionImpact($u, (int) $f['days'], $target) : null,
        ], fn ($v) => $v !== null)], 200);
    }

    /**
     * The branch a retention call is about: a Branch Admin's own (another branch → 403); for a
     * Vault Admin the branch_id sent, or null = the company default. Others: their own branch,
     * read-only. $change: the caller wants to change it.
     */
    protected function retentionTarget(User $u, ?int $branchId, bool $change): ?int
    {
        if ($own = $this->adminBranchOf($u)) {
            if ($branchId && $branchId !== $own) $this->reject('A Branch Admin can set the retention period of their own branch only.', 'branch_id', 403);
            return $own;
        }
        if ($this->isAdmin($u)) {
            if (!$branchId) return null;
            if (!Branch::where('client_id', $u->client_id)->whereKey($branchId)->exists()) $this->reject('That branch is not part of your company.', 'branch_id', 404);
            return $branchId;
        }
        if ($change) $this->reject('Only a Vault Admin (the client admin or a Branch Admin) can change the retention period.', null, 403);

        return $this->binBranchFor($u);
    }

    /** The policy as it would read with $branch's period (null = the company's) set to $days. */
    protected function withRetention(array $pol, ?int $branch, int $days): array
    {
        if ($branch) $pol['bin_branch_days'][$branch] = $days;
        else $pol['bin_days'] = $days;

        return $pol;
    }

    /**
     * What a new period would delete at once — the same rule purgeExpired() applies, for the
     * items the change covers: $branch's (or, for the company period, the branches without their
     * own). `items` is the user's own bin view, oldest first.
     */
    protected function retentionImpact(User $u, int $days, ?int $branch = null): array
    {
        $pol  = Policy::for($u->client_id);
        $next = $this->withRetention($pol, $branch, $days);
        // Only what the change newly puts past its period: already-expired items go anyway.
        $hit  = fn (Builder $q) => $this->wherePastRetention($q, $next)->whereNotIn('credvault_credentials.id',
            $this->wherePastRetention(Credential::onlyTrashed()->where('credvault_credentials.client_id', $u->client_id), $pol)->select('credvault_credentials.id'));
        $all   = $hit(Credential::onlyTrashed()->where('credvault_credentials.client_id', $u->client_id));
        $total = (clone $all)->count();
        $mine  = $hit($this->binQuery($u))->pluck('credvault_credentials.id')->flip();
        // Every credential the change deletes — the viewer's own bin and other people's — so the confirm lists all of
        // them, each marked with whose bin it is in (capped, as a guard on a very large bin).
        $items = (clone $all)->with('owner:id,name')->orderBy('deleted_at')->limit(500)
            ->get(['credvault_credentials.id', 'code', 'name', 'type', 'risk', 'vault', 'owner_id', 'deleted_at']);

        return [
            'days'          => $days,
            'branch_id'     => $branch,
            'total'         => $total,
            'visible_total' => $mine->count(),
            'items'         => $items->map(fn ($c) => [
                'id' => $c->id, 'code' => $c->code, 'name' => $c->name, 'type' => $c->type, 'risk' => $c->risk, 'vault' => $c->vault,
                'deleted_at' => $c->deleted_at->toIso8601String(), 'days_in_bin' => (int) $c->deleted_at->diffInDays(now()),
                'in_my_bin' => isset($mine[$c->id]),
                'owner' => $c->owner_id === $u->id ? 'You' : $c->owner?->name,
            ])->values(),
        ];
    }

    /**
     * PUT /credvault/recycle-bin/retention { days, branch_id?, confirm_purge?: true } — Change
     * period, for both vaults. A Branch Admin sets their branch's period (every employee of the
     * branch, My Vault and Critical Vault); a Vault Admin the company default (no branch_id: every
     * branch without its own) or one branch's. `vault` is accepted and ignored — one period covers
     * both. A shorter period deletes the items already past it, right away — so when it would
     * delete any, the call needs confirm_purge (409 without it).
     */
    public function updateBinRetention(Request $request)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate([
            'days'          => ['required', 'integer', Rule::in(Policy::OPTIONS['bin_days'])],
            'vault'         => ['nullable', Rule::in(Credential::VAULTS)],
            'branch_id'     => ['nullable', 'integer', 'min:1'],
            'confirm_purge' => ['sometimes', 'boolean'],
        ], ['days.in' => 'Choose 7, 15, 30, 60 or 90 days.']);
        if (!$this->binAdmin($u)) $this->reject('Only a Vault Admin (the client admin or a Branch Admin) can change the retention period.', null, 403);
        $branch = $this->retentionTarget($u, $d['branch_id'] ?? null, true);
        $days   = (int) $d['days'];

        $pol     = Policy::for($u->client_id);
        $current = $branch ? Policy::binDays($pol, $branch) : (int) $pol['bin_days'];
        if ($days < $current && empty($d['confirm_purge'])) {
            $n = $this->retentionImpact($u, $days, $branch)['total'];
            if ($n > 0) {
                $this->reject("{$n} " . Str::plural('credential', $n) . " in the Recycle Bin " . ($n === 1 ? 'is' : 'are')
                    . " older than {$days} days and will be deleted permanently. Confirm to continue.", 'confirm_purge', 409);
            }
        }
        $where = $branch ? 'for ' . (Branch::whereKey($branch)->value('name') ?? "branch #{$branch}") : 'as the company default';

        if (!$branch) {
            $res    = $this->savePolicies($u, ['bin_days' => $days])->getData(true);
            $purged = $res['data']['purged'] ?? 0;
            $changed = (bool) $res['data']['changed'];
        } else {
            $changed = !isset($pol['bin_branch_days'][$branch]) || $pol['bin_branch_days'][$branch] !== $days;
            $purged  = !$changed ? 0 : $this->inTransaction('save the retention period', function () use ($u, $branch, $days, $current, $where) {
                $row = Policy::where('client_id', $u->client_id)->lockForUpdate()->first() ?? new Policy(['client_id' => $u->client_id, 'settings' => []]);
                $settings = $row->settings ?? [];
                $settings['bin_branch_days'] = array_replace($settings['bin_branch_days'] ?? [], [$branch => $days]);
                $row->fill(['settings' => $settings, 'updated_by' => $u->id])->save();
                $this->audit($u, 'policy', null, "Retention period {$where}: {$current} days → {$days} days",
                    ['key' => 'bin_days', 'branch_id' => $branch, 'from' => $current, 'to' => $days, 'from_label' => "{$current} days", 'to_label' => "{$days} days"], 'Recycle Bin');
                Policy::forget($u->client_id);

                return $days < $current ? $this->purgeExpired($u->client_id, Policy::for($u->client_id), $u->id) : 0;
            });
        }

        return response()->json(['status' => true,
            'message' => $changed ? "Retention set to {$days} days {$where}, for My Vault and Critical Vault"
                . ($purged ? " · {$purged} " . Str::plural('item', $purged) . ' past the new period deleted' : '') . '.' : 'Nothing changed.',
            'data' => ['days' => $days, 'applies_to' => 'both', 'scope' => $branch ? 'branch' : 'company', 'branch_id' => $branch, 'purged' => $purged]], 200);
    }

    /* ═══════════════════════════ GENERATOR ═══════════════════════════ */

    /**
     * POST /credvault/generate-password — the Generate Password dialog and the ↻ button in
     * password fields, one method and one set of defaults for both (GP-R8):
     *
     *   mode chars   length 12–64 (20) · upper · lower · numbers · symbols (all on) · avoid_ambiguous (on)
     *   mode phrase  words 4–10 (6) · capitalize (on) · add_number (on) · separator hyphen | dot | underscore | space
     *                (or the character itself; a bare " " is trimmed by the request middleware, so send "space")
     *
     * The level is the D34 rule every CredVault password follows (Fair · Good · Strong),
     * `bits` only a hint. A setting that cannot reach the policy minimum is refused (GP-V03),
     * so nothing below the minimum is ever shown. Only the action is audit-logged, never the value.
     */
    public function generatePassword(Request $request)
    {
        $u   = $this->tenantUser($request);
        $pol = Policy::for($u->client_id);
        $G   = PasswordGenerator::class;
        $d   = $request->validate([
            'mode'            => ['nullable', Rule::in(['chars', 'phrase'])],
            'length'          => ['nullable', 'integer', 'between:' . implode(',', $G::LENGTH)],
            'upper'           => ['nullable', 'boolean'],
            'lower'           => ['nullable', 'boolean'],
            'numbers'         => ['nullable', 'boolean'],
            'symbols'         => ['nullable', 'boolean'],
            'avoid_ambiguous' => ['nullable', 'boolean'],
            'words'           => ['nullable', 'integer', 'between:' . implode(',', $G::WORDS)],
            'separator'       => ['nullable', Rule::in(array_merge(array_keys($G::SEPARATORS), array_keys($G::SEPARATOR_NAMES)))],
            'capitalize'      => ['nullable', 'boolean'],
            'add_number'      => ['nullable', 'boolean'],
        ], [
            'length.between' => 'Length is ' . implode(' to ', $G::LENGTH) . ' characters.',
            'words.between'  => 'A passphrase has ' . implode(' to ', $G::WORDS) . ' words.',
        ]);
        $o   = array_merge($G::DEFAULTS, array_filter($d, fn ($v) => $v !== null));
        $o['separator'] = $G::SEPARATOR_NAMES[$o['separator']] ?? $o['separator'];
        $min = (int) $pol['min_strength'];
        $minLabel = $G::label($min);

        if ($o['mode'] === 'phrase') {
            $out = $G::passphrase($o, $min >= 3);
        } else {
            if (!$G::sets($o)) $this->reject('Keep at least one character set on', 'upper');                 // GP-V01
            if ($G::charsLevel($o) < $min) $this->reject("This setting can’t reach the policy minimum ({$minLabel})", 'symbols'); // GP-V03
            $out = $G::characters($o);
        }
        $level = Credential::strengthOf($out['password']);
        $this->audit($u, 'generate', null, 'Password generated · ' . ($o['mode'] === 'phrase' ? "passphrase, {$o['words']} words" : "{$o['length']} characters"),
            ['mode' => $o['mode']], 'Generate Password');

        return response()->json(['status' => true, 'data' => [
            'password'       => $out['password'],
            'level'          => $G::label($level),
            'strength_level' => $level,
            'bits'           => (int) round($out['bits']),
            'meets_policy'   => $level >= $min,
            'policy_minimum' => $minLabel,
            'settings'       => $o['mode'] === 'phrase'
                ? array_intersect_key($o, array_flip(['mode', 'words', 'capitalize', 'add_number', 'separator'])) + ['add_number_forced' => $min >= 3]
                : array_intersect_key($o, array_flip(['mode', 'length', 'upper', 'lower', 'numbers', 'symbols', 'avoid_ambiguous'])),
        ]], 200);
    }

    /**
     * GET /credvault/generate-password/options — what the dialog offers: the defaults, the
     * ranges, the separators, and which Characters settings the policy minimum disables.
     */
    public function generatorOptions(Request $request)
    {
        $u   = $this->tenantUser($request);
        $min = (int) Policy::for($u->client_id)['min_strength'];
        $G   = PasswordGenerator::class;

        return response()->json(['status' => true, 'data' => [
            'defaults'       => $G::DEFAULTS,
            'length'         => ['min' => $G::LENGTH[0], 'max' => $G::LENGTH[1]],
            'words'          => ['min' => $G::WORDS[0], 'max' => $G::WORDS[1], 'list' => 'EFF long list', 'list_size' => count($G::wordList())],
            // Send `name` (hyphen · dot · underscore · space): a bare space is trimmed from requests.
            'separators'     => collect($G::SEPARATORS)->map(fn ($l, $v) => ['name' => array_search($v, $G::SEPARATOR_NAMES, true), 'value' => $v, 'label' => $l])->values(),
            'symbols'        => $G::SYMBOLS,
            'ambiguous'      => $G::AMBIGUOUS,
            'policy_minimum' => ['level' => $min, 'label' => $G::label($min)],
            // Characters mode reaches Good or Strong only with letters, numbers and symbols all on.
            'required_on_for_minimum' => $min >= 3 ? ['numbers', 'symbols', 'letters (upper or lower)'] : [],
            'add_number_forced'       => $min >= 3,
            'clipboard_clear_seconds' => 30,
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
        $bin      = $this->binQuery($u)->select(['id', 'deleted_at', 'deleted_by'])->selectRaw(self::BIN_BRANCH_SQL . ' as bin_branch')->get();
        $binSoon  = $bin->filter(fn ($b) => $b->deleted_at->copy()->addDays(Policy::binDays($pol, $b->bin_branch))->lte(now()->addDays(7)))->count();

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
    protected function departmentsOfUsers(array $ids): array
    {
        if (!$ids) return [];
        $out = User::whereIn('id', $ids)->whereNotNull('department_id')->pluck('department_id', 'id')->map(fn ($d) => (int) $d)->all();
        Employee::whereIn('user_id', array_diff($ids, array_keys($out)))->whereNotNull('department_id')->get(['user_id', 'department_id'])
            ->each(function ($e) use (&$out) { $out[$e->user_id] ??= (int) $e->department_id; });

        return $out;
    }

    /* ═════════════════════════ CREDENTIAL WRITES ═════════════════════════ */

    protected function credentialRules(bool $creating): array
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
            // Critical Vault 2-step, linked in the form before the save.
            'twofa_method'         => ['sometimes', 'nullable', Rule::in(Credential::TWOFA_METHODS)],
            //   google: the secret from POST /critical-vault/two-step/google/new and one code from the app
            'totp_secret'          => ['sometimes', 'nullable', 'string', 'regex:/^[A-Z2-7]{16,128}$/', 'required_with:totp_code'],
            'totp_code'            => ['sometimes', 'nullable', 'regex:/^\d{6}$/', 'required_with:totp_secret'],
            //   email: the inbox, and the token of a code verified by POST /critical-vault/two-step/email/verify
            'twofa_email'          => ['sometimes', 'nullable', 'email:rfc', 'max:191'],
            'email_otp_token'      => ['sometimes', 'nullable', 'string', 'size:40'],
        ];
    }

    /**
     * "yes"/"no" — what the form's 2FA switch posts — read as booleans, for
     * the top-level switch and for the Password type's own 2FA toggle field.
     */
    protected function normaliseSwitches(Request $request): void
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
     * Create ($c null) or update one credential — the Add and Edit forms of
     * either vault. The vault is fixed at creation, like the type.
     *
     * Normal Vault: risk low / medium / high; 2-step is a yes/no the form
     * records (twofa). Nothing is linked and nothing is asked on reveal.
     *
     * Critical Vault: risk is always critical, with the protection steps. The
     * 2-step step is the type's 2FA switch on a type that has one (login,
     * email, bank, crypto, passkey, password), lock_otp on any other. When it
     * is on, the method is linked inside the form and the save is refused
     * until its code matched, so nothing is ever locked behind a code nobody
     * receives:
     *   google  the secret shown as a QR code + one code from the app
     *   email   the inbox + the token of a code verified by email/verify
     */
    protected function persistCredential(Request $request, User $u, ?Credential $c, string $vault)
    {
        $creating = $c === null;
        $critical = $vault === 'critical';
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

        $fields = $this->validateTypeFields($def, $inputFields, $existing, $request, $c, $critical);
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
            ? $this->teamDepartmentFor($u, array_key_exists('department_id', $data) ? $data['department_id'] : ($c->department_id ?? null), $creating ? null : $c)
            : null;

        if ($critical) {
            if (isset($data['risk']) && $data['risk'] !== 'critical') {
                $this->reject('Everything in the Critical Vault is critical risk. Add it to My Vault for a lower risk level.', 'risk');
            }
            $risk = 'critical';
        } else {
            if (($data['risk'] ?? null) === 'critical') {
                $this->reject('Critical credentials are added in the Critical Vault, where they get approvals and 2-step verification.', 'risk');
            }
            // A type that defaults to critical (card, bank, crypto, ID) starts at high here.
            $risk = $data['risk'] ?? ($c->risk ?? ($def['risk'] === 'critical' ? 'high' : $def['risk']));
        }
        $sec  = $def['sec'];
        $secret  = $sec ? ($fields[$sec] ?? null) : null;
        $isPw    = Credential::secretIsPassword($type);
        $changed = $creating || ($sec && array_key_exists($sec, $inputFields) && $secret !== $c->secret);
        $strength = $isPw ? Credential::strengthOf($secret) : 0;
        if ($isPw && $secret !== null && $changed && $strength < $pol['min_strength'] && !$this->importing) {
            $this->reject('Policy requires a ' . Credential::STRENGTH_LABELS[$pol['min_strength']] . ' or stronger password — use the generate button.', "fields.{$sec}");
        }

        $rotation = $isPw ? (array_key_exists('rotation_days', $data) ? $data['rotation_days'] : ($creating ? $pol['rotation_default'] : $c->rotation_days)) : null;
        $twofa = match (true) {
            (bool) $def['twofa']              => (array_key_exists('twofa', $data) ? $data['twofa'] : (!$creating && $c->twofa === 'yes')) ? 'yes' : 'no',
            Credential::hasTwofaSwitch($type) => ($toggle2fa ?? $data['twofa'] ?? (!$creating && $c->twofa === 'yes')) ? 'yes' : 'no',
            default                           => 'na',
        };

        // Protection — the Critical Vault only. In the Normal Vault 2-step stays a recorded flag.
        $pick = fn (string $k, bool $default) => array_key_exists($k, $data) ? (bool) $data[$k] : $default;
        $lockAdmin   = $critical && $pick('lock_admin', $creating ? true : $c->lock_admin);
        $lockManager = $critical && $pick('lock_manager', $creating ? true : $c->lock_manager);
        $lockOtp     = $critical && (Credential::hasTwofaSwitch($type)
            ? $twofa === 'yes'
            : $pick('lock_otp', $creating ? true : $c->lock_otp));
        // On a type without its own switch the 2-step step is what "2FA" means.
        if ($critical && !Credential::hasTwofaSwitch($type)) $twofa = $lockOtp ? 'yes' : 'na';
        if ($critical && !$lockAdmin && !$lockManager && !$lockOtp) {
            $this->reject('Turn on at least one protection step for a critical credential.', 'lock_admin');
        }
        /* New flow: the form no longer pins a specific approver. Both are
         * resolved when access is requested — the Vault Admin is the credential
         * branch's Branch Admin (common), the manager is the requester's own
         * reporting manager (individual). Only the on/off toggles are stored. */
        $adminUserId = null;
        $managerUserId = null;

        // The 2-step method: linked afresh (a code that matched) or the one already linked, kept.
        [$method, $newSecret, $email, $emailToken] = $lockOtp ? $this->twoStepLink($data, $u, $c) : [null, null, null, null];

        $idSpec   = $def['id'] ? collect($def['fields'])->firstWhere('key', $def['id']) : null;
        $idValue  = $def['id'] ? ($fields[$def['id']] ?? null) : null;
        // A secret id (account, passport, licence number) shows as its last four only.
        $username = $idValue === null ? null : (!empty($idSpec['secret']) ? '•••• ' . mb_substr((string) $idValue, -4) : $idValue);
        $url      = collect(['url', 'endpoint', 'host', 'domain'])->map(fn ($k) => $fields[$k] ?? null)->first(fn ($v) => filled($v));

        $stored = [];
        $result = $this->inTransaction($creating ? 'save the credential' : 'update the credential', function () use (
            $request, $u, $c, $creating, $data, $type, $def, $pol, $fields, $name, $scope, $deptId, $risk, $secret, $strength, $isPw,
            $changed, $rotation, $twofa, $lockAdmin, $lockManager, $lockOtp, $adminUserId, $managerUserId, $username, $url, $before,
            $newSecret, $method, $email, $emailToken, $vault, $scopeIds, &$stored
        ) {
            if ($creating) {
                $c = new Credential([
                    'client_id' => $u->client_id, 'branch_id' => $u->branch_id, 'owner_id' => $u->id, 'created_by' => $u->id,
                    'code' => $this->nextCode('credvault_credentials', Credential::VAULT_PREFIX[$vault], $u->client_id),
                    'vault' => $vault, 'type' => $type,
                ]);
            }
            // The verified email code is used up here, inside the save, so one code links one credential.
            if ($emailToken && !EmailOtp::consumeSetup($u, $emailToken, $email)) {
                $this->reject('The email code has expired. Send a new code and verify it again.', 'email_otp_code');
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

            $relinked = $newSecret || $emailToken;
            $c->twofa_method = $method;
            if ($newSecret) {
                $c->forceFill(['totp_secret' => $newSecret, 'totp_linked_at' => now(), 'twofa_linked_at' => now()]);
            } elseif ($method !== 'google') {
                $c->forceFill(['totp_secret' => null, 'totp_linked_at' => null]);
            }
            if ($emailToken) {
                $c->forceFill(['twofa_email' => $email, 'twofa_linked_at' => now()]);
            } elseif ($method !== 'email') {
                $c->twofa_email = null;
            }
            if (!$method) $c->twofa_linked_at = null;
            $c->save();

            $c->attachments = $this->syncAttachments($request, $c, $def, $data['remove_attachments'] ?? [], $stored);
            $c->saveQuietly();

            if ($creating) {
                // CS-1479: a bulk import logs one "importx" summary entry, not a per-row
                // "credential added" — so the activity log shows the import as one bulk entry.
                if (!$this->importing) $this->audit($u, 'create', $c, "{$def['label']} credential added");
            } else {
                $what = array_keys(array_diff_assoc(array_map('strval', $dirtyBefore), array_map('strval', [
                    'name' => $c->name, 'risk' => $c->risk, 'scope' => $c->scope, 'rotation_days' => $c->rotation_days, 'twofa' => $c->twofa,
                ])));
                if (array_key_exists('fields', $data)) $what[] = 'details';
                if ($changed) $what[] = 'secret';
                $this->audit($u, 'edit', $c, 'Updated' . ($what ? ': ' . implode(', ', array_unique($what)) : ''), ['changed' => array_values(array_unique($what))]);
            }
            if ($relinked) {
                $this->audit($u, 'totp_linked', $c, $method === 'email'
                    ? 'Email 2-step linked · ' . Credential::maskEmail($email)
                    : 'Authenticator app linked', ['method' => $method]);
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
        $fresh = $c->fresh(['owner:id,name', 'department:id,name']);
        $body  = $this->detail($fresh, $u, $this->accessMap(collect([$fresh]), $u)[$fresh->id] ?? [self::RANK_FULL, $c->owner_id === $u->id ? 'owner' : 'admin']);
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
                ? "“{$c->name}” saved to " . ($critical ? 'Critical Vault' : ($scope === 'team' ? 'Team Vault' : 'My Vault')) . " as {$c->code}."
                : ($resolved ? count($resolved) . ' health ' . Str::plural('issue', count($resolved)) . ' resolved' : 'Credential updated.'),
            'data'    => $body,
        ], $creating ? 201 : 200);
    }

    /**
     * The Critical Vault's 2-step on save: which method, and proof that its code
     * matched — a fresh link, or the link already stored for the same method
     * (and, for email, the same inbox). A request with totp_secret and no
     * method means google, as the form sent it before email was offered.
     *
     * @return array{0:string,1:?string,2:?string,3:?string} method, new TOTP secret, inbox, verified email token
     */
    protected function twoStepLink(array $data, User $u, ?Credential $c): array
    {
        $method = $data['twofa_method'] ?? (!empty($data['totp_secret']) ? 'google' : $c?->twofa_method);
        if (!$method) $this->reject('Choose how the 2-step code is received: Google Authenticator or email.', 'twofa_method');
        $kept = $c && $c->twofa_method === $method && $c->twoStepLinked();

        if ($method === 'google') {
            if ($secret = $data['totp_secret'] ?? null) {
                if (!Totp::verify($secret, (string) $data['totp_code'])) {
                    $this->reject('That code is incorrect or expired. Check your app and try again.', 'totp_code');
                }
                return ['google', $secret, null, null];
            }
            if (!$kept) $this->reject('Scan the QR code and verify a code to link your authenticator app, or turn 2-step off.', 'totp_code');

            return ['google', null, null, null];
        }

        $email = filled($data['twofa_email'] ?? null) ? Str::lower(trim($data['twofa_email'])) : $c?->twofa_email;
        if (!$email) $this->reject('Enter the email address the 2-step codes go to.', 'twofa_email');
        if ($token = $data['email_otp_token'] ?? null) {
            if (!EmailOtp::setupVerified($u, $token, $email)) {
                $this->reject('Verify the code sent to ' . Credential::maskEmail($email) . ' first — or send a new one.', 'email_otp_code');
            }
            return ['email', null, $email, $token];
        }
        if (!$kept || $email !== $c->twofa_email) {
            $this->reject('Send a code to ' . Credential::maskEmail($email) . ' and verify it to link email 2-step, or turn 2-step off.', 'email_otp_code');
        }

        return ['email', null, $email, null];
    }

    /**
     * The type form, checked field by field. Fields left out keep their stored
     * value; a required field must hold a value once the edit is applied.
     *
     * @return array the merged fields, normalised
     */
    protected function validateTypeFields(array $def, array $input, array $existing, Request $request, ?Credential $c, bool $critical = false): array
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
                // An import cannot carry a file: it is attached in the form afterwards.
                if ($f['required'] && (!$has || $removing) && !$this->importing) $errors["files.{$k}"][] = "Upload the {$f['label']}.";
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

            [$msg, $norm] = $this->checkField($def['key'], $f, (string) $v, $critical);
            if ($msg) $errors["fields.{$k}"][] = $msg; else $merged[$k] = $norm;
        }

        if ($errors) throw ValidationException::withMessages($errors);

        return $merged;
    }

    /** @return array{0:?string,1:string} an error message, or null and the normalised value */
    protected function checkField(string $type, array $f, string $v, bool $critical = false): array
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
                    // The base32 setup-key check applies to the Critical Vault only; My / Team Vault keep the key as typed.
                    if (!$critical) return [null, $v];
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

    protected function luhn(string $digits): bool
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
    protected function syncAttachments(Request $request, Credential $c, array $def, array $remove, array &$stored): array
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

    protected function decide(User $u, int $id, bool $approve, ?string $note)
    {
        $r = $this->inTransaction($approve ? 'approve the request' : 'reject the request', function () use ($u, $id, $approve, $note) {
            $r = $this->findRequest($u, $id, true);
            if ($r->status !== 'pending') $this->reject('This request is no longer waiting for approval.', null, 409);

            $stage = $r->currentStage();
            if ($r->requester_id === $u->id) $this->reject('You cannot decide your own request.', null, 403);
            if ($stage === 'admin') {
                if (!$this->canApproveAdmin($u, $r)) {
                    $this->reject('This request is waiting for ' . ($r->adminUser?->name ?? 'the Branch Admin') . '.', null, 403);
                }
            } elseif ($stage === 'manager') {
                // The requester forwards to the manager explicitly (raise-manager); until then it is not the manager's to act on.
                if ($r->manager_status !== 'pending') $this->reject('This request has not been forwarded to the reporting manager yet.', null, 409);
                if ($r->manager_user_id !== $u->id) $this->reject('This request is waiting for ' . ($r->managerUser?->name ?? 'the reporting manager') . '.', null, 403);
                // When the reporting manager IS the Vault Admin (the branch admin
                // most employees report to), the same person gives both approvals
                // — two separate, audited actions, by design. (not two people)
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
            // The manager stage is no longer opened automatically — the requester forwards it (raise-manager).

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
                    // Admin approved; the requester forwards to the manager (raise-manager), so tell THEM — the manager is notified on the forward.
                    $this->notify([$r->requester_id], 'access_approved', 'Vault Admin approved',
                        "The Vault Admin approved your request to unlock “{$r->credential?->name}”. Forward it to your reporting manager to continue.", $extra);
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
    protected function unlock(AccessRequest $r, User $actor): void
    {
        $r->fill(['status' => 'unlocked', 'unlocked_at' => now(), 'expires_at' => now()->addMinutes($r->duration_minutes)])->save();
        $this->audit($actor, 'unlock', $r->credential, "Unlocked for {$r->duration_minutes} min after all checks passed",
            ['request_id' => $r->id, 'requester_id' => $r->requester_id], 'Critical Vault');
    }

    /** Ends every unlock whose window has passed. One indexed read when there is nothing to do. */
    protected function sweepUnlocks(int $clientId): void
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

    protected function assertUnlocked(Credential $c, User $u): void
    {
        if (!$c->isProtected()) return;
        if ($this->opensDirectly($u, $c)) return;
        if ($this->unlockedFor($c, $u)) return;

        abort(response()->json([
            'status'  => false,
            'code'    => 'locked',
            'message' => 'This credential is locked. Request access and complete every unlock step first.',
        ], 423));
    }

    protected function unlockedFor(Credential $c, User $u): ?AccessRequest
    {
        return AccessRequest::where('credential_id', $c->id)->where('requester_id', $u->id)
            ->where('status', 'unlocked')->where('expires_at', '>', now())->first();
    }

    protected function findRequest(User $u, int $id, bool $lock = false): AccessRequest
    {
        $q = AccessRequest::where('client_id', $u->client_id)->with(self::REQUEST_RELATIONS);
        if ($lock) $q->lockForUpdate();
        $r = $q->find($id) ?? $this->reject('Access request not found.', null, 404);

        $visible = $this->isAdmin($u) || in_array($u->id, [$r->requester_id, $r->admin_user_id, $r->manager_user_id], true)
            || $this->canApproveAdmin($u, $r);
        if (!$visible) $this->reject('Access request not found.', null, 404);

        return $r;
    }

    /* ═════════════════════════════ HEALTH ═════════════════════════════ */

    /** Credentials the user can fix: owned, or administered (HOD / Vault Admin) — never ones only shared with them. */
    protected function healthScope(User $u): Collection
    {
        $all = $this->visibleQuery($u)->select(self::LIGHT_COLUMNS)->with('owner:id,name')->get();
        $acc = $this->accessMap($all, $u);

        return $all->filter(fn ($c) => in_array($acc[$c->id][1] ?? null, ['owner', 'admin', 'branch', 'manager', 'hod', 'team'], true))
            ->each(fn ($c) => $c->setAttribute('_rank', $acc[$c->id][0]))->values();
    }

    /** Every open issue across $creds, sorted by severity then credential ID. */
    protected function healthIssues(Collection $creds, array $pol, ?User $u = null): array
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
    protected function issueCredential(?Credential $c, ?AuditLog $fallback = null): array
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
            'strength' => $c->strength, 'strength_label' => (Credential::STRENGTH_LABELS[$c->strength] ?? '') ?: null, 'has_password' => $c->has_password,
        ];
    }

    /**
     * The issues of one credential, its reuse read against the same vaults the
     * Health list checks — so a save resolves exactly what the list showed.
     */
    protected function singleIssues(Credential $c, array $pol, array $scopeIds = []): array
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
    protected function issuesOf(Credential $c, array $pol, array $reusedWith, array $shares): array
    {
        $crit = $c->risk === 'critical';
        $out  = [];

        if ($c->has_password && $c->strength < $pol['min_strength']) {
            // D34: Fair counts as weak. The level is named, never scored (D5).
            $label = Credential::STRENGTH_LABELS[$c->strength] ?? '';
            $out[] = ['type' => 'weak', 'severity' => ($crit || $c->strength <= 2) ? 'critical' : 'high',
                'issue' => $c->strength <= 2 ? 'Weak password' : 'Password below the policy minimum',
                'detail' => "Strength {$label} — the policy needs " . Credential::STRENGTH_LABELS[$pol['min_strength']] . ' or stronger',
                'details' => ['strength' => $c->strength, 'strength_label' => $label, 'policy_minimum' => Credential::STRENGTH_LABELS[$pol['min_strength']]],
                'action' => 'Replace with a generated password (20 characters)'];
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
    protected function rotationState(Credential $c, array $pol): array
    {
        if (!$c->has_password || !$c->rotation_days) return ['state' => null, 'due' => null, 'age' => null];

        $since = $c->password_changed_at ?? $c->updated_at ?? now();
        $age   = (int) $since->diffInDays(now());
        $due   = $since->copy()->addDays($c->rotation_days);
        $state = $age > $c->rotation_days ? 'over' : ($c->rotation_days - $age <= $pol['rotation_warn'] ? 'soon' : 'ok');

        return ['state' => $state, 'due' => $due->toIso8601String(), 'age' => $age];
    }

    /** [credential_id => ['n' => live shares, 'full' => of which Full Access]] in one query. */
    protected function liveShareCounts(array $ids): array
    {
        return collect($this->shareBreakdown($ids))->map(fn ($p) => ['n' => array_sum($p), 'full' => $p['full'] ?? 0])->all();
    }

    /** [credential_id => [permission => live shares]] in one query. */
    protected function shareBreakdown(array $ids): array
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
    protected function savePolicies(User $u, array $changes)
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

    /**
     * What the user sees in the bin: theirs, what they binned, team items for a Vault Admin,
     * and — for a Branch Admin — the branch's team items and every Critical Vault item of the
     * branch (a Branch Admin is the one who restores or deletes those). $vault narrows it.
     */
    protected function binQuery(User $u, ?string $vault = null): Builder
    {
        $admin  = $this->isAdmin($u);
        $branch = $this->adminBranchOf($u);

        return Credential::onlyTrashed()->where('credvault_credentials.client_id', $u->client_id)
            ->when($vault, fn ($q) => $q->where('vault', $vault))
            ->where(function ($w) use ($u, $admin, $branch) {
                $w->where('owner_id', $u->id)->orWhere('deleted_by', $u->id);
                if ($admin) $w->orWhere('scope', 'team');
                if ($branch) $w->orWhere(fn ($b) => $this->inBranch($b, $u->client_id, $branch)
                    ->where(fn ($s) => $s->where('scope', 'team')->orWhere('vault', 'critical')));
            });
    }

    /** A credential of the branch: filed under it, or owned by someone in it. */
    protected function inBranch(Builder $q, int $clientId, int $branch): Builder
    {
        return $q->where(fn ($x) => $x->where('credvault_credentials.branch_id', $branch)
            ->orWhereIn('owner_id', User::where('client_id', $clientId)->where('branch_id', $branch)->select('id')));
    }

    /**
     * Whether the user may restore or permanently delete a binned item. A Critical Vault item
     * is the Branch Admin's alone — of the branch it belongs to; anything else the user sees
     * in the bin (binQuery) is theirs to restore. null = allowed, else the reason.
     */
    protected function binDenial(User $u, Credential $c): ?string
    {
        if ($c->vault !== 'critical') return null;
        $branch = $this->adminBranchOf($u);
        $ownerBranch = $branch ? User::whereKey($c->owner_id)->value('branch_id') : null;

        return $branch && ((int) $c->branch_id === $branch || (int) $ownerBranch === $branch)
            ? null : 'Only the Branch Admin can restore or delete Critical Vault items in the Recycle Bin.';
    }

    /** Purges everything past retention — both vaults, each item by its branch's period. Returns how many went. */
    protected function purgeExpired(int $clientId, array $pol, ?int $actorId = null): int
    {
        $old = $this->wherePastRetention(Credential::onlyTrashed()->where('credvault_credentials.client_id', $clientId), $pol)
            ->select('credvault_credentials.*')->selectRaw(self::BIN_BRANCH_SQL . ' as bin_branch')->get();
        foreach ($old as $c) {
            $days = Policy::binDays($pol, $c->bin_branch);
            $this->purgeOne($c, $actorId, "Deleted automatically after {$days} days in the bin");
        }

        return $old->count();
    }

    /** The branch whose period a binned credential follows: the one it is filed under, else its owner's. */
    protected const BIN_BRANCH_SQL = 'coalesce(credvault_credentials.branch_id, (select users.branch_id from users where users.id = credvault_credentials.owner_id))';

    /**
     * Narrows $q to binned items past their branch's period — or, with $withinDays, due to
     * go within that many days ("Expiring soon"). A branch without its own period follows
     * the company's.
     */
    protected function wherePastRetention(Builder $q, array $pol, int $withinDays = 0): Builder
    {
        $own = $pol['bin_branch_days'] ?? [];
        $cut = fn (int $days) => $withinDays ? now()->subDays($days)->addDays($withinDays) : now()->subDays($days);
        $op  = $withinDays ? '<=' : '<';

        return $q->where(function ($w) use ($own, $pol, $cut, $op) {
            foreach ($own as $branch => $days) {
                $w->orWhere(fn ($x) => $x->whereRaw(self::BIN_BRANCH_SQL . ' = ?', [(int) $branch])
                    ->where('credvault_credentials.deleted_at', $op, $cut((int) $days)));
            }
            // Everything else — no branch, or a branch without its own period — on the company's.
            $w->orWhere(fn ($x) => $x->when($own, fn ($y) => $y->where(fn ($b) => $b->whereRaw(self::BIN_BRANCH_SQL . ' is null')
                    ->orWhereRaw(self::BIN_BRANCH_SQL . ' not in (' . implode(',', array_map('intval', array_keys($own))) . ')')))
                ->where('credvault_credentials.deleted_at', $op, $cut((int) $pol['bin_days'])));
        });
    }

    /** The branch a binned credential belongs to, for its period. */
    protected function binBranchOfCredential(Credential $c): ?int
    {
        $b = $c->branch_id ?: User::whereKey($c->owner_id)->value('branch_id');

        return $b ? (int) $b : null;
    }

    /**
     * The branch whose period the user sees and sets: a Branch Admin's branch, an employee's
     * own branch; null for a Vault Admin (the company period).
     */
    protected function binBranchFor(User $u): ?int
    {
        if ($b = $this->adminBranchOf($u)) return $b;

        return !$this->isAdmin($u) && $u->branch_id ? (int) $u->branch_id : null;
    }

    /** Where the viewer's period comes from: their branch's own, or the company's. */
    protected function binRetentionScope(User $u, array $pol): array
    {
        $b = $this->binBranchFor($u);

        return [
            'branch'  => $b ? ['id' => $b, 'name' => Branch::whereKey($b)->value('name')] : null,
            'source'  => $b && isset($pol['bin_branch_days'][$b]) ? 'branch' : 'company',
            'applies' => 'both',
        ];
    }

    protected function purgeOne(Credential $c, ?int $actorId, string $detail): void
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
     * vault · all = both; never ones that are only shared with the user,
     * and never Critical Vault ones.
     * $light skips the encrypted columns — for counting, not for writing.
     */
    protected function fileScope(User $u, string $scope, bool $light = false): Collection
    {
        $q   = $this->visibleQuery($u)->with(['owner:id,name', 'department:id,name'])->orderBy('code');
        $all = $light ? $q->get(self::LIGHT_COLUMNS) : $q->get();
        $acc = $this->accessMap($all, $u);

        return $all->filter(function ($c) use ($acc, $scope, $u) {
            $via = $acc[$c->id][1] ?? null;
            if ($via === 'share' || $via === null) return false;
            // A backup is the My Vault / Team Vault file: Critical Vault credentials never leave in one.
            if ($c->isCriticalVault()) return false;
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
    protected function fileSecret(Credential $c): array
    {
        if ($c->isProtected()) return ['[Protected — unlock in CredVault]', true];
        if (($c->_rank ?? 0) < self::RANK_COPY) return ['[No copy permission]', true];

        $def = Credential::typeDef($c->type);
        return [($def['sec'] ? ($c->fields[$def['sec']] ?? null) : null) ?? ($c->has_password ? $c->secret : '') ?? '', false];
    }

    /** The export file's columns — every column of the credentials table, in its order. */
    protected const EXPORT_COLUMNS = ['Sr. No', 'Credential ID', 'Created On', 'Credential Name', 'Website / App', 'Type', 'Category', 'Username',
        'Owner', 'Access', 'Department', 'Vault', 'Risk', 'Strength', '2FA', 'Rotation (days)', 'Last Updated'];

    /**
     * The export rows: EXPORT_COLUMNS, then [Password / Secret], [Notes].
     *
     * @return array{0:array,1:array,2:int} columns, rows, secrets withheld
     */
    protected function exportRows(Collection $creds, bool $withSecrets, bool $withNotes): array
    {
        $cols = self::EXPORT_COLUMNS;
        if ($withSecrets) $cols[] = 'Password / Secret';
        if ($withNotes)   $cols[] = 'Notes';

        $withheld = 0;
        $via = ['owner' => 'Personal', 'admin' => 'Team', 'branch' => 'Team', 'manager' => 'Team', 'hod' => 'Team', 'team' => 'Team', 'share' => 'Shared with you'];
        $rows = $creds->values()->map(function ($c, $i) use ($withSecrets, $withNotes, &$withheld, $via) {
            $r = [
                'Sr. No' => $i + 1, 'Credential ID' => $c->code, 'Created On' => $c->created_at?->format('d/m/Y'),
                'Credential Name' => $c->name, 'Website / App' => $c->url ?? '', 'Type' => Credential::typeDef($c->type)['label'] ?? $c->type,
                'Category' => $c->category_group, 'Username' => $c->username ?? '', 'Owner' => $c->owner?->name,
                'Access' => $c->scope === 'team' && ($c->_via ?? null) === 'owner' ? 'Team' : ($via[$c->_via ?? ''] ?? ($c->scope === 'team' ? 'Team' : 'Personal')),
                'Department' => $c->department?->name ?? '', 'Vault' => $c->vault === 'critical' ? 'Critical' : 'Normal',
                'Risk' => ucfirst($c->risk), 'Strength' => Credential::STRENGTH_LABELS[$c->strength] ?? '',
                '2FA' => ['yes' => 'Enabled', 'no' => 'Not enabled', 'na' => 'N/A'][$c->twofa] ?? '', 'Rotation (days)' => $c->rotation_days ?? '',
                'Last Updated' => $c->updated_at?->format('d/m/Y H:i'),
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
    protected const BACKUP_KEYS = [
        'name' => 'Name', 'type' => 'Type', 'category' => 'Category', 'url' => 'Website', 'username' => 'Username',
        'password' => 'Password', 'owner' => 'Owner', 'vault' => 'Vault', 'risk' => 'Risk', 'twofa' => '2FA',
        'rotation' => 'Rotation', 'notes' => 'Notes', 'updated' => 'Updated',
    ];

    /**
     * The backup's rows, keyed as BACKUP_KEYS (the JSON keeps those keys).
     *
     * @return array{0:array,1:array,2:int} key => header map (password dropped when not included), rows, secrets withheld
     */
    protected function backupRows(Collection $creds, bool $withSecrets): array
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

    /**
     * The Excel backup's type tabs — one per type in the backup, laid out exactly as that type's
     * import sheet, so a tab can be imported back. Secret fields are written only with
     * passwords included, and never for a protected (locked critical) credential.
     */
    protected function backupTypeSheets(Collection $creds, bool $withSecrets): array
    {
        $sheets = [];
        foreach ($creds->groupBy('type') as $type => $set) {
            if (!Credential::typeDef($type)) continue;
            $secretKeys = collect(Credential::typeDef($type)['fields'])->where('secret', true)->pluck('key')->all();
            $rows = $set->map(function ($c) use ($withSecrets, $secretKeys) {
                $open = $withSecrets && !$c->isProtected();
                $f = $c->fields ?? [];
                $r = ['credential_name' => $c->name, 'twofa' => $c->twofa === 'yes' ? 'Yes' : ($c->twofa === 'no' ? 'No' : ''),
                    'reg_email' => $f['_reg_email'] ?? '', 'reg_phone' => $f['_reg_phone'] ?? '', 'recovery_key' => $open ? ($f['_recovery_key'] ?? '') : '',
                    'risk' => $c->risk === 'critical' ? 'High' : ucfirst($c->risk), 'rotation_days' => (string) ($c->rotation_days ?? ''),
                    'notes' => $c->isProtected() ? '' : ($c->notes ?? '')];
                foreach ($f as $k => $v) {
                    if (str_starts_with($k, '_')) continue;
                    $r[$k] = in_array($k, $secretKeys, true) && !$open ? '' : (is_bool($v) ? ($v ? 'Yes' : 'No') : (string) $v);
                }
                return $r;
            })->all();
            $sheets[] = ImportTemplate::sheet($type, $rows);
        }

        return $sheets;
    }

    protected function transferHistory(Request $request, string $kind)
    {
        $u = $this->tenantUser($request);
        $f = $request->validate(['page' => ['nullable', 'integer', 'min:1'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100'], 'mine' => ['nullable', 'boolean']]);

        $page = Transfer::where('client_id', $u->client_id)->where('kind', $kind)
            ->when(!$this->isAdmin($u) || ($f['mine'] ?? false), fn ($q) => $q->where('user_id', $u->id))
            ->with('user:id,name')->orderByDesc('id')
            ->paginate($f['per_page'] ?? self::PAGE_SIZE, ['*'], 'page', $f['page'] ?? 1);
        $this->userInfo(collect($page->items())->pluck('user_id')->unique()->all());
        $from = ($page->currentPage() - 1) * $page->perPage();

        return response()->json([
            'status'  => true,
            'data'    => collect($page->items())->values()->map(fn ($t, $i) => ['sr_no' => $from + $i + 1] + $this->transferRow($t, $u))->values(),
            'records' => $page->total(),
            'meta'    => $this->pageMeta($page),
        ], 200);
    }

    /**
     * Header aliases — the prototype's IR_ALIAS first, in its order, then the
     * dotted keys a nested Bitwarden JSON export flattens to.
     */
    protected const IMPORT_ALIASES = [
        'name'     => ['name', 'title', 'account', 'service', 'credential name', 'credential'],
        'url'      => ['url', 'login_uri', 'website', 'uri', 'site', 'web site', 'link', 'login.uris.uri', 'login.uri'],
        'username' => ['username', 'login_username', 'user', 'login', 'email', 'user name', 'login name', 'login.username'],
        'password' => ['password', 'login_password', 'pass', 'secret', 'login.password'],
        'category' => ['category', 'folder', 'grouping', 'group', 'tags', 'type'],
        'notes'    => ['notes', 'note', 'extra', 'comments', 'comment', 'description'],
    ];

    protected function importColumnMap(array $headers): array
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
    protected function detectSource(array $h): string
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

    protected function importCacheKey(User $u, string $token): string
    {
        return "credvault:import:{$u->client_id}:{$u->id}:{$token}";
    }

    /* ═════════════════════════════ SERIALISERS ═════════════════════════════ */

    protected const STAGE_LABELS = ['admin' => 'Vault Admin', 'manager' => 'Reporting Manager', 'otp' => '2-Step Code'];

    /** The code step, named after the credential's 2-step method. */
    protected function otpLabel(?Credential $c): string
    {
        return $c?->twofa_method === 'email' ? 'Email code' : 'Authenticator';
    }

    protected function row(Credential $c, User $u, array $pol, ?array $acc, ?AccessRequest $req, int $shareCount): array
    {
        $def   = Credential::typeDef($c->type);
        $rot   = $this->rotationState($c, $pol);
        $steps = $c->lockSteps();

        return [
            'id'                => $c->id,
            'code'              => $c->code,
            'critical_code'     => $c->criticalCode(),
            'vault'             => $c->vault,
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
            // The name only (Weak / Fair / Good / Strong); null when the type has no password. The level sorts.
            'strength'          => (Credential::STRENGTH_LABELS[$c->strength] ?? '') ?: null,
            'strength_level'    => $c->strength,
            'has_password'      => $c->has_password,
            'twofa'             => $c->twofa,
            'two_step'          => $c->isCriticalVault() && $c->lock_otp ? [
                'method' => $c->twofa_method, 'label' => $this->otpLabel($c), 'linked' => $c->twoStepLinked(),
                'sent_to' => $c->twofa_method === 'email' ? Credential::maskEmail($c->twofa_email) : null,
            ] : null,
            'rotation_days'     => $c->rotation_days,
            'next_rotation_due' => $rot['due'],
            'rotation_state'    => $rot['state'],
            'protected'         => $steps !== [],
            'lock_steps'        => $steps,
            'access'            => $acc ? ['permission' => CredentialShare::PERMISSIONS[$acc[0]], 'via' => $acc[1],
                // Who shared it with the viewer (live shares to them or their team): the Share popup leaves them out.
                'shared_by'     => collect($this->sharedToMeBy($u, $c))->map(fn ($name, $id) => ['id' => $id, 'name' => $name])->values()->all()] : null,
            'can'               => $acc ? $this->canFlags($c, $acc) : null,
            'unlock'            => $steps
                ? ($this->opensDirectly($u, $c) ? ['state' => 'open', 'label' => 'Open — Vault Admin'] : $this->unlockState($req, $steps))
                : null,
            'active_shares'     => $shareCount,
            'created_at'        => $c->created_at?->toIso8601String(),
            'updated_at'        => $c->updated_at?->toIso8601String(),
        ];
    }

    /** What the row's and the drawer's buttons may do. */
    protected function canFlags(Credential $c, array $acc): array
    {
        return [
            'reveal' => $acc[0] >= self::RANK_VIEW,
            'copy'   => $acc[0] >= self::RANK_COPY,
            'edit'   => $acc[0] >= self::RANK_FULL,
            'share'  => $acc[0] >= self::RANK_FULL,
            'delete' => $acc[0] >= self::RANK_FULL && $acc[1] !== 'share' && ($c->risk !== 'critical' || in_array($acc[1], ['owner', 'admin', 'branch'], true)),
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
    /**
     * The View drawer. $plain (the single GET only): every stored value in plain text — passwords
     * and secret fields, recovery key, registered email / phone, notes — for anyone allowed to
     * reveal (View or higher), and only while the credential is open: a locked Critical Vault
     * credential still shows nothing until its unlock, and Use Only never sees a secret.
     */
    protected function detail(Credential $c, User $u, array $acc, bool $plain = false): array
    {
        $pol   = Policy::for($u->client_id);
        $def   = Credential::typeDef($c->type);
        $steps = $c->lockSteps();
        $req   = $steps ? ($this->openRequestsFor($u, [$c->id])[$c->id] ?? null) : null;
        $open  = !$steps || $this->opensDirectly($u, $c) || ($req && $req->isLive());
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
            $plain = $plain && $acc[0] >= self::RANK_VIEW;
            $out['fields'] = collect($def['fields'])->filter(fn ($f) => $f['kind'] !== 'toggle')->map(function ($f) use ($stored, $files, $plain) {
                if ($f['kind'] === 'file') {
                    $file = $files->get($f['key']);
                    return ['key' => $f['key'], 'label' => $f['label'], 'kind' => 'file', 'value' => $file['name'] ?? null,
                        'masked' => false, 'has_value' => (bool) $file, 'attachment_key' => $file ? $f['key'] : null];
                }
                return [
                    'key' => $f['key'], 'label' => $f['label'], 'kind' => $f['kind'],
                    'value' => $f['secret'] && !$plain ? null : ($stored[$f['key']] ?? null),
                    'masked' => $f['secret'] && !$plain, 'secret' => $f['secret'], 'has_value' => filled($stored[$f['key']] ?? null),
                ];
            })->values();
            $out['recovery'] = [
                'reg_email' => $stored['_reg_email'] ?? null,
                'reg_phone' => $stored['_reg_phone'] ?? null,
                'has_recovery_key' => filled($stored['_recovery_key'] ?? null),
            ] + ($plain ? ['recovery_key' => $stored['_recovery_key'] ?? null] : []);
            // Notes are encrypted like a secret: Use Only ("never see it") gets none.
            $out['notes'] = $acc[0] >= self::RANK_VIEW ? $c->notes : null;
            $out['has_notes'] = filled($c->notes);
            $out['attachments'] = $files->reject(fn ($a, $k) => collect($def['fields'])->contains('key', $k))
                ->map(fn ($a) => collect($a)->except('path')->all())->values();
            if ($plain) {
                // Everything stored, in one flat map: every type field, the recovery details and the notes.
                $vals = [];
                foreach ($def['fields'] as $f) {
                    $vals[$f['key']] = $f['kind'] === 'file' ? ($files->get($f['key'])['name'] ?? null)
                        : ($f['kind'] === 'toggle' ? $c->twofa : ($stored[$f['key']] ?? null));
                }
                $out['all_values'] = $vals + [
                    'reg_email' => $stored['_reg_email'] ?? null, 'reg_phone' => $stored['_reg_phone'] ?? null,
                    'recovery_key' => $stored['_recovery_key'] ?? null, 'notes' => $c->notes,
                ];
            }
        }

        if ($acc[0] >= self::RANK_FULL) {
            $out['shares'] = CredentialShare::live()->where('credential_id', $c->id)
                ->with(['recipientUser:id,name,designation,branch_id', 'recipientUser.branch:id,name', 'recipientDepartment:id,name', 'credential:id,code,name,type,risk,url,category_group,updated_at'])
                ->orderByDesc('id')->get()->map(fn ($s) => $this->shareRow($s, $u->client_id));
            $out['protection'] = [
                'admin'        => $c->lock_admin,
                'admin_user'   => $c->lock_admin_user_id ? User::whereKey($c->lock_admin_user_id)->first(['id', 'name']) : null,
                'manager'      => $c->lock_manager,
                'manager_user' => $c->lock_manager_user_id ? User::whereKey($c->lock_manager_user_id)->first(['id', 'name']) : null,
                'otp'          => $c->lock_otp, 'otp_linked' => $c->twoStepLinked(),
                'otp_method'   => $c->twofa_method,
                'otp_email'    => $c->twofa_method === 'email' ? $c->twofa_email : null,
                'policy'       => ['admin' => $pol['cp_admin'], 'manager' => $pol['cp_manager'], 'otp' => $pol['cp_otp']],
            ];
        }

        return $out;
    }

    /** The stepper before any request exists: each step and who will answer it, for the requester looking. */
    protected function unlockPlan(Credential $c, User $u, array $steps): array
    {
        $pol = Policy::for($u->client_id);
        $person = fn (?int $id, string $role) => $id && ($x = User::whereKey($id)->first(['id', 'name', 'designation']))
            ? ['id' => $x->id, 'name' => $x->name, 'initials' => $this->initials($x->name), 'role' => $role] : null;

        $out = [];
        foreach ($steps as $i => $s) {
            // Common Vault Admin = the requester branch's Branch Admin; the
            // manager is the requester's own reporting manager. (new flow)
            $branchAdmin = $this->branchAdminIds($u->branch_id, $u->client_id)[0] ?? null;
            $approver = match ($s) {
                'admin'   => $person($this->liveAdmin($branchAdmin ?: $pol['cp_admin_user_id'], $c->client_id), 'Vault Admin')
                    ?? ['id' => null, 'name' => 'Any Vault Admin', 'initials' => 'VA', 'role' => 'Vault Admin'],
                'manager' => $person($this->managerOf($u), 'Reporting Manager'),
                default   => null,
            };
            $out[] = ['step' => $i + 1, 'key' => $s, 'label' => $s === 'otp' ? $this->otpLabel($c) : self::STAGE_LABELS[$s], 'approver' => $approver,
                'ready' => $s !== 'manager' || $approver !== null];
        }

        return ['steps' => $out, 'of' => count($steps), 'durations' => array_values(array_filter(AccessRequest::DURATIONS, fn ($m) => $m <= $pol['cp_max_minutes'])),
            'asks_reason' => in_array('admin', $steps, true), 'default_minutes' => in_array('admin', $steps, true) ? 15 : AccessRequest::DEFAULT_MINUTES,
            'otp_method' => in_array('otp', $steps, true) ? $c->twofa_method : null,
            'otp_sent_to' => in_array('otp', $steps, true) && $c->twofa_method === 'email' ? Credential::maskEmail($c->twofa_email) : null];
    }

    /**
     * The Critical Vault "Access Status" cell, in the prototype's four states:
     *   open      unlocked, with the countdown
     *   pending   waiting on an approver — who, and as what
     *   progress  approvals in, the authenticator code still to enter
     *   locked    nothing open: "Approval needed"
     */
    protected function unlockState(?AccessRequest $r, array $steps): array
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
        // The manager stage is opened by the requester forwarding it; until then it awaits that forward, not the manager.
        $needsForward = $stage === 'manager' && $r->manager_status !== 'pending';

        return [
            'state'         => $stage === 'otp' ? 'progress' : 'pending',
            'label'         => $needsForward
                ? 'Forward to ' . ($r->managerUser?->name ?? 'your reporting manager')
                : ($stage === 'otp' ? "Step {$n} of " . count($order) . ' · ' . $this->otpLabel($r->credential) : self::STAGE_LABELS[$stage] . ' · ' . $who),
            'stage'         => $stage,
            'needs_forward' => $needsForward,
            'waiting_for'   => $who ? ['name' => $who, 'role' => self::STAGE_LABELS[$stage]] : null,
            'step'          => ['number' => $n, 'of' => count($order)],
            'request_id'    => $r->id,
            'code'          => $r->code,
        ];
    }

    protected function requestSteps(AccessRequest $r): array
    {
        return array_keys(array_filter(['admin' => $r->admin_required, 'manager' => $r->manager_required, 'otp' => $r->otp_required]));
    }

    /**
     * One access request. status is the request's own life (pending, approved
     * = waiting for the code, unlocked, locked, rejected, cancelled);
     * display_status is the Access Request Management screen's three states.
     */
    protected function requestRow(AccessRequest $r, User $u): array
    {
        $stage = $r->currentStage();
        $order = $this->requestSteps($r);
        $approvals = array_values(array_intersect($order, ['admin', 'manager']));
        $c = $r->credential;
        $info = $this->userInfo([$r->requester_id])[$r->requester_id] ?? [];

        $canDecide = $r->status === 'pending' && $r->requester_id !== $u->id && (
            ($stage === 'admin' && $this->canApproveAdmin($u, $r))
            // Manager step: the manager decides — even if they are also the Vault
            // Admin who approved step 1 (RM = branch admin). Two separate actions.
            || ($stage === 'manager' && $r->manager_user_id === $u->id)
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
                : 'Waiting for the ' . ($c?->twofa_method === 'email' ? 'email code' : 'authenticator code'),
            'approved'  => match ($r->status) {
                'approved' => 'Approved · enter the ' . ($c?->twofa_method === 'email' ? 'email code' : 'authenticator code'),
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
                'method'        => $c?->twofa_method,
                'label'         => $this->otpLabel($c),
                'sent_to'       => $c?->twofa_method === 'email' ? Credential::maskEmail($c->twofa_email) : null,
                'verified_at'   => $r->otp_verified_at?->toIso8601String(),
                'attempts_left' => max(0, AccessRequest::MAX_OTP_ATTEMPTS - $r->otp_attempts),
            ] : null,
            'status'           => $r->status,
            'display_status'   => $display,
            'status_label'     => $statusLabel,
            'stage'            => $stage,
            'stage_label'      => $stage ? ($stage === 'otp' ? $this->otpLabel($c) : self::STAGE_LABELS[$stage]) : null,
            'steps'            => $order,
            'step'             => $stage ? ['number' => array_search($stage, $order, true) + 1, 'of' => count($order), 'label' => $stage === 'otp' ? $this->otpLabel($c) : self::STAGE_LABELS[$stage]] : null,
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
                'send_otp'   => $r->requester_id === $u->id && $r->status === 'approved' && $stage === 'otp' && $c?->twofa_method === 'email',
                'lock'       => $r->isLive() && ($r->requester_id === $u->id || $this->isAdmin($u)),
            ],
            'created_at'       => $r->created_at?->toIso8601String(),
        ];
    }

    protected const SHARE_STATE_LABELS = ['active' => 'Active', 'soon' => 'Expiring soon', 'expired' => 'Expired', 'revoked' => 'Revoked'];

    /**
     * One share, for every list and response that shows one. Beside the raw ISO times it carries the
     * Shared By Me table's cells, ready to show: shared_on {date, time}, expires {date, left}, status_label.
     */
    protected function shareRow(CredentialShare $s, ?int $clientId = null, ?string $tz = null, ?User $viewer = null): array
    {
        $c = $s->credential;
        $tz ??= config('app.timezone');
        $members = $s->recipient_type === 'team' && $clientId ? ($this->memberCounts($clientId)[$s->recipient_department_id] ?? 0) : null;
        $state = $s->state();
        $left = match (true) {
            $state === 'revoked'      => 'Revoked',
            !$s->expires_at           => 'No expiry',
            $s->expires_at->isPast()  => 'Expired',
            now()->diffInHours($s->expires_at) < 24 => max(1, (int) ceil(now()->diffInMinutes($s->expires_at) / 60)) . 'h left',
            default                   => ($d = (int) ceil(now()->diffInHours($s->expires_at) / 24)) . ' ' . Str::plural('day', $d) . ' left',
        };
        $mine = $viewer && ($s->shared_by === $viewer->id || $c?->owner_id === $viewer->id);

        return [
            'id'         => $s->id,
            'credential' => $c ? ['id' => $c->id, 'code' => $c->code, 'vault' => $c->vault ?? null, 'name' => $c->name, 'type' => $c->type,
                                  'type_label' => Credential::typeDef($c->type)['label'] ?? $c->type, 'category_group' => $c->category_group ?? null,
                                  'risk' => $c->risk, 'url' => $c->url ?? null, 'username' => $c->username ?? null,
                                  'created_on' => $c->created_at?->copy()->setTimezone($tz)->format('d/m/Y'),
                                  'updated_at' => $c->updated_at?->toIso8601String()] : null,
            'recipient'  => $s->recipient_type === 'user'
                ? ['type' => 'user', 'id' => $s->recipient_user_id, 'name' => $s->recipientUser?->name,
                   'initials' => $this->initials($s->recipientUser?->name), 'sub' => $s->recipientUser?->designation ?: 'Individual',
                   // The branch is the leaf of the hierarchy — lead the access row with it.
                   'branch' => $s->recipientUser?->branch?->name]
                : ['type' => 'team', 'id' => $s->recipient_department_id, 'name' => $s->recipientDepartment?->name,
                   'initials' => $this->initials($s->recipientDepartment?->name),
                   'members' => $members, 'sub' => 'Team' . ($members !== null ? " · {$members} members" : ''), 'branch' => null],
            'permission' => $s->permission,
            'permission_label' => ['use' => 'Use Only', 'view' => 'View', 'copy' => 'Copy', 'full' => 'Full Access'][$s->permission] ?? $s->permission,
            'reason'     => $s->reason,
            'shared_at'  => $s->created_at?->toIso8601String(),
            'shared_on'  => $s->created_at ? ['date' => $s->created_at->copy()->setTimezone($tz)->format('d/m/Y'), 'time' => $s->created_at->copy()->setTimezone($tz)->format('H:i')] : null,
            'updated_at' => $s->updated_at?->toIso8601String(),
            'expires_at' => $s->expires_at?->toIso8601String(),
            'expires'    => ['date' => $s->expires_at?->copy()->setTimezone($tz)->format('d/m/Y'), 'left' => $left],
            'revoked_at' => $s->revoked_at?->toIso8601String(),
            'state'      => $state,
            'status_label' => self::SHARE_STATE_LABELS[$state] ?? ucfirst($state),
            'can'        => $viewer ? [
                'view'   => (bool) $c,
                'share'  => (bool) $c && $mine && $state !== 'revoked',
                'revoke' => $mine && in_array($state, ['active', 'soon'], true),
            ] : null,
        ];
    }

    /** Timeline rows, with the credential's risk and type and each actor's role read in two queries for the page. */
    protected function eventRows(Collection $events, User $u, ?string $tz = null): Collection
    {
        $creds = Credential::withTrashed()->whereIn('id', $events->pluck('credential_id')->filter()->unique()->all())
            ->get(['id', 'risk', 'type', 'vault'])->keyBy('id');
        $this->userInfo($events->pluck('user_id')->filter()->unique()->all());

        return $events->map(fn ($e) => $this->eventRow($e, $u, $creds->get($e->credential_id), $tz))->values();
    }

    protected function eventRow(AuditLog $e, User $u, ?Credential $c = null, ?string $tz = null): array
    {
        $info  = $e->user_id ? ($this->userInfo([$e->user_id])[$e->user_id] ?? []) : [];
        $local = $e->created_at->copy()->setTimezone($tz ?? self::AUDIT_TZ);
        $risk  = $c?->risk ? ucfirst($c->risk) : null;

        return [
            'id'             => $e->id,
            'event_id'       => 'EVT-' . $e->id,
            'at'             => $e->created_at->toIso8601String(),
            // As the timeline prints it: 15:22 over 46s, under the day's heading.
            'date'           => $local->toDateString(),
            'time'           => $local->format('H:i'),
            'seconds'        => $local->format('s') . 's',
            'local_at'       => $local->toIso8601String(),
            'chip'           => $e->credential_id ? trim(($e->credential_code ?? '') . ($risk ? " · {$risk}" : ''), ' ·') : null,
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
                ? ['id' => $e->credential_id, 'code' => $e->credential_code, 'name' => $e->credential_name, 'risk' => $c?->risk, 'risk_label' => $risk,
                   'type' => $c?->type, 'vault' => $c?->vault]
                : null,
            // "Priya Sharma approved access to Kotak Vendor Payments A/c"
            'sentence'       => trim(($e->user_id ? ($e->user_id === $u->id ? 'You' : $e->user?->name) : 'System') . ' ' . (AuditLog::VERBS[$e->action] ?? $e->action)
                . ' ' . ($e->credential_name ?? ($e->credential_id ? $e->credential_code : ''))),
            'target'         => $e->credential_id ? $e->credential_code : 'Vault settings',
            'module'         => $e->module,
            'detail'         => $e->detail,
            'ip'             => $e->ip,
        ];
    }

    protected function transferRow(Transfer $t, ?User $u = null): array
    {
        $scopeLabel = Transfer::SCOPE_LABELS[$t->scope] ?? $t->scope;
        $kb = $t->size_bytes !== null ? max(1, (int) round($t->size_bytes / 1024)) . ' KB' : null;

        return [
            'id' => $t->id, 'code' => $t->code, 'kind' => $t->kind,
            'scope' => $t->scope, 'scope_label' => $scopeLabel,
            'format' => $t->format, 'format_label' => Transfer::FORMAT_LABELS[$t->format] ?? strtoupper((string) $t->format),
            'file_name' => $t->file_name, 'source' => $t->source,
            // The line under the file name: "Bitwarden · into My Vault".
            'source_line' => $t->kind === 'import' ? trim(($t->source ?? '') . ' · into ' . $scopeLabel, ' ·') : null,
            'type' => $t->credential_type, 'type_label' => $t->credential_type ? (Credential::typeDef($t->credential_type)['label'] ?? $t->credential_type) : null,
            'items' => $t->items, 'skipped' => $t->skipped, 'weak' => $t->weak, 'duplicates' => $t->duplicates, 'failed' => (int) $t->failed,
            'size_bytes' => $t->size_bytes, 'size_label' => $t->status === 'failed' && !$t->size_bytes ? null : $kb,
            'include_passwords' => $t->include_passwords, 'locked' => $t->locked,
            'protection' => $t->kind === 'backup' ? ($t->locked ? 'Password locked' : 'Not locked') : null,
            'status' => $t->status,
            'status_label' => $t->status === 'failed' ? 'Failed' : ['backup' => 'Downloaded', 'import' => 'Imported', 'export' => 'Downloaded'][$t->kind] ?? 'Done',
            'failure_reason' => $t->failure_reason,
            'by' => $t->user?->name, 'by_id' => $t->user_id, 'by_me' => $u ? $t->user_id === $u->id : null,
            'by_display' => $u && $t->user_id === $u->id ? 'You' : $t->user?->name, 'by_initials' => $this->initials($t->user?->name),
            'by_role' => ($this->userInfo([$t->user_id])[$t->user_id]['role_line'] ?? null),
            'at' => $t->created_at?->toIso8601String(),
        ];
    }

    /**
     * Designation, department and the one-line role the screens print under a
     * name ("Vault Administrator", "Executive · Accounts", "Team member"),
     * for a batch of users. Cached for the request, so repeated rows cost nothing.
     */
    protected function userInfo(array $ids): array
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
    protected function usersInDepartmentsLike(int $clientId, string $like): array
    {
        $deps = Departments::where(fn ($w) => $w->whereNull('client_id')->orWhere('client_id', $clientId))
            ->whereRaw('lower(name) like ?', [$like])->pluck('id')->all();
        if (!$deps) return [];

        return User::where('client_id', $clientId)->whereIn('department_id', $deps)->pluck('id')
            ->merge(Employee::where('client_id', $clientId)->whereIn('department_id', $deps)->whereNotNull('user_id')->pluck('user_id'))
            ->unique()->values()->all();
    }

    /* ═══════════════════════════ ACCESS MODEL ═══════════════════════════ */

    /**
     * Every credential the user can reach by any route — the base of each list.
     *
     * Team credentials, by who is asking:
     *   Vault Admin (client admin)  every team credential;
     *   Branch Admin (branch user)  the branch's — owned by its people below them;
     *   manager                     the ones owned by their downline (HOD → TL → Employee → Intern);
     *   HOD                         their department's (see accessMap for the rights).
     * A peer outside the reporting line sees none of them — only a share reaches them.
     *
     * $branchCritical (the Critical Vault list only): a Branch Admin / employee also sees
     * every Critical Vault credential of their branch — personal or team, any owner — not
     * just their own or their team, still locked behind its approvals (accessMap: View, via
     * branch_critical). The Branch Admin opens them directly; everyone else via the steps.
     */
    protected function visibleQuery(User $u, bool $branchCritical = false): Builder
    {
        $heads  = $this->headedDepts($u);
        $admin  = $this->isAdmin($u);
        $branch = $this->adminBranchOf($u);
        $down   = $this->downlineIds($u);
        // Critical Vault list: everyone in the branch sees EVERY critical
        // credential of the branch — personal or team, any owner — not just
        // their own or their team. The reveal still runs the approval flow
        // (accessMap gives View via branch_critical; the Branch Admin opens it
        // directly). Only for a Branch Admin / employee; the client admin keeps
        // its company-wide team-scope rule below. (new flow)
        $critBranch = ($branchCritical && !$admin) ? ($branch ?? ($u->branch_id ? (int) $u->branch_id : null)) : null;

        // People this viewer oversees: their whole vault (personal and team) is visible,
        // as these are company credentials. Reveal stays gated by accessMap, not this list.
        $overseen = $this->overseenUserIds($u);

        return Credential::where('credvault_credentials.client_id', $u->client_id)->where(function ($w) use ($u, $heads, $admin, $branch, $down, $critBranch, $overseen) {
            $w->where('owner_id', $u->id)->orWhereIn('credvault_credentials.id', $this->sharedWithMeIds($u));
            if ($critBranch) $w->orWhere(fn ($t) => $t->where('vault', 'critical')->where('credvault_credentials.branch_id', $critBranch));
            if ($overseen) $w->orWhereIn('owner_id', $overseen);
            if ($admin) {
                $w->orWhere('scope', 'team');
                return;
            }
            if ($heads) $w->orWhere(fn ($t) => $t->where('scope', 'team')->whereIn('department_id', $heads));
            if ($branch) {
                $below = User::where('client_id', $u->client_id)->whereNotIn('user_type', self::ADMIN_TYPES);
                $w->orWhere(fn ($t) => $t->where('scope', 'team')->where(fn ($b) => $b
                    ->whereIn('owner_id', (clone $below)->where('branch_id', $branch)->select('id'))
                    ->orWhere(fn ($x) => $x->where('credvault_credentials.branch_id', $branch)->whereIn('owner_id', (clone $below)->select('id')))));
            }
            if ($down) $w->orWhere(fn ($t) => $t->where('scope', 'team')->whereIn('owner_id', $down));
        });
    }

    /** The logins that sit above every employee: no one below them gets rights over what they own. */
    protected const ADMIN_TYPES = ['super_admin', 'client_admin', 'branch_user'];

    /** A level's place, top first — a smaller number is higher up. */
    protected const LEVEL_ORDER = ['admin' => 0, 'hod' => 1, 'tl' => 2, 'exec' => 3, 'emp' => 4, 'intern' => 5];

    /** The branch a Branch Admin (branch user) runs, else null. */
    protected function adminBranchOf(User $u): ?int
    {
        return $u->isBranchUser() && $u->branch_id ? (int) $u->branch_id : null;
    }

    /**
     * The Branch Admin (Vault Admin) opens every Critical credential in their branch
     * directly — no approval, no OTP. Keyed on the branch, not on ownership.
     */
    protected function opensDirectly(User $u, Credential $c): bool
    {
        $branch = $this->adminBranchOf($u);
        if ($branch === null) return false;
        if ((int) $c->branch_id === $branch) return true;
        $ob = $this->memo("ownerbranch:{$c->owner_id}", fn () => (int) (User::whereKey($c->owner_id)->value('branch_id') ?? 0));

        return $ob === $branch;
    }

    /** The Branch Admins (branch users) that serve as the Vault Admin for one branch. */
    protected function branchAdminIds(?int $branchId, int $clientId): array
    {
        if (!$branchId) return [];

        return $this->memo("badmins:{$clientId}:{$branchId}", fn () => User::where('client_id', $clientId)
            ->where('user_type', 'branch_user')->where('status', 'active')->where('branch_id', (int) $branchId)
            ->orderBy('id')->pluck('id')->map(fn ($i) => (int) $i)->all());
    }

    /** The branch a request belongs to — the requester's, else the credential's. */
    protected function requestBranch(AccessRequest $r): ?int
    {
        return ($r->requester?->branch_id ?: $r->credential?->branch_id) ? (int) ($r->requester?->branch_id ?: $r->credential->branch_id) : null;
    }

    /**
     * May $u approve the Vault-Admin stage of request $r? The Branch Admin it names,
     * or any Branch Admin of that branch when none is named — with a client admin as a
     * safety net so a request never gets stuck if the branch admin is gone.
     */
    protected function canApproveAdmin(User $u, AccessRequest $r): bool
    {
        if ($r->admin_user_id) return (int) $r->admin_user_id === (int) $u->id || $this->isAdmin($u);

        return in_array((int) $u->id, $this->branchAdminIds($this->requestBranch($r), $r->client_id), true) || $this->isAdmin($u);
    }

    /**
     * The Recycle Bin's Vault Admin: the client admin or a Branch Admin. Only they change the
     * retention period and delete permanently (an item, or Empty Bin); everyone else may only restore.
     */
    protected function binAdmin(User $u): bool
    {
        return $this->isAdmin($u) || $this->adminBranchOf($u) !== null;
    }

    /**
     * The logins below the user in the reporting chain, at any depth (HOD → TL →
     * Employee → Intern), never the user. Read from the HR employee records by either
     * link HR may have used (reporting_manager_id / reporting_manager_user_id); a loop
     * in the chain stops where it repeats.
     */
    protected function downlineIds(User $u): array
    {
        return $this->memo("down:{$u->id}", function () use ($u) {
            $me = $this->employeeOf($u);
            [$children, $userOf, $underUser] = $this->reportingTree($u->client_id);

            // Start from the user's employee record and from links that name the login itself.
            $out = []; $seen = $me ? [$me->id => true] : []; $queue = [];
            foreach (array_merge($me ? ($children[$me->id] ?? []) : [], $underUser[$u->id] ?? []) as $kid) {
                if (isset($seen[$kid])) continue;
                $seen[$kid] = true; $queue[] = $kid;
                if (($uid = $userOf[$kid] ?? null) && $uid !== $u->id) $out[$uid] = $uid;
            }
            while ($queue) {
                $e = array_shift($queue);
                foreach (array_merge($children[$e] ?? [], isset($userOf[$e]) ? ($underUser[$userOf[$e]] ?? []) : []) as $kid) {
                    if (isset($seen[$kid])) continue;
                    $seen[$kid] = true;
                    $queue[] = $kid;
                    if (($uid = $userOf[$kid] ?? null) && $uid !== $u->id) $out[$uid] = $uid;
                }
            }
            return array_values($out);
        });
    }

    /** [manager employee id => [employee ids]], [employee id => login id], [manager login id => [employee ids]] for the tenant. */
    protected function reportingTree(int $clientId): array
    {
        return $this->memo("tree:{$clientId}", function () use ($clientId) {
            $emps   = Employee::where('client_id', $clientId)->get(['id', 'user_id', 'emp_code', 'reporting_manager_id', 'reporting_manager_user_id']);
            $byCode = User::where('client_id', $clientId)->whereNotNull('employee_code')->pluck('id', 'employee_code');
            $userOf = [];
            foreach ($emps as $e) {
                $uid = $e->user_id ?: ($e->emp_code ? ($byCode[$e->emp_code] ?? null) : null);
                if ($uid) $userOf[$e->id] = (int) $uid;
            }
            $children = $underUser = [];
            foreach ($emps as $e) {
                if ($e->reporting_manager_id && (int) $e->reporting_manager_id !== $e->id) $children[(int) $e->reporting_manager_id][] = $e->id;
                elseif ($e->reporting_manager_user_id) $underUser[(int) $e->reporting_manager_user_id][] = $e->id;
            }
            return [$children, $userOf, $underUser];
        });
    }

    /** A user's level: Admin for the admin logins, else from the HR designation. */
    protected function levelOfUser(?User $x): string
    {
        if (!$x) return 'emp';
        if (in_array($x->user_type, self::ADMIN_TYPES, true)) return 'admin';
        return $this->levelOf($this->userInfo([$x->id])[$x->id]['designation'] ?? $x->designation);
    }

    /**
     * [user id => name] of the people who shared $c with $u — live shares to $u or to $u's team — so a
     * Shared With Me credential is never shared back to them. The owner is excluded by the share rules already.
     */
    protected function sharedToMeBy(User $u, Credential $c): array
    {
        return $this->memo("sharedby:{$u->id}:{$c->id}", function () use ($u, $c) {
            $dept = $this->deptOf($u);

            return CredentialShare::live()->where('client_id', $u->client_id)->where('credential_id', $c->id)
                ->where(function ($w) use ($u, $dept) {
                    $w->where(fn ($x) => $x->where('recipient_type', 'user')->where('recipient_user_id', $u->id));
                    if ($dept) $w->orWhere(fn ($x) => $x->where('recipient_type', 'team')->where('recipient_department_id', $dept));
                })
                ->whereNotNull('shared_by')->where('shared_by', '!=', $u->id)
                ->with('sharer:id,name')->get(['id', 'shared_by'])
                ->mapWithKeys(fn ($s) => [(int) $s->shared_by => $s->sharer?->name ?? 'Someone'])->all();
        });
    }

    /** Subquery: ids of credentials with a live share to the user or the user's team. */
    protected function sharedWithMeIds(User $u)
    {
        $dept = $this->deptOf($u);

        return CredentialShare::live()->where('client_id', $u->client_id)->where(function ($w) use ($u, $dept) {
            $w->where(fn ($x) => $x->where('recipient_type', 'user')->where('recipient_user_id', $u->id));
            if ($dept) $w->orWhere(fn ($x) => $x->where('recipient_type', 'team')->where('recipient_department_id', $dept));
        })->select('credential_id');
    }

    /**
     * [id => [rank, via]] for a batch, in one share query.
     * via: owner | admin | branch | manager | hod | team | branch_critical | share
     *
     * Full Access (edit, share, delete) on a team credential goes to the Vault Admin, the
     * Branch Admin of the owner's branch, a manager the owner reports to (at any depth) and
     * the HOD of its department — the last three only over people below them, never over
     * someone above or at their level (a HOD keeps view-and-copy on those in the department).
     * In the Critical Vault every employee of the branch gets View on every credential of
     * their branch (personal or team) via branch_critical: it lists, and opens only through
     * its approval steps — the Branch Admin opens it directly.
     */
    protected function accessMap(Collection $creds, User $u): array
    {
        if ($creds->isEmpty()) return [];

        $dept   = $this->deptOf($u);
        $heads  = $this->headedDepts($u);
        $admin  = $this->isAdmin($u);
        $branch = $this->adminBranchOf($u);
        // The branch whose Critical Vault credentials the viewer may see as View
        // (new flow): a Branch Admin / employee sees their whole branch's; the
        // client admin keeps its own team-scope rule, so null here.
        $critBranch = $admin ? null : ($branch ?? ($u->branch_id ? (int) $u->branch_id : null));
        $down   = array_flip($this->downlineIds($u));
        // Heading a department makes one an HOD whatever the HR designation says.
        $myRank = min(self::LEVEL_ORDER[$this->levelOfUser($u)], $heads ? self::LEVEL_ORDER['hod'] : PHP_INT_MAX);
        $owners = $creds->where('scope', 'team')->isNotEmpty() && !$admin
            ? User::whereIn('id', $creds->where('scope', 'team')->pluck('owner_id')->unique()->all())
                ->get(['id', 'name', 'user_type', 'branch_id', 'designation', 'department_id', 'employee_code', 'client_id'])->keyBy('id')
            : collect();
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
                $owner = $owners->get($c->owner_id);
                $below = $owner && self::LEVEL_ORDER[$this->levelOfUser($owner)] > $myRank;
                if ($admin) $best = [self::RANK_FULL, 'admin'];
                elseif ($branch && $owner && !in_array($owner->user_type, self::ADMIN_TYPES, true)
                    && ((int) $owner->branch_id === $branch || (int) $c->branch_id === $branch)) $best = [self::RANK_FULL, 'branch'];
                elseif (isset($down[$c->owner_id])) $best = [self::RANK_FULL, 'manager'];
                elseif ($c->department_id && in_array($c->department_id, $heads, true)) $best = $below ? [self::RANK_FULL, 'hod'] : [self::RANK_COPY, 'team'];
            }
            // Critical Vault: anyone in the branch sees every critical credential
            // (personal or team) as View — it lists and opens only through the
            // approval steps; the Branch Admin opens it directly. (new flow)
            if (!$best && $critBranch && $c->vault === 'critical' && (int) $c->branch_id === $critBranch) {
                $best = [self::RANK_VIEW, 'branch_critical'];
            }
            if (isset($shareRank[$c->id]) && (!$best || $shareRank[$c->id] > $best[0])) $best = [$shareRank[$c->id], 'share'];
            if ($best) $out[$c->id] = $best;
        }

        return $out;
    }

    /** @return array{0:Credential,1:array} — 404 when out of reach, 403 when below $min. */
    protected function findCredential(User $u, int $id, int $min = self::RANK_USE, string $message = 'You do not have permission for this.'): array
    {
        $c   = Credential::where('client_id', $u->client_id)->with(['owner:id,name', 'department:id,name'])->find($id)
            ?? $this->reject('Credential not found.', null, 404);
        $acc = $this->accessMap(collect([$c]), $u)[$c->id] ?? $this->reject('Credential not found.', null, 404);
        if ($acc[0] < $min) $this->reject($message, null, 403);

        return [$c, $acc];
    }

    /** findCredential, for a vault's own routes: a credential of the other vault reads as 404 there. */
    protected function findInVault(User $u, int $id, string $vault, int $min = self::RANK_USE, string $message = 'You do not have permission for this.'): array
    {
        [$c, $acc] = $this->findCredential($u, $id, self::RANK_USE);
        if ($c->vault !== $vault) {
            $this->reject('This credential is in the ' . ($c->vault === 'critical' ? 'Critical Vault' : 'Normal Vault (My Vault)') . ' — open it there.', null, 404);
        }
        if ($acc[0] < $min) $this->reject($message, null, 403);

        return [$c, $acc];
    }

    /** [credential_id => the user's open request] — a live unlock beats a pending one. */
    protected function openRequestsFor(User $u, array $ids): array
    {
        if (!$ids) return [];

        return AccessRequest::where('requester_id', $u->id)->whereIn('credential_id', $ids)->whereIn('status', AccessRequest::OPEN)
            ->with(['adminUser:id,name', 'managerUser:id,name'])
            ->orderByRaw("case when status = 'unlocked' then 0 else 1 end")->get()
            ->unique('credential_id')->keyBy('credential_id')->all();
    }

    protected function isAdmin(User $u): bool
    {
        // The policy's named approver is chosen from the client admins; once demoted they
        // stop being a Vault Admin, so the client-admin check alone decides.
        return $this->memo("admin:{$u->id}", fn () => $u->isClientAdmin());
    }

    protected function assertAdmin(User $u): void
    {
        if (!$this->isAdmin($u)) $this->reject('Only a Vault Admin can change CredVault Policies.', null, 403);
    }

    /** Active Vault Admins of the client. $withPolicy adds the policy's named admin. */
    /** $id when it is still an active Vault Admin of the client, else null (= any Vault Admin). */
    protected function liveAdmin(?int $id, int $clientId): ?int
    {
        if (!$id) return null;
        $id = (int) $id;

        return $this->memo("liveadmin:{$clientId}:{$id}", function () use ($id, $clientId) {
            if (in_array($id, $this->adminIds($clientId), true)) return $id;
            // A Branch Admin pinned on a request stays the Vault Admin while still an active branch user.
            return User::whereKey($id)->where('client_id', $clientId)
                ->where('user_type', 'branch_user')->where('status', 'active')->exists() ? $id : null;
        });
    }

    /** The admin a request names — dropped once that person stops being a Vault Admin, so the request never sticks. */
    protected function namedAdmin(AccessRequest $r): ?int
    {
        return $this->liveAdmin($r->admin_user_id, $r->client_id);
    }

    protected function adminIds(int $clientId): array
    {
        $ids = $this->memo("admins:{$clientId}", fn () => User::where('client_id', $clientId)->where('user_type', 'client_admin')
            ->where('status', 'active')->pluck('id')->map(fn ($i) => (int) $i)->all());
        // The named approver counts only while still an active client admin (already in $ids).
        return $ids;
    }

    protected function employeeOf(User $u): ?Employee
    {
        return $this->memo("emp:{$u->id}", fn () => Employee::where('client_id', $u->client_id)
            ->where(fn ($w) => $w->where('user_id', $u->id)->when($u->employee_code, fn ($x) => $x->orWhere('emp_code', $u->employee_code)))
            ->orderByRaw('case when user_id = ? then 0 else 1 end', [$u->id])
            ->first(['id', 'user_id', 'emp_code', 'client_id', 'department_id', 'reporting_manager_id', 'reporting_manager_user_id']));
    }

    /**
     * Every login below this user in the reporting tree — direct reports, their
     * reports, and so on down (TL → executive → intern). A report points up by
     * employee id (reporting_manager_id) or, for a branch/login manager, by login
     * id (reporting_manager_user_id). Self is not included (handled as owner).
     */
    protected function reportsSubtree(User $u): array
    {
        return $this->downlineIds($u);
    }

    protected function deptOf(User $u): ?int
    {
        return $this->memo("dept:{$u->id}", function () use ($u) {
            $id = $u->department_id ?: $this->employeeOf($u)?->department_id;
            return $id ? (int) $id : null;
        });
    }

    /**
     * Does $u oversee $m? A Vault Admin (client admin), a branch admin over $m's branch,
     * an HOD of $m's department, or anyone above $m in the reporting line. Such a viewer
     * may see $m's whole vault through the hierarchy filter — these are company credentials.
     */
    protected function managesMember(User $u, User $m): bool
    {
        if ((int) $m->id === (int) $u->id) return false;
        if ($this->isAdmin($u)) return true;
        $branch = $this->adminBranchOf($u);
        if ($branch && (int) $m->branch_id === $branch) return true;
        $mDept = $this->deptOf($m);
        if ($mDept && in_array($mDept, $this->headedDepts($u), true)) return true;

        return in_array((int) $m->id, $this->downlineIds($u), true);
    }

    /**
     * Every login this viewer oversees (never themselves): a Vault Admin sees the whole
     * company; a branch admin their branch; an HOD their departments; anyone else their
     * reporting line. Their credentials — personal and team — list in the viewer's Team Vault.
     */
    protected function overseenUserIds(User $u): array
    {
        return $this->memo("overseen:{$u->id}", function () use ($u) {
            if ($this->isAdmin($u)) {
                return User::where('client_id', $u->client_id)->where('id', '!=', $u->id)
                    ->pluck('id')->map(fn ($i) => (int) $i)->all();
            }
            $ids = $this->downlineIds($u);
            if ($branch = $this->adminBranchOf($u)) {
                $ids = array_merge($ids, User::where('client_id', $u->client_id)->whereNotIn('user_type', self::ADMIN_TYPES)
                    ->where('branch_id', $branch)->where('id', '!=', $u->id)->pluck('id')->map(fn ($i) => (int) $i)->all());
            }
            if ($heads = $this->headedDepts($u)) {
                $ids = array_merge($ids, User::where('client_id', $u->client_id)->whereIn('department_id', $heads)
                    ->where('id', '!=', $u->id)->pluck('id')->map(fn ($i) => (int) $i)->all());
            }

            return array_values(array_unique(array_map('intval', $ids)));
        });
    }

    /**
     * Departments the user heads. master_departments stores the HOD as a
     * name (`head`), not a user id, so it is matched to the login by name.
     */
    protected function headedDepts(User $u): array
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
    protected function deptHeads(int $clientId): array
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
    protected function hodOf(Departments $d, int $clientId): ?array
    {
        if (!filled($d->head)) return null;

        return ['id' => $this->deptHeads($clientId)[(int) $d->id] ?? null, 'name' => $d->head, 'initials' => $this->initials($d->head), 'role' => 'HOD'];
    }

    /** The login behind the user's reporting manager, by either link HR may have used. */
    protected function managerOf(User $u): ?int
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
    protected function clientDepartments(User $u): Collection
    {
        return $this->memo("deps:{$u->client_id}", fn () => Departments::where(fn ($w) => $w->whereNull('client_id')->orWhere('client_id', $u->client_id))
            ->orderBy('name')->get(['id', 'client_id', 'name', 'head']));
    }

    /** [department_id => active employees] for the tenant. */
    protected function memberCounts(int $clientId): array
    {
        return $this->memo("members:{$clientId}", fn () => Employee::where('client_id', $clientId)->where('status', 'Active')->whereNotNull('department_id')
            ->selectRaw('department_id, count(*) as n')->groupBy('department_id')->pluck('n', 'department_id')
            ->map(fn ($n) => (int) $n)->all());
    }

    /** The team a team-scope write is filed under — the user's own, one they head or administer, or (editing) the one it already sits in. */
    protected function teamDepartmentFor(User $u, ?int $requested, ?Credential $c = null): int
    {
        $deptId = $requested ?: $this->deptOf($u) ?: $c?->department_id;
        if (!$deptId) $this->reject('Pick the team (department) this credential belongs to.', 'department_id');
        if (!$this->clientDepartments($u)->contains('id', $deptId)) $this->reject('That department does not exist.', 'department_id', 404);

        // Editing a credential they can already manage, without moving it to a different department, is always allowed.
        $unchanged = $c && (int) $c->department_id === (int) $deptId;

        $mayUse = $unchanged
            || $this->isAdmin($u)
            || $this->adminBranchOf($u)   // a branch admin manages their whole branch
            || $deptId === $this->deptOf($u)
            || in_array($deptId, $this->headedDepts($u), true);
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
    protected function notify(array $userIds, string $kind, string $title, string $message, array $extra = []): void
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
    protected function notifyStage(AccessRequest $r, string $who): void
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

    protected function audit(User $u, string $action, ?Credential $c = null, ?string $detail = null, array $meta = [], ?string $module = null): void
    {
        $this->writeAudit($u->client_id, $u->id, $u->branch_id, $action, $c, $detail, $meta,
            $module ?? ($c ? ($c->risk === 'critical' ? 'Critical Vault' : ($c->scope === 'team' ? 'Team Vault' : 'My Vault')) : null));
    }

    protected function writeAudit(int $clientId, ?int $userId, ?int $branchId, string $action, ?Credential $c, ?string $detail, array $meta, ?string $module, ?string $severity = null): void
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

    protected function auditRules(): array
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

    protected function auditMessages(): array
    {
        return ['from.before_or_equal' => 'From cannot be in the future.', 'to.before_or_equal' => 'To cannot be in the future.'];
    }

    protected function auditQuery(User $u, array $f): Builder
    {
        $q = AuditLog::where('client_id', $u->client_id);
        if (!$this->isAdmin($u)) {
            // Your team's activity, as the vaults define the team: your reporting line, and for a
            // Branch Admin every person of the branch below them — plus events on credentials you own.
            $people = array_merge([$u->id], $this->downlineIds($u));
            $branch = $this->adminBranchOf($u);
            $q->where(function ($w) use ($u, $people, $branch) {
                $w->whereIn('user_id', $people)
                  ->orWhereIn('credential_id', Credential::withTrashed()->where('client_id', $u->client_id)->where('owner_id', $u->id)->select('id'));
                if ($branch) $w->orWhereIn('user_id', User::where('client_id', $u->client_id)->where('branch_id', $branch)->whereNotIn('user_type', self::ADMIN_TYPES)->select('id'));
            });
        }

        $tz    = $f['tz'] ?? self::AUDIT_TZ;
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
    protected const MODULE_SLUG = 'credentials-vault';

    /**
     * The signed-in user, provided CredVault is theirs to open: a client admin
     * (the Vault Admin — approvals and policies live here) always, anyone else
     * with view on the Credentials Vault module. Checked once per request.
     */
    protected function tenantUser(Request $request): User
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

    protected function listRules(array $tabs): array
    {
        return [
            'tab'      => ['nullable', Rule::in($tabs)],
            'q'        => ['nullable', 'string', 'max:100'],
            'page'     => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ];
    }

    protected function pageMeta($page): array
    {
        return ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()];
    }

    protected function likeTerm(string $term): string
    {
        return '%' . addcslashes(mb_strtolower(trim($term)), '%_\\') . '%';
    }

    /** Case-insensitive contains, on any driver; "_" and "%" are literal. */
    protected function applySearch(Builder $q, ?string $term, array $cols): Builder
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
    protected function nextCode(string $table, string $prefix, int $clientId): string
    {
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->value('id');

        return sprintf('%s-%04d', $prefix, $this->lastNumber($table, $prefix, $clientId) + 1);
    }

    protected function peekCode(string $table, string $prefix, int $clientId): string
    {
        return sprintf('%s-%04d', $prefix, $this->lastNumber($table, $prefix, $clientId) + 1);
    }

    protected function lastNumber(string $table, string $prefix, int $clientId): int
    {
        $num = fn (?string $code) => $code ? (int) substr($code, strlen($prefix) + 1) : 0;
        $n = $num(DB::table($table)->where('client_id', $clientId)->where('code', 'like', "{$prefix}-%")->orderByDesc('id')->value('code'));
        if ($table === 'credvault_credentials') {
            $n = max($n, $num(AuditLog::where('client_id', $clientId)->where('action', 'purge')->where('credential_code', 'like', "{$prefix}-%")
                ->orderByDesc('credential_code')->value('credential_code')));
        }

        return $n;
    }

    protected function host(?string $url): ?string
    {
        if (!$url) return null;
        $host = parse_url(str_contains($url, '://') ? $url : "https://{$url}", PHP_URL_HOST);

        return $host ? preg_replace('/^www\./', '', Str::lower($host)) : null;
    }

    protected function mime(string $format): string
    {
        return ['csv' => 'text/csv', 'json' => 'application/json', 'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'][$format] ?? 'application/octet-stream';
    }

    protected function download(string $body, string $name, string $mime, array $headers = [])
    {
        return response($body, 200, $headers + [
            'Content-Type'                  => $mime . ($mime === 'text/csv' ? '; charset=UTF-8' : ''),
            'Content-Disposition'           => 'attachment; filename="' . $name . '"',
            'Content-Length'                => strlen($body),
            'Cache-Control'                 => 'no-store',
            'Access-Control-Expose-Headers' => 'Content-Disposition, X-CredVault-Code, X-CredVault-Withheld',
        ]);
    }

    protected function memo(string $key, callable $fn): mixed
    {
        if (!array_key_exists($key, $this->memo)) $this->memo[$key] = $fn();

        return $this->memo[$key];
    }

    /** The 422 / 403 / 404 / 409 shape the forms read; the field puts the message on the right input. */
    protected function reject(string $message, ?string $field = null, int $status = 422): never
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
    protected function inTransaction(string $action, callable $work, array &$cleanup = []): mixed
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
}
