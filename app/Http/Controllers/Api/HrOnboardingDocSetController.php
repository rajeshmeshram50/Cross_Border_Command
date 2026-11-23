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

class HrOnboardingDocSetController extends Controller
{
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

    private function kindOf(Request $request): string
    {
        return strtolower((string) $request->query('kind')) === 'exit' ? 'exit' : 'onboarding';
    }

    private function templatesFor(Employee $emp, string $kind)
    {
        return ($kind === 'exit'
            ? HrTemplateMatch::exitTemplatesFor($emp)
            : HrTemplateMatch::onboardingTemplatesFor($emp))
            ->reject(fn ($t) => preg_match('/\b(leave|attendance)\b/i', (string) $t->name) === 1)
            ->values();
    }

    private function sealed(Employee $emp, string $kind): bool
    {
        if ($kind === 'exit') {
            return DB::table('employee_exits')->where('employee_id', $emp->id)->whereNotNull('completed_at')->exists();
        }
        return (int) ($emp->onboarding_stage_completed ?? 0) >= 6;
    }

    public function show(Request $request, int $employee): JsonResponse
    {
        $emp  = $this->employeeFor($request, $employee);
        $kind = $this->kindOf($request);
        $templates = $this->templatesFor($emp, $kind);

        $lock = HrOnboardingDocsetLock::where('employee_id', $emp->id)->where('kind', $kind)->first();
        $finalized = $lock && $lock->finalized_at !== null;

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
                'run_status'  => $status,
                'signed'      => $status === 'Completed',
                'active'      => in_array($status, ['Pending', 'In Progress'], true),
            ];
        })->values();

        return response()->json([
            'kind'         => $kind,
            'finalized'    => $finalized,
            'finalized_at' => $lock?->finalized_at,
            'can_reopen'   => $finalized && !$this->sealed($emp, $kind),
            'templates'    => $rows,
        ]);
    }

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

        $valid = $this->templatesFor($emp, $kind)->pluck('id')->map(fn ($x) => (int) $x)->all();
        $ids = array_values(array_unique(array_intersect(array_map('intval', $data['template_ids']), $valid)));

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

    public function finalize(Request $request, int $employee): JsonResponse
    {
        $emp  = $this->employeeFor($request, $employee);
        $kind = $this->kindOf($request);

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
