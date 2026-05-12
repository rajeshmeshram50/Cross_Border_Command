<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use Illuminate\Http\Request;

/**
 * Face-biometric enrolment / revocation for the signed-in user (or, when
 * called by an admin, for another employee in the same tenant).
 *
 * The descriptor itself is a plain JSON array of 128 floats produced by
 * face-api.js in the browser. We never see the raw photo — only the vector.
 *
 * Consent: every enrolment requires an explicit `consent` flag in the body.
 * DPDP Act / GDPR Art. 9 treats biometric data as special-category and
 * storing it without freely-given consent is illegal. `consent_given_at` is
 * stamped on opt-in; revoke wipes the descriptor and stamps
 * `consent_revoked_at` so the audit trail survives.
 */
class FaceBiometricController extends Controller
{
    /** Length of the face descriptor face-api.js's recognizer emits. */
    private const DESCRIPTOR_LEN = 128;

    public function status(Request $request)
    {
        $employee = $this->resolveTarget($request);
        return response()->json([
            'employee_id'              => $employee->id,
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
            'descriptor.*' => 'required|numeric',
            'consent'      => 'required|accepted',
            'employee_id'  => 'nullable|integer',
        ]);

        $employee = $this->resolveTarget($request);

        $employee->update([
            'face_descriptor'          => array_map(static fn ($v) => (float) $v, $data['descriptor']),
            'face_registered_at'       => now(),
            // Only stamp consent_given_at the FIRST time. Re-enrolment keeps
            // the original opt-in date so the audit trail isn't smashed.
            'face_consent_given_at'    => $employee->face_consent_given_at ?: now(),
            'face_consent_revoked_at'  => null,
            // Once a face is registered the physical biometric_status column
            // transitions to "Registered" so the existing HR view reflects it.
            'biometric_status'         => 'Registered',
        ]);

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

        return response()->json(['message' => 'Face data deleted.']);
    }

    /**
     * Pick the Employee row to act on:
     *   - super_admin can act on any employee.
     *   - client_admin / client_user / branch_user with ?employee_id= can
     *     act on another employee in the SAME tenant.
     *   - Everyone else acts on their own employee row (via user.employee_id).
     */
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
}
