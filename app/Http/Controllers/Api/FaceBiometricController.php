<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\Module;
use App\Models\Permission;
use Illuminate\Http\Request;

class FaceBiometricController extends Controller
{
    private const DESCRIPTOR_LEN = 128;

    private const DUPLICATE_THRESHOLD = 0.50;

    public function status(Request $request)
    {
        $employee = $this->resolveTarget($request);
        $employee->loadMissing('photoDocument');

        return response()->json([
            'employee_id'              => $employee->id,
            'employee_name'            => $employee->display_name,
            'employee_code'            => $employee->emp_code,
            'photo_url'                => $employee->photo_url,
            'registered'               => !empty($employee->face_descriptor) && $employee->face_registered_at !== null,
            'registered_at'            => optional($employee->face_registered_at)->toIso8601String(),
            'consent_given_at'         => optional($employee->face_consent_given_at)->toIso8601String(),
            'consent_revoked_at'       => optional($employee->face_consent_revoked_at)->toIso8601String(),
            'biometric_status'         => $employee->biometric_status,
        ]);
    }

    public function register(Request $request)
    {
        $data = $request->validate([
            'descriptor'   => 'required|array|size:' . self::DESCRIPTOR_LEN,
            'descriptor.*' => 'required|numeric|between:-5,5',
            'consent'      => 'required|accepted',
            'employee_id'  => 'nullable|integer',
        ]);

        if (AuthController::isDegenerateDescriptor($data['descriptor'])) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'descriptor' => ['That face capture was not usable. Please re-capture in better lighting.'],
            ]);
        }

        $employee = $this->resolveTarget($request);
        if ($employee->isDisabled()) {
            abort(422, 'This employee is disabled — restore/re-activate them before changing face biometrics.');
        }
        $captured = array_map(static fn ($v) => (float) $v, $data['descriptor']);

        \Illuminate\Support\Facades\DB::transaction(function () use ($employee, $captured) {
            \App\Models\Employee::where('client_id', $employee->client_id)
                ->whereNotNull('face_descriptor')
                ->lockForUpdate()
                ->get(['id']);

            $conflict = $this->findDuplicateOwner($employee, $captured);
            if ($conflict !== null) {
                throw \Illuminate\Validation\ValidationException::withMessages([
                    'descriptor' => [
                        'This face is already registered with another employee. '
                        . 'Each face can only be linked to one employee — contact HR if you think this is a mistake.',
                    ],
                ]);
            }

            $employee->update([
                'face_descriptor'          => $captured,
                'face_registered_at'       => now(),
                'face_consent_given_at'    => $employee->face_consent_given_at ?: now(),
                'face_consent_revoked_at'  => null,
                'biometric_status'         => 'Registered',
            ]);
        });

        return response()->json([
            'message'       => 'Face enrolment saved.',
            'registered'    => true,
            'registered_at' => $employee->face_registered_at?->toIso8601String(),
        ]);
    }

    public function revoke(Request $request)
    {
        $employee = $this->resolveTarget($request);

        $employee->update([
            'face_descriptor'          => null,
            'face_registered_at'       => null,
            'face_consent_revoked_at'  => now(),
            'biometric_status'         => 'Not Registered',
        ]);

        \Illuminate\Support\Facades\DB::table('attendance_punches')
            ->where('employee_id', $employee->id)
            ->whereNotNull('match_distance')
            ->update(['match_distance' => null]);
        \Illuminate\Support\Facades\DB::table('attendances')
            ->where('employee_id', $employee->id)
            ->update(['check_in_match_distance' => null, 'check_out_match_distance' => null]);

        return response()->json(['message' => 'Face data deleted.']);
    }

    private function assertMayEditEmployees($user): void
    {
        $moduleId = Module::where('slug', 'hr.employee')->value('id');
        if (!$moduleId) {
            if (in_array($user->user_type, ['client_admin', 'branch_user'], true)) return;
            abort(403, 'Employees module not enabled.');
        }

        $allowed = Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where('can_edit', true)
            ->exists();
        if (!$allowed) abort(403, 'Missing can_edit on hr.employee');
    }

    private function resolveTarget(Request $request): Employee
    {
        $user = $request->user();
        if (!$user) abort(401, 'Unauthenticated');

        $ownEmployee = Employee::find($user->employee_id);

        $employeeId = $request->input('employee_id');

        if (!$employeeId || ($ownEmployee && (int) $employeeId === (int) $ownEmployee->id)) {
            if (!$ownEmployee) abort(404, 'No employee record linked to this account.');
            return $ownEmployee;
        }

        $row = Employee::find((int) $employeeId);
        if (!$row) abort(404, 'Employee not found.');

        if ($user->user_type === 'super_admin') return $row;

        $this->assertMayEditEmployees($user);

        if (in_array($user->user_type, ['client_admin', 'client_user', 'branch_user'], true)) {
            $rowClient  = $row->client_id;
            $userClient = $user->client_id;
            $sameTenant = $rowClient === null || (int) $rowClient === (int) $userClient;
            if ($sameTenant) return $row;
        }

        abort(403, 'You do not have access to this employee.');
    }

    private function findDuplicateOwner(Employee $target, array $captured): ?Employee
    {
        $q = Employee::withTrashed()
            ->where('id', '!=', $target->id)
            ->whereNotNull('face_descriptor')
            ->whereNotNull('face_registered_at');

        if ($target->client_id === null) {
            $q->whereNull('client_id');
        } else {
            $q->where(function ($w) use ($target) {
                $w->whereNull('client_id')->orWhere('client_id', $target->client_id);
            });
        }

        foreach ($q->get(['id', 'display_name', 'emp_code', 'client_id', 'face_descriptor']) as $other) {
            $stored = $other->face_descriptor;
            if (!is_array($stored) || count($stored) !== self::DESCRIPTOR_LEN) continue;
            $d = self::euclideanDistance($captured, $stored);
            if ($d <= self::DUPLICATE_THRESHOLD) return $other;
        }
        return null;
    }

    private static function euclideanDistance(array $a, array $b): float
    {
        $sum = 0.0;
        $n = count($a);
        for ($i = 0; $i < $n; $i++) {
            $diff = (float) $a[$i] - (float) $b[$i];
            $sum += $diff * $diff;
        }
        return sqrt($sum);
    }
}
