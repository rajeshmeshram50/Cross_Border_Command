<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\HrDocumentSignature;
use App\Models\HrOnboardingDocSelection;
use App\Models\HrOnboardingDocsetLock;
use App\Support\HrTemplateMatch;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The Policies & Agreements document set for one employee: which onboarding
 * documents HR ticked as required, and whether that set is finalised.
 *
 * - Not finalised  → the matched templates are the working set; HR ticks the
 *   ones this hire needs. Nothing is enforced yet (backward-compatible with
 *   onboardings created before this feature: no rows = everything matched).
 * - Finalised      → the ticked set is frozen as the requirement; onboarding
 *   completion and the % are measured against it. No new document joins it.
 * - Re-open        → clears the lock so the set can change again, allowed only
 *   while nothing in it has been signed yet.
 */
class HrOnboardingDocSetController extends Controller
{
    /** Resolve the employee and confirm the caller's tenant owns them. */
    private function employeeFor(Request $request, int $employeeId): Employee
    {
        $user = $request->user();
        if (!$user) abort(401);
        $emp = Employee::with(['department', 'designation'])->findOrFail($employeeId);
        if ($user->user_type !== 'super_admin' && (int) $emp->client_id !== (int) $user->client_id) {
            abort(404);
        }
        return $emp;
    }

    /** The latest signature run per template id for this employee. */
    private function runsByTemplate(int $employeeId): array
    {
        $byTpl = [];
        HrDocumentSignature::where('employee_id', $employeeId)
            ->orderBy('id')
            ->get(['id', 'template_id', 'status'])
            ->each(function ($r) use (&$byTpl) {
                if ($r->template_id !== null) $byTpl[(int) $r->template_id] = $r->status;
            });
        return $byTpl;
    }

    /** Which lifecycle this set belongs to: 'onboarding' (default) or 'exit'. */
    private function kindOf(Request $request): string
    {
        return strtolower((string) $request->query('kind')) === 'exit' ? 'exit' : 'onboarding';
    }

    /** The matched templates for the lifecycle. */
    private function templatesFor(Employee $emp, string $kind)
    {
        return ($kind === 'exit'
            ? HrTemplateMatch::exitTemplatesFor($emp)
            : HrTemplateMatch::onboardingTemplatesFor($emp))
            ->reject(fn ($t) => preg_match('/\b(leave|attendance)\b/i', (string) $t->name) === 1)
            ->values();
    }

    /** The lifecycle is complete (set sealed) — onboarding at stage 6, exit when finished. */
    private function sealed(Employee $emp, string $kind): bool
    {
        if ($kind === 'exit') {
            return DB::table('employee_exits')->where('employee_id', $emp->id)->whereNotNull('completed_at')->exists();
        }
        return (int) ($emp->onboarding_stage_completed ?? 0) >= 6;
    }

    /** GET /employees/{employee}/onboarding-doc-set?kind=onboarding|exit */
    public function show(Request $request, int $employee): JsonResponse
    {
        $emp  = $this->employeeFor($request, $employee);
        $kind = $this->kindOf($request);
        $templates = $this->templatesFor($emp, $kind);

        $lock = HrOnboardingDocsetLock::where('employee_id', $emp->id)->where('kind', $kind)->first();
        $finalized = $lock && $lock->finalized_at !== null;

        // Saved ticks. None yet = everything matched is ticked (the default set).
        $saved = HrOnboardingDocSelection::where('employee_id', $emp->id)->where('kind', $kind)->pluck('template_id')->map(fn ($x) => (int) $x)->all();
        $hasSaved = count($saved) > 0;
        $selectedSet = $hasSaved ? array_flip($saved) : array_flip($templates->pluck('id')->map(fn ($x) => (int) $x)->all());

        $runs = $this->runsByTemplate($emp->id);

        $rows = $templates->map(function ($t) use ($selectedSet, $runs) {
            $status = $runs[(int) $t->id] ?? null;
            return [
                'template_id' => (int) $t->id,
                'code'        => $t->code,
                'name'        => $t->name,
                'selected'    => isset($selectedSet[(int) $t->id]),
                'run_status'  => $status,                         // null | Pending | In Progress | Completed | Rejected | Cancelled
                'signed'      => $status === 'Completed',
                'active'      => in_array($status, ['Pending', 'In Progress'], true),
            ];
        })->values();

        return response()->json([
            'kind'         => $kind,
            'finalized'    => $finalized,
            'finalized_at' => $lock?->finalized_at,
            // Re-open allowed any time BEFORE the lifecycle is complete; once
            // complete the set is sealed.
            'can_reopen'   => $finalized && !$this->sealed($emp, $kind),
            'templates'    => $rows,
        ]);
    }

    /** PUT /employees/{employee}/onboarding-doc-set?kind=…  { template_ids: [] } */
    public function save(Request $request, int $employee): JsonResponse
    {
        $emp  = $this->employeeFor($request, $employee);
        $kind = $this->kindOf($request);
        $data = $request->validate([
            'template_ids'   => 'present|array',
            'template_ids.*' => 'integer',
        ]);

        $lock = HrOnboardingDocsetLock::where('employee_id', $emp->id)->where('kind', $kind)->first();
        if ($lock && $lock->finalized_at !== null) {
            return response()->json(['status' => false, 'message' => 'The document set is finalised. Re-open it before changing the selection.'], 422);
        }

        // Only ids that still match this employee (for this lifecycle) are accepted.
        $valid = $this->templatesFor($emp, $kind)->pluck('id')->map(fn ($x) => (int) $x)->all();
        $ids = array_values(array_unique(array_intersect(array_map('intval', $data['template_ids']), $valid)));

        // A document already sent for signature or signed cannot be dropped —
        // force-keep any template with a live/completed run that is in this set.
        $inFlight = HrDocumentSignature::where('employee_id', $emp->id)
            ->whereIn('status', ['Pending', 'In Progress', 'Completed'])
            ->whereIn('template_id', $valid)
            ->pluck('template_id')->map(fn ($x) => (int) $x)->all();
        $ids = array_values(array_unique(array_merge($ids, $inFlight)));

        DB::transaction(function () use ($emp, $kind, $ids, $request) {
            HrOnboardingDocSelection::where('employee_id', $emp->id)->where('kind', $kind)->delete();
            foreach ($ids as $tid) {
                HrOnboardingDocSelection::create([
                    'client_id'   => $emp->client_id,
                    'branch_id'   => $emp->branch_id,
                    'employee_id' => $emp->id,
                    'kind'        => $kind,
                    'template_id' => $tid,
                    'created_by'  => $request->user()?->id,
                ]);
            }
        });

        return $this->show($request, $employee);
    }

    /** POST /employees/{employee}/onboarding-doc-set/finalize?kind=… */
    public function finalize(Request $request, int $employee): JsonResponse
    {
        $emp  = $this->employeeFor($request, $employee);
        $kind = $this->kindOf($request);

        // Persist the current working set first (so a finalise with no explicit
        // save still freezes exactly what's on screen — the default-all set).
        if (HrOnboardingDocSelection::where('employee_id', $emp->id)->where('kind', $kind)->doesntExist()) {
            $ids = $this->templatesFor($emp, $kind)->pluck('id')->map(fn ($x) => (int) $x)->all();
            foreach ($ids as $tid) {
                HrOnboardingDocSelection::create([
                    'client_id' => $emp->client_id, 'branch_id' => $emp->branch_id,
                    'employee_id' => $emp->id, 'kind' => $kind, 'template_id' => $tid, 'created_by' => $request->user()?->id,
                ]);
            }
        }

        HrOnboardingDocsetLock::updateOrCreate(
            ['employee_id' => $emp->id, 'kind' => $kind],
            [
                'client_id' => $emp->client_id, 'branch_id' => $emp->branch_id,
                'finalized_at' => now(), 'finalized_by' => $request->user()?->id,
            ],
        );

        return $this->show($request, $employee);
    }

    /** POST /employees/{employee}/onboarding-doc-set/reopen?kind=… */
    public function reopen(Request $request, int $employee): JsonResponse
    {
        $emp  = $this->employeeFor($request, $employee);
        $kind = $this->kindOf($request);

        if ($this->sealed($emp, $kind)) {
            $what = $kind === 'exit' ? 'The exit is complete' : 'Onboarding is complete';
            return response()->json(['status' => false, 'message' => "{$what}, so the document set is locked and can no longer be re-opened."], 422);
        }

        HrOnboardingDocsetLock::where('employee_id', $emp->id)->where('kind', $kind)->update(['finalized_at' => null, 'finalized_by' => null]);
        return $this->show($request, $employee);
    }
}
