<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\PreviousEmployment;
use Illuminate\Http\Request;

/**
 * Stage 2 — Previous Employment Companies CRUD.
 *
 *   GET    /api/employees/{employee}/previous-employments       list
 *   POST   /api/employees/{employee}/previous-employments       create
 *   PATCH  /api/previous-employments/{prev}                     update
 *   DELETE /api/previous-employments/{prev}                     soft-delete
 *
 * Tenant scope mirrors EmployeeDocumentController — same-client gates
 * everything for non-super admins.
 */
class PreviousEmploymentController extends Controller
{
    public function index(Request $request, Employee $employee)
    {
        $this->guardSameTenant($request, $employee);
        return response()->json(
            PreviousEmployment::where('employee_id', $employee->id)
                ->orderBy('start_date', 'desc')
                ->get()
                ->map(fn ($p) => $this->format($p))
        );
    }

    public function store(Request $request, Employee $employee)
    {
        $this->guardSameTenant($request, $employee);
        $data = $this->validatePayload($request);

        $row = PreviousEmployment::create(array_merge($data, [
            'employee_id' => $employee->id,
            'client_id'   => $employee->client_id,
            'branch_id'   => $employee->branch_id,
        ]));
        return response()->json(['message' => 'Created', 'previous_employment' => $this->format($row)], 201);
    }

    public function update(Request $request, PreviousEmployment $prev)
    {
        $this->guardSameTenantRow($request, $prev);
        $data = $this->validatePayload($request, $prev->id);
        $prev->update($data);
        return response()->json(['message' => 'Updated', 'previous_employment' => $this->format($prev->fresh())]);
    }

    public function destroy(Request $request, PreviousEmployment $prev)
    {
        $this->guardSameTenantRow($request, $prev);
        $prev->delete();
        return response()->json(['message' => 'Removed']);
    }

    /* ── Helpers ───────────────────────────────────────────────────── */

    private function validatePayload(Request $request, ?int $rowId = null): array
    {
        return $request->validate([
            'company_name'   => 'required|string|max:255',
            'job_title'      => 'nullable|string|max:255',
            'start_date'     => 'nullable|date',
            'end_date'       => 'nullable|date|after_or_equal:start_date',
            'hr_email_1'     => 'nullable|email|max:191',
            'hr_email_2'     => 'nullable|email|max:191|different:hr_email_1',
            'contact_number' => 'nullable|string|max:30',
        ]);
    }

    private function guardSameTenant(Request $request, Employee $employee): void
    {
        $user = $request->user();
        if (!$user) abort(401);
        if ($user->isSuperAdmin()) return;
        if ($employee->client_id && $user->client_id !== $employee->client_id) {
            abort(403, 'Employee belongs to a different organization.');
        }
    }

    private function guardSameTenantRow(Request $request, PreviousEmployment $row): void
    {
        $user = $request->user();
        if (!$user) abort(401);
        if ($user->isSuperAdmin()) return;
        if ($row->client_id && $user->client_id !== $row->client_id) {
            abort(403, 'Row belongs to a different organization.');
        }
    }

    private function format(PreviousEmployment $p): array
    {
        return [
            'id'             => $p->id,
            'employee_id'    => $p->employee_id,
            'company_name'   => $p->company_name,
            'job_title'      => $p->job_title,
            'start_date'     => $p->start_date?->toDateString(),
            'end_date'       => $p->end_date?->toDateString(),
            'hr_email_1'     => $p->hr_email_1,
            'hr_email_2'     => $p->hr_email_2,
            'contact_number' => $p->contact_number,
        ];
    }
}
