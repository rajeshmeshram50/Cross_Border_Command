<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\OrganizationType;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class OrganizationTypeController extends Controller
{
    public function index(Request $request)
    {
        $query = OrganizationType::query()->orderBy('sort_order')->orderBy('name');

        if ($request->boolean('active_only')) {
            $query->where('status', 'active');
        }

        if ($search = $request->query('search')) {
            $query->where('name', 'ilike', "%{$search}%");
        }

        return response()->json($query->get());
    }

    public function store(Request $request)
    {
        $this->authorizeSuperAdmin($request);

        $data = $request->validate([
            'name'        => 'required|string|max:100|unique:organization_types,name',
            'icon'        => 'nullable|string|max:50',
            'description' => 'nullable|string|max:255',
            'status'      => 'required|in:active,inactive',
            'sort_order'  => 'nullable|integer|min:0',
        ]);

        $data['slug']       = Str::slug($data['name']);
        $data['sort_order'] = $data['sort_order'] ?? ((int) OrganizationType::max('sort_order') + 1);

        $type = OrganizationType::create($data);

        return response()->json(['message' => 'Organization type created', 'organization_type' => $type], 201);
    }

    public function show(OrganizationType $organizationType)
    {
        return response()->json($organizationType);
    }

    public function update(Request $request, OrganizationType $organizationType)
    {
        $this->authorizeSuperAdmin($request);

        $data = $request->validate([
            'name'        => 'required|string|max:100|unique:organization_types,name,' . $organizationType->id,
            'icon'        => 'nullable|string|max:50',
            'description' => 'nullable|string|max:255',
            'status'      => 'required|in:active,inactive',
            'sort_order'  => 'nullable|integer|min:0',
        ]);

        if ($data['name'] !== $organizationType->name) {
            $data['slug'] = Str::slug($data['name']);
        }

        $organizationType->update($data);

        return response()->json(['message' => 'Organization type updated', 'organization_type' => $organizationType]);
    }

    public function destroy(Request $request, OrganizationType $organizationType)
    {
        $this->authorizeSuperAdmin($request);

        // Prevent deleting a type that is referenced by any client
        $inUse = \App\Models\Client::where('org_type', $organizationType->name)->exists();
        if ($inUse) {
            return response()->json([
                'message' => 'Cannot delete — this organization type is used by existing clients.',
            ], 422);
        }

        $organizationType->delete();

        return response()->json(['message' => 'Organization type deleted']);
    }

    private function authorizeSuperAdmin(Request $request): void
    {
        $user = $request->user();
        if (!$user || $user->user_type !== 'super_admin') {
            abort(403, 'Only super admin can manage organization types.');
        }
    }
}
