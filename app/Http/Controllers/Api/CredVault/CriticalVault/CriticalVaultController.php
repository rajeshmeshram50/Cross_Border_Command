<?php

namespace App\Http\Controllers\Api\CredVault\CriticalVault;

use App\Http\Controllers\Api\CredVault\CredVaultController;
use App\Models\CredVault\Credential;
use App\Models\CredVault\Policy;
use App\Models\User;
use Illuminate\Http\Request;

/**
 * CredVault · Critical Vault — /api/credvault/critical-vault/*
 *
 * The same 25 credential types, always critical risk, numbered CCRD-0001 …
 * (their own series beside the Normal Vault's CRD-). Each one is locked behind
 * the protection steps chosen in its form:
 *
 *   1  Vault Admin approval      with a reason and a time window
 *   2  Reporting Manager approval
 *   3  2-step code               Google Authenticator, or a code sent by email
 *
 * The 2-step method is linked in the form (TwoStepController) and the save is
 * refused until its code matched. The unlock itself is AccessRequestController.
 */
class CriticalVaultController extends CredVaultController
{
    private const VAULT = 'critical';

    /** GET /critical-vault/credentials — tabs all | mine | others ("Teams Critical Credentials"), search and paging. */
    public function index(Request $request)
    {
        return $this->listCredentials($request, self::VAULT);
    }

    /** GET /critical-vault/credentials/next-code — the next CCRD- code, as a preview; nothing is reserved. */
    public function nextCredentialCode(Request $request)
    {
        $u = $this->tenantUser($request);

        return response()->json(['status' => true, 'data' => [
            'vault'     => self::VAULT,
            'next_code' => $this->peekCode('credvault_credentials', Credential::VAULT_PREFIX[self::VAULT], $u->client_id),
            'preview'   => true,
        ]], 200);
    }

    /**
     * POST /critical-vault/credentials
     *
     * The type's fields as in the Normal Vault, plus the protection:
     *   lock_admin, lock_admin_user_id, lock_manager, lock_manager_user_id
     *   lock_otp (or the type's 2FA switch)  2-step on / off
     *   twofa_method google  totp_secret + totp_code
     *   twofa_method email   twofa_email + email_otp_token (from two-step/email/verify)
     */
    public function store(Request $request)
    {
        $u = $this->tenantUser($request);

        return $this->persistCredential($request, $u, null, self::VAULT);
    }

    /**
     * POST|PUT /critical-vault/credentials/{id}
     *
     * A HOD or Full share may edit the details, never what guards them:
     * switching a step off, changing the 2-step method or inbox, or
     * relinking it would let them open it without the approvals.
     */
    public function update(Request $request, int $id)
    {
        $u = $this->tenantUser($request);
        [$c, $acc] = $this->findInVault($u, $id, self::VAULT, self::RANK_FULL,
            'Only the owner, a Vault Admin or someone with Full Access can edit this credential.');

        if (!in_array($acc[1], ['owner', 'admin'], true) && ($what = $this->protectionChange($request, $c))) {
            $this->reject("Only the owner or a Vault Admin can change the {$what}.", null, 403);
        }

        return $this->persistCredential($request, $u, $c, self::VAULT);
    }

    /** DELETE /critical-vault/credentials/{id} — to the Recycle Bin, by the owner or a Vault Admin only. */
    public function destroy(Request $request, int $id)
    {
        return $this->binCredential($request, $id, self::VAULT);
    }

    /**
     * GET /critical-vault/approvers — the protection pickers: the Vault
     * Admins, and the people who can approve as a manager, with the defaults
     * the form pre-selects (the policy's admin, the user's own reporting manager).
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
}
