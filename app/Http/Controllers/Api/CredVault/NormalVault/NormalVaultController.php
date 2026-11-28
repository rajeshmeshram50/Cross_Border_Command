<?php

namespace App\Http\Controllers\Api\CredVault\NormalVault;

use App\Http\Controllers\Api\CredVault\CredVaultController;
use App\Models\CredVault\Credential;
use Illuminate\Http\Request;

class NormalVaultController extends CredVaultController
{
    private const VAULT = 'normal';

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

        if (!in_array($acc[1], ['owner', 'admin', 'branch'], true)) {
            if ($request->has('scope') && $request->input('scope') !== $c->scope) $this->reject('Only the owner, a Vault Admin or the Branch Admin can change the vault.', null, 403);
            if ($request->has('department_id') && (int) $request->input('department_id') !== (int) $c->department_id) {
                $this->reject('Only the owner, a Vault Admin or the Branch Admin can change the team.', null, 403);
            }
        }

        return $this->persistCredential($request, $u, $c, self::VAULT);
    }

    public function destroy(Request $request, int $id)
    {
        return $this->binCredential($request, $id, self::VAULT);
    }
}
