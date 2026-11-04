<?php

namespace App\Http\Controllers\Api\CredVault\NormalVault;

use App\Http\Controllers\Api\CredVault\CredVaultController;
use App\Models\CredVault\Credential;
use Illuminate\Http\Request;

/**
 * CredVault · Normal Vault (My Vault / Team Vault) — /api/credvault/normal-vault/*
 *
 * The 25 credential types at risk low, medium or high, numbered CRD-0001 …
 * 2-step is only recorded: the form's 2FA switch stores twofa yes / no, and
 * nothing is linked or asked for — a Normal Vault credential opens directly
 * for anyone whose access allows it. Critical credentials belong to the
 * Critical Vault (CriticalVault\CriticalVaultController) and are refused here.
 *
 * Shared endpoints (show, reveal, shares, activity, attachments, health,
 * bin…) stay on CredVaultController and work for either vault.
 */
class NormalVaultController extends CredVaultController
{
    private const VAULT = 'normal';

    /** GET /normal-vault/credentials — the My Vault / Team Vault list; same tabs, filters and paging as /credentials. */
    public function index(Request $request)
    {
        return $this->listCredentials($request, self::VAULT);
    }

    /** GET /normal-vault/credentials/next-code — the next CRD- code, as a preview; nothing is reserved. */
    public function nextCredentialCode(Request $request)
    {
        $u = $this->tenantUser($request);

        return response()->json(['status' => true, 'data' => [
            'vault'     => self::VAULT,
            'next_code' => $this->peekCode('credvault_credentials', Credential::VAULT_PREFIX[self::VAULT], $u->client_id),
            'preview'   => true,
        ]], 200);
    }

    /** POST /normal-vault/credentials — multipart when files are attached, JSON otherwise. */
    public function store(Request $request)
    {
        $u = $this->tenantUser($request);

        return $this->persistCredential($request, $u, null, self::VAULT);
    }

    /**
     * POST|PUT /normal-vault/credentials/{id}
     *
     * Partial: a type field left out keeps its value. A HOD or a Full share
     * edits the details; moving it to another vault scope or team stays with
     * the owner and the Vault Admin.
     */
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

    /** DELETE /normal-vault/credentials/{id} — to the Recycle Bin, or "remove from your vault" on a share. */
    public function destroy(Request $request, int $id)
    {
        return $this->binCredential($request, $id, self::VAULT);
    }
}
