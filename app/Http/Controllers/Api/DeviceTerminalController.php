<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\DeviceTerminal;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Manage registered biometric terminals (eSSL / ZKTeco) — the registry that
 * makes the public /iclock push path tenant-safe (see EsslDeviceController).
 *
 * Tenant-scoped like the rest of the master endpoints: a client-admin sees /
 * manages only their own client's terminals; super-admins (null client_id) may
 * target a client via ?client_id / body client_id. The client_id is ALWAYS
 * derived here, never trusted from a device.
 */
class DeviceTerminalController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        $clientId = $user->client_id;

        if (!$clientId && !$user->isSuperAdmin()) {
            return response()->json(['data' => []]);
        }

        $query = DeviceTerminal::with(['branch:id,name', 'client:id,org_name'])
            ->orderByDesc('last_seen_at')
            ->orderBy('name');

        if ($clientId) {
            $query->where('client_id', $clientId);
        } elseif ($request->query('client_id')) {
            $query->where('client_id', $request->query('client_id'));
        }

        if ($request->filled('branch_id')) {
            $query->where('branch_id', $request->query('branch_id'));
        }
        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('serial', 'ilike', "%{$search}%")
                  ->orWhere('name', 'ilike', "%{$search}%");
            });
        }

        return response()->json(['data' => $query->get()]);
    }

    public function store(Request $request)
    {
        $user = $request->user();
        $clientId = $user->client_id ?: $request->input('client_id');
        abort_if(!$clientId, 422, 'A client must be resolved to register a terminal.');

        $data = $this->validated($request, null);

        $this->assertBranchInClient($data['branch_id'] ?? null, $clientId);

        $terminal = DeviceTerminal::create([
            'client_id'    => $clientId,
            'branch_id'    => $data['branch_id'] ?? null,
            'serial'       => $data['serial'],
            'name'         => $data['name'] ?? null,
            'timezone'     => $data['timezone'] ?? 'Asia/Kolkata',
            'allowed_ips'  => $data['allowed_ips'] ?? null,
            'is_active'    => $data['is_active'] ?? true,
        ]);

        return response()->json(['data' => $terminal->fresh(['branch:id,name', 'client:id,org_name'])], 201);
    }

    public function update(Request $request, int $id)
    {
        $terminal = $this->scopedFind($request, $id);
        $data = $this->validated($request, $terminal->id);

        $this->assertBranchInClient($data['branch_id'] ?? $terminal->branch_id, $terminal->client_id);

        // client_id is immutable — a terminal never changes tenants.
        $terminal->update([
            'branch_id'   => array_key_exists('branch_id', $data) ? $data['branch_id'] : $terminal->branch_id,
            'serial'      => $data['serial'] ?? $terminal->serial,
            'name'        => array_key_exists('name', $data) ? $data['name'] : $terminal->name,
            'timezone'    => $data['timezone'] ?? $terminal->timezone,
            'allowed_ips' => array_key_exists('allowed_ips', $data) ? $data['allowed_ips'] : $terminal->allowed_ips,
            'is_active'   => array_key_exists('is_active', $data) ? (bool) $data['is_active'] : $terminal->is_active,
        ]);

        return response()->json(['data' => $terminal->fresh(['branch:id,name', 'client:id,org_name'])]);
    }

    public function destroy(Request $request, int $id)
    {
        $terminal = $this->scopedFind($request, $id);
        $terminal->delete();

        return response()->json(['message' => 'Terminal removed.']);
    }

    /** Validate + normalise the payload (serial unique per soft-delete state). */
    private function validated(Request $request, ?int $ignoreId): array
    {
        return $request->validate([
            'serial'      => ['required', 'string', 'max:64', Rule::unique('device_terminals', 'serial')->whereNull('deleted_at')->ignore($ignoreId)],
            'name'        => 'nullable|string|max:100',
            'branch_id'   => 'nullable|integer',
            'timezone'    => 'nullable|timezone',
            'allowed_ips' => 'nullable|string|max:255',
            'is_active'   => 'nullable|boolean',
        ]);
    }

    /** A terminal's branch (when set) must belong to the same client. */
    private function assertBranchInClient(?int $branchId, ?int $clientId): void
    {
        if ($branchId && $clientId) {
            $ok = Branch::where('id', $branchId)->where('client_id', $clientId)->exists();
            abort_if(!$ok, 422, 'The selected branch does not belong to this client.');
        }
    }

    /** Find a terminal scoped to the caller's client (super-admin sees all). */
    private function scopedFind(Request $request, int $id): DeviceTerminal
    {
        $user = $request->user();
        $query = DeviceTerminal::query();
        if ($user->client_id) {
            $query->where('client_id', $user->client_id);
        }
        return $query->findOrFail($id);
    } 
}
