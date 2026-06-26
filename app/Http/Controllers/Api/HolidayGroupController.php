<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\HolidayGroup;
use App\Models\Module;
use App\Models\Permission;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * HRMS Holiday Groups — named holiday calendars ("types") that own a set of
 * holidays and get assigned to employees. Shares the `hr.holiday` permission
 * module and the same tenant scoping as HolidayController.
 */
class HolidayGroupController extends Controller
{
    use ScopesHolidayTenant;

    private const MODULE_SLUG = 'hr.holiday';

    public function index(Request $request)
    {
        $this->authorizeAction($request, 'can_view');

        $q = HolidayGroup::query()->with(['creator:id,name']);
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);

        if ($search = $request->query('search')) {
            $q->where(function ($w) use ($search) {
                $w->where('name', 'ilike', "%{$search}%")
                  ->orWhere('code', 'ilike', "%{$search}%");
            });
        }
        if ($status = $request->query('status')) {
            $q->where('status', $status);
        }

        // Order by code (creation sequence) so the auto-generated IDs read as a
        // clean ascending series instead of a name-scrambled order.
        return response()->json($q->orderBy('code')->get());
    }

    public function show(Request $request, $id)
    {
        $this->authorizeAction($request, 'can_view');
        $row = $this->resolveRow($request, (int) $id);
        return response()->json($row);
    }

    public function store(Request $request)
    {
        $this->authorizeAction($request, 'can_add');
        $data = $this->validatePayload($request);

        return DB::transaction(function () use ($request, $data) {
            $auth = $request->user();
            [$clientId, $branchId] = $this->resolveOwnership($request);

            $row = HolidayGroup::create(array_merge($data, [
                'client_id'  => $clientId,
                'branch_id'  => $branchId,
                'created_by' => $auth?->id,
                'updated_by' => $auth?->id,
                'code'       => $this->allocateCode($clientId, $branchId),
            ]));

            return response()->json($row, 201);
        });
    }

    public function update(Request $request, $id)
    {
        $this->authorizeAction($request, 'can_edit');
        $row = $this->resolveRow($request, (int) $id);

        $data = $this->validatePayload($request, $row->id);
        $data['updated_by'] = $request->user()?->id;
        $row->update($data);

        return response()->json($row->fresh());
    }

    public function destroy(Request $request, $id)
    {
        $this->authorizeAction($request, 'can_delete');
        $row = $this->resolveRow($request, (int) $id);

        // Detach holidays from the group (keep the holidays, just ungroup them)
        // and clear it off any employee so we never leave dangling references.
        DB::transaction(function () use ($row) {
            DB::table('holidays')->where('holiday_group_id', $row->id)->update(['holiday_group_id' => null]);
            DB::table('employees')->where('holiday_group_id', $row->id)->update(['holiday_group_id' => null]);
            $row->delete();
        });

        return response()->json(['message' => 'Holiday group removed. Its holidays were kept but ungrouped.']);
    }

    private function validatePayload(Request $request, ?int $id = null): array
    {
        $data = $request->validate([
            'name'        => 'required|string|max:191',
            'description' => 'nullable|string|max:1000',
            'status'      => ['nullable', Rule::in(['Active', 'Inactive'])],
        ]);

        // Block duplicate group names within the same tenant scope. Match is
        // case-insensitive (ilike) on the trimmed name; on update the row being
        // edited is excluded so re-saving it without a rename is allowed.
        [$clientId, $branchId] = $this->resolveOwnership($request);
        $name = trim($data['name']);
        $data['name'] = $name;
        $duplicate = HolidayGroup::query()
            ->when($clientId === null, fn ($q) => $q->whereNull('client_id'), fn ($q) => $q->where('client_id', $clientId))
            ->when($branchId === null, fn ($q) => $q->whereNull('branch_id'), fn ($q) => $q->where('branch_id', $branchId))
            ->where('name', 'ilike', $name)
            ->when($id !== null, fn ($q) => $q->where('id', '!=', $id))
            ->exists();
        if ($duplicate) {
            throw ValidationException::withMessages([
                'name' => 'Holiday Group already exists.',
            ]);
        }

        return $data;
    }

    private function resolveRow(Request $request, int $id): HolidayGroup
    {
        $q = HolidayGroup::query()->where('id', $id);
        $this->applyScope($q, $request->user(), null);
        return $q->firstOrFail();
    }

    private function allocateCode($clientId, $branchId): string
    {
        $q = HolidayGroup::query()->withTrashed()->lockForUpdate();
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);

        $max = 0;
        foreach ($q->pluck('code') as $c) {
            if (preg_match('/^HGRP-(\d+)$/i', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
        }
        return 'HGRP-' . str_pad((string) ($max + 1), 4, '0', STR_PAD_LEFT);
    }

    private function authorizeAction(Request $request, string $perm): void
    {
        $user = $request->user();
        if (!$user) abort(401, 'Authentication required');
        if (method_exists($user, 'isSuperAdmin') && $user->isSuperAdmin()) return;

        $moduleId = Module::where('slug', self::MODULE_SLUG)->value('id');
        if (!$moduleId) {
            if (in_array($user->user_type, ['client_admin', 'branch_user'], true)) return;
            abort(403, 'Holiday module not enabled.');
        }

        $allowed = Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where($perm, true)
            ->exists();
        if (!$allowed) abort(403, "Missing {$perm} on " . self::MODULE_SLUG);
    }
}
