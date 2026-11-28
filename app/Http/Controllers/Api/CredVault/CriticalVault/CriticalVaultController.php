<?php

namespace App\Http\Controllers\Api\CredVault\CriticalVault;

use App\Http\Controllers\Api\CredVault\CredVaultController;
use App\Models\CredVault\Credential;
use App\Models\CredVault\Policy;
use App\Models\User;
use Illuminate\Http\Request;

class CriticalVaultController extends CredVaultController
{
    private const VAULT = 'critical';

    public function index(Request $request)
    {
        return $this->listCredentials($request, self::VAULT);
    }

    public function nextCredentialCode(Request $request)
    {
        $u = $this->tenantUser($request);

        return response()->json(['status' => true, 'data' => [
            'vault'     => self::VAULT,
            'next_code' => $this->peekCode('credvault_credentials', Credential::VAULT_PREFIX[self::VAULT], $u->client_id, $u->branch_id),
            'preview'   => true,
        ]], 200);
    }

    public function store(Request $request)
    {
        $u = $this->tenantUser($request);

        return $this->persistCredential($request, $u, null, self::VAULT);
    }

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

    public function destroy(Request $request, int $id)
    {
        return $this->binCredential($request, $id, self::VAULT);
    }

    public function approvers(Request $request)
    {
        $u = $this->tenantUser($request);
        $request->validate(['q' => ['nullable', 'string', 'max:100']]);
        $pol = Policy::for($u->client_id);
        $card = fn ($x) => ['id' => $x->id, 'name' => $x->name, 'designation' => $x->designation, 'initials' => $this->initials($x->name)];

        $branchAdminIds = $this->branchAdminIds($u->branch_id, $u->client_id);
        $admins  = User::whereIn('id', $branchAdminIds)->orderBy('name')->get(['id', 'name', 'designation']);
        $mine    = $this->managerOf($u);
        $manager = $mine ? User::whereKey($mine)->first(['id', 'name', 'designation']) : null;

        $defAdmin = $this->liveAdmin($pol['cp_admin_user_id'], $u->client_id);
        if (!$defAdmin || !in_array((int) $defAdmin, $branchAdminIds, true)) {
            $defAdmin = count($branchAdminIds) === 1 ? $branchAdminIds[0] : null;
        }

        return response()->json(['status' => true, 'data' => [
            'admins'   => $admins->map(fn ($x) => $card($x) + ['role' => 'Vault Admin'])->values(),
            'managers' => $manager ? [$card($manager) + ['role' => 'Your reporting manager']] : [],
            'defaults' => [
                'admin_user_id'   => $defAdmin,
                'admin_label'     => $defAdmin ? User::whereKey($defAdmin)->value('name') : ($admins->count() ? 'Any Branch Admin' : 'No Branch Admin set for your branch'),
                'manager_user_id' => $mine,
                'manager_label'   => $manager?->name ?? 'The requester’s reporting manager',
            ],
        ]], 200);
    }
}
