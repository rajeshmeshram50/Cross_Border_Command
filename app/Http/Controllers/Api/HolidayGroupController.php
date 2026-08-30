<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Employee;
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

        /* withCount, or the two counting accessors in HolidayGroup::$appends
           fire a COUNT each per group as the list serialises. */
        $q = HolidayGroup::query()->with(['creator:id,name'])
            ->withCount(['holidays', 'employees']);
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

        // Block deletion while employees are still assigned to this group.
        // Deleting it would silently strip the holiday list off those employees
        // (and the paid days payroll credits from it). The admin must reassign
        // them to another group first. (Soft-deleted employees don't count —
        // the Employee model's SoftDeletes scope excludes them.)
        $assigned = Employee::where('holiday_group_id', $row->id)->count();
        if ($assigned > 0) {
            throw ValidationException::withMessages([
                'group' => "This holiday group is assigned to {$assigned} employee" . ($assigned === 1 ? '' : 's')
                    . '. Reassign them to another group before deleting it.',
            ]);
        }

        // No employees use it — safe to remove. Keep its holidays but ungroup
        // them so the dates aren't lost.
        DB::transaction(function () use ($row) {
            DB::table('holidays')->where('holiday_group_id', $row->id)->update(['holiday_group_id' => null]);
            $row->delete();
        });

        return response()->json(['message' => 'Holiday group removed. Its holidays were kept but ungrouped.']);
    }

    private function validatePayload(Request $request, ?int $id = null): array
    {
        $data = $request->validate([
            // Group names are labels — letters, numbers, spaces and hyphens only
            // (no apostrophes or other special characters). Mirrors the frontend.
            /* Must contain at least one LETTER. (#58)
             *
             * The pattern allowed \pN freely, so "12345" or "2026" saved as a
             * group name with nothing to object — a number is not a name, and
             * nothing downstream can make sense of one.
             *
             * Digits are still allowed INSIDE a name: "Diwali 2026" and
             * "Group 1" are ordinary things to call a holiday group, and
             * banning digits outright would swap a validation gap for a
             * validation obstacle. The lookahead is what draws the line — it
             * rejects a name made only of digits, spaces or hyphens while
             * leaving every real name alone. Same idiom the bank-branch rule
             * uses for the same reason. */
            'name'        => ['required', 'string', 'max:191', 'regex:/^(?=.*\pL)[\pL\pN \-]+$/u'],
            'description' => 'nullable|string|max:1000',
            'status'      => ['nullable', Rule::in(['Active', 'Inactive'])],
        ], [
            // Says what a valid name IS, and names the rule that just failed —
            // "invalid format" leaves the user guessing which character to drop.
            'name.regex' => 'Group name must include at least one letter — it can also contain numbers, spaces and hyphens, but not numbers alone.',
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

    /** Sequential HGRP code. Shared allocator — see \App\Support\DocumentNumber. */
    private function allocateCode($clientId, $branchId): string
    {
        return \App\Support\DocumentNumber::next(
            \App\Models\HolidayGroup::class,
            'code',
            'HGRP',
            $clientId,
            $branchId,
            withTrashed: true,
        );
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
