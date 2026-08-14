<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\Module;
use App\Models\Permission;
use Illuminate\Http\Request;

class FaceBiometricController extends Controller
{
    /** Length of the face descriptor face-api.js's recognizer emits. */
    private const DESCRIPTOR_LEN = 128;

    /** Euclidean-distance threshold below which two captures are treated as
     *  the SAME PERSON. Used by the uniqueness check at enrolment time so
     *  an admin can't accidentally (or intentionally) link the same face
     *  to two different employee records.
     *
     *  Tuned slightly stricter than the attendance match threshold (0.55):
     *  for de-dup we'd rather catch borderline cases than let an obvious
     *  duplicate slip through. Same value the face-login flow uses.
     */
    private const DUPLICATE_THRESHOLD = 0.50;

    public function status(Request $request)
    {
        // Eager-load photoDocument so the photo_url accessor fires without
        // an extra round-trip. We deliberately do NOT return the raw face
        // descriptor — only the binary "are they enrolled?" flag plus the
        // employee's existing PROFILE photo (the passport-size shot uploaded
        // during onboarding, which is unrelated to the face biometric and
        // safe to surface).
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

    /**
     * Save (or replace) the face descriptor for the target employee. The
     * request body MUST carry an explicit `consent: true` — the SPA shows a
     * disclosure dialog and only submits this when the user accepts.
     */
    public function register(Request $request)
    {
        $data = $request->validate([
            'descriptor'   => 'required|array|size:' . self::DESCRIPTOR_LEN,
            // Same bounds the punch path has always applied — enrolment had
            // none, so a degenerate or wildly-scaled vector could be stored as
            // someone's permanent credential.
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
        // A disabled employee (soft-deleted or terminal status) has no active
        // login — don't let their face biometric be (re-)enrolled until they
        // are restored/re-activated. Mirrors the EmployeeController edit guard.
        if ($employee->isDisabled()) {
            abort(422, 'This employee is disabled — restore/re-activate them before changing face biometrics.');
        }
        $captured = array_map(static fn ($v) => (float) $v, $data['descriptor']);

        // Uniqueness check — block the enrolment if this face is already
        // linked to ANOTHER employee in the same tenant. Without this guard,
        // an admin could (accidentally or maliciously) register the same
        // person's face under two employee records, which would then make
        // face login / clock-in ambiguous. Re-enrolment of the SAME employee
        // is excluded from the scan.
        /* The duplicate scan and the write have to be ONE atomic step. Checked
         * outside a transaction, two enrolments of the same face submitted at
         * the same moment both scanned before either wrote, both saw no
         * conflict, and the face ended up linked to two employees — precisely
         * the state this guard exists to prevent. The row lock serialises
         * enrolments within the tenant, which is a rare, human-paced action, so
         * the contention cost is nil. */
        \Illuminate\Support\Facades\DB::transaction(function () use ($employee, $captured) {
            \App\Models\Employee::where('client_id', $employee->client_id)
                ->whereNotNull('face_descriptor')
                ->lockForUpdate()
                ->get(['id']);

            $conflict = $this->findDuplicateOwner($employee, $captured);
            if ($conflict !== null) {
                $who = $conflict->display_name ?: ('Employee #' . $conflict->id);
                $code = $conflict->emp_code ? " ({$conflict->emp_code})" : '';
                throw \Illuminate\Validation\ValidationException::withMessages([
                    'descriptor' => [sprintf(
                        'This face is already registered for %s%s. Each face can only be linked to one employee.',
                        $who, $code,
                    )],
                ]);
            }

            $employee->update([
                'face_descriptor'          => $captured,
                'face_registered_at'       => now(),
                // Only stamp consent_given_at the FIRST time. Re-enrolment keeps
                // the original opt-in date so the audit trail isn't smashed.
                'face_consent_given_at'    => $employee->face_consent_given_at ?: now(),
                'face_consent_revoked_at'  => null,
                // Once a face is registered the physical biometric_status column
                // transitions to "Registered" so the existing HR view reflects it.
                'biometric_status'         => 'Registered',
            ]);
        });

        return response()->json([
            'message'       => 'Face enrolment saved.',
            'registered'    => true,
            'registered_at' => $employee->face_registered_at?->toIso8601String(),
        ]);
    }

    /**
     * Revoke the consent and wipe the descriptor. We KEEP `consent_given_at`
     * but stamp `consent_revoked_at` — regulators want both timestamps for
     * the lifecycle audit.
     */
    public function revoke(Request $request)
    {
        $employee = $this->resolveTarget($request);

        $employee->update([
            'face_descriptor'          => null,
            'face_registered_at'       => null,
            'face_consent_revoked_at'  => now(),
            'biometric_status'         => 'Not Registered',
        ]);

        // A26: consent governs ALL biometric-derived data, not just the live
        // descriptor. Anonymise the historical face-match distances so revoking
        // consent actually erases the biometric footprint (attendance rows
        // themselves stay — only the match metric is cleared).
        \Illuminate\Support\Facades\DB::table('attendance_punches')
            ->where('employee_id', $employee->id)
            ->whereNotNull('match_distance')
            ->update(['match_distance' => null]);
        \Illuminate\Support\Facades\DB::table('attendances')
            ->where('employee_id', $employee->id)
            ->update(['check_in_match_distance' => null, 'check_out_match_distance' => null]);

        return response()->json(['message' => 'Face data deleted.']);
    }

    /**
     * Pick the Employee row to act on:
     *   - super_admin can act on any employee.
     *   - client_admin / client_user / branch_user with ?employee_id= can
     *     act on another employee in the SAME tenant.
     *   - Everyone else acts on their own employee row (via user.employee_id).
     */
    /**
     * `can_edit` on hr.employee — a copy of EmployeeController::authorize()'s
     * rule, including its first-run fallback for a not-yet-seeded module row,
     * so the two surfaces can't disagree about who may change an employee.
     */
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

        // Self-link: employees.user_id → users.id (there is NO users.employee_id
        // column — /me synthesizes that field from this lookup). When the
        // caller doesn't pass an explicit employee_id we act on their own row.
        $ownEmployee = Employee::where('user_id', $user->id)->first();

        $employeeId = $request->input('employee_id');

        if (!$employeeId || ($ownEmployee && (int) $employeeId === (int) $ownEmployee->id)) {
            if (!$ownEmployee) abort(404, 'No employee record linked to this account.');
            return $ownEmployee;
        }

        $row = Employee::find((int) $employeeId);
        if (!$row) abort(404, 'Employee not found.');

        if ($user->user_type === 'super_admin') return $row;

        /* Enrolling or revoking SOMEONE ELSE's face rewrites their record and
         * hands them (or removes) a login credential — an edit of that
         * employee, so it needs `can_edit` on hr.employee, exactly like the
         * profile edit does. Being in the same tenant was the only bar before,
         * which meant a view-only branch user could re-enrol anyone's face.
         *
         * Self-enrolment never reaches this line (it returned above), so the
         * Clock-In screen's "register my own face" flow is untouched. */
        $this->assertMayEditEmployees($user);

        // Tenant users can act on:
        //   - rows matching their own client_id, AND
        //   - globally-scoped rows (client_id IS NULL), because
        //     EmployeeController::applyScope already surfaces those in their
        //     /employees list — refusing them here surfaces as a confusing
        //     "no access" when the row is right in front of them.
        if (in_array($user->user_type, ['client_admin', 'client_user', 'branch_user'], true)) {
            $rowClient  = $row->client_id;
            $userClient = $user->client_id;
            $sameTenant = $rowClient === null || (int) $rowClient === (int) $userClient;
            if ($sameTenant) return $row;
        }

        abort(403, 'You do not have access to this employee.');
    }

    /**
     * Scan every OTHER employee in the same tenant that has a face on file
     * and return the first one whose descriptor matches the captured one
     * within DUPLICATE_THRESHOLD. Returns null if no duplicate exists.
     *
     * Tenant scope:
     *   - If the target row carries a client_id, we look at OTHER rows with
     *     the same client_id PLUS globally-scoped rows (client_id IS NULL) —
     *     same rule the EmployeeController scope helpers use, so we won't
     *     accuse a different tenant's employee.
     *   - If the target row is globally scoped (client_id IS NULL), only
     *     other global rows are checked — cross-tenant matches don't make
     *     sense for de-dup.
     *
     *   N enrolled employees → N (128-d, ~256-mul) distance computes per
     *   register call. Negligible up to thousands of employees; if a tenant
     *   ever crosses ~10k enrolled faces, swap to a vector index (pgvector).
     */
    private function findDuplicateOwner(Employee $target, array $captured): ?Employee
    {
        // withTrashed(): a disabled (soft-deleted) employee keeps their face on
        // file, so their face must STILL block a re-registration by someone
        // else — otherwise the same person's face could be linked to a second
        // employee just because the first was disabled. Inactive/Terminated
        // (not soft-deleted) employees are already covered by the default scope.
        $q = Employee::withTrashed()
            ->where('id', '!=', $target->id)
            ->whereNotNull('face_descriptor')
            ->whereNotNull('face_registered_at');

        // Tenant scope mirrors EmployeeController's list rules.
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

    /**
     * Euclidean distance between two 128-d descriptors. Same routine the
     * attendance + face-login paths use; kept inline here so this controller
     * has no dependency on AttendanceController internals.
     */
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
