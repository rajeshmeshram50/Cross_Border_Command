<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\SendWelcomeCredentials;
use App\Mail\EmployeeEmailChangedMail;
use App\Mail\PasswordChangedMail;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\Holiday;
use App\Models\Masters\LeavePlans;
use App\Models\Module;
use App\Models\Permission;
use App\Models\User;
use App\Support\OnboardingGuard;
use App\Support\PositionHierarchy;
use App\Support\Settings;
use App\Traits\PasswordHistory;
use Carbon\Carbon;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class EmployeeController extends Controller
{
    use PasswordHistory;
    private const DEFAULT_PER_PAGE = 25;

    private const MAX_PER_PAGE = 200;

    private const LIST_WITH = [
        'department:id,name',
        'designation:id,name,level',
        'primaryRole:id,name',
        'ancillaryRole:id,name',
        'reportingManager:id,display_name,first_name,last_name',
        'reportingManagerUser:id,name',
        'photoDocument:id,employee_id,document_key,file_path',
    ];

    private const LIST_COLUMNS = [
        'id',
        'client_id',
        'branch_id',
        'user_id',
        'deleted_at',
        'emp_code',
        'first_name',
        'middle_name',
        'last_name',
        'display_name',
        'email',
        'status',
        'onboarding_stage_completed',
        'wizard_step_completed',
        'department_id',
        'designation_id',
        'primary_role_id',
        'ancillary_role_id',
        'ancillary_role_ids',
        'reporting_manager_id',
        'reporting_manager_user_id',
        'gender',
        'date_of_birth',
        'work_country_id',
        'nationality_country_id',
        'mobile',
        'address_line1',
        'city',
        'state_id',
        'country_id',
        'pincode',
        'date_of_joining',
        'face_registered_at',
        'face_descriptor',
        'laptop_master_asset_id',
        'mobile_master_asset_id',
        'other_master_asset_ids',
    ];

    private const LIST_DROP_APPENDS = ['other_assets_resolved', 'ancillary_roles_resolved'];

    private const STEP_SAFE_FIELDS = [
        'department_id', 'designation_id', 'primary_role_id', 'ancillary_role_ids',
        'legal_entity_id', 'holiday_group_id', 'holiday_list',
        'nationality_country_id', 'work_country_id',
        'reporting_manager_id', 'reporting_manager_user_id',
        'location', 'date_of_birth', 'gender', 'blood_group',
        'probation_months', 'probation_end_date', 'probation_policy',
        'notice_period', 'weekly_off',
        'attendance_number', 'attendance_tracking', 'biometric_status',
        'desk_workstation_no', 'id_card_status',
        'laptop_assigned', 'laptop_master_asset_id',
        'mobile_assigned', 'mobile_master_asset_id', 'mobile_device',
        'other_assets', 'other_master_asset_ids',
        'expense_policy', 'overtime', 'pay_group', 'penalization_policy',
        'tax_regime', 'time_tracking',
    ];

    private const EXIT_WITH = [
        'department:id,name',
        'designation:id,name',
        'primaryRole:id,name',
        'ancillaryRole:id,name',
        'reportingManager:id,display_name,first_name,last_name',
        'reportingManagerUser:id,name',
        'photoDocument:id,employee_id,document_key,file_path',
        'laptopAsset:id,asset_name,code,asset_number',
        'mobileAsset:id,asset_name,code,asset_number',
        'exit:id,employee_id,notice_date,last_working_day,exit_type,exit_case_status,completed_at,current_stage,rehired_at,blacklisted',
    ];

    private const EXIT_COLUMNS = [
        'id',
        'client_id',
        'branch_id',
        'deleted_at',
        'emp_code',
        'first_name',
        'last_name',
        'display_name',
        'email',
        'status',
        'onboarding_stage_completed',
        'department_id',
        'designation_id',
        'primary_role_id',
        'ancillary_role_id',
        'ancillary_role_ids',
        'reporting_manager_id',
        'reporting_manager_user_id',
        'notice_period',
        'notice_period_days',
        'annual_salary',
        'date_of_joining',
        'probation_end_date',
        'laptop_master_asset_id',
        'mobile_master_asset_id',
        'other_master_asset_ids',
    ];

    private const EXIT_DATE_CASTS = [
        'date_of_joining'    => 'string',
        'probation_end_date' => 'string',
    ];

    private const EXIT_ROW_DATE_CASTS = [
        'notice_date'      => 'string',
        'last_working_day' => 'string',
        'completed_at'     => 'string',
        'rehired_at'       => 'string',
    ];

    private const EXIT_DROP_APPENDS = [
        'face_registered',
        'encrypted_id',
        'profile_completion',
        'other_assets_resolved',
        'ancillary_roles_resolved',
    ];

    private const ONBOARDING_WITH = [
        'department:id,name',
        'designation:id,name',
        'primaryRole:id,name',
        'ancillaryRole:id,name',
        'reportingManager:id,display_name,first_name,last_name',
        'reportingManagerUser:id,name',
        'photoDocument:id,employee_id,document_key,file_path',
    ];

    private const ONBOARDING_COLUMNS = [
        'id',
        'client_id',
        'branch_id',
        'deleted_at',
        'emp_code',
        'first_name',
        'last_name',
        'display_name',
        'status',
        'onboarding_stage_completed',
        'wizard_step_completed',
        'department_id',
        'designation_id',
        'primary_role_id',
        'ancillary_role_id',
        'ancillary_role_ids',
        'reporting_manager_id',
        'reporting_manager_user_id',
        'date_of_joining',
        'gender',
        'date_of_birth',
        'work_country_id',
        'nationality_country_id',
        'email',
        'mobile',
        'address_line1',
        'city',
        'state_id',
        'country_id',
        'pincode',
    ];

    private const ONBOARDING_DROP_APPENDS = [
        'face_registered',
        'encrypted_id',
        'other_assets_resolved',
        'ancillary_roles_resolved',
    ];

    private const WITH = [
        'client:id,org_name',
        'branch:id,name,shifts',
        'creator:id,name,user_type',
        'user:id,name,email,status,last_login_at,user_type,designation',
        'department:id,name,code',
        'designation:id,name,level',
        'primaryRole:id,name,role_category,role_type',
        'ancillaryRole:id,name',
        'legalEntity:id,name,code,city,state,country',
        'workCountry:id,name',
        'nationalityCountry:id,name',
        'country:id,name',
        'state:id,name,country_id',
        'permCountry:id,name',
        'permState:id,name,country_id',
        'reportingManager:id,first_name,middle_name,last_name,display_name,emp_code,designation_id',
        'reportingManager.designation:id,name',
        'reportingManager.photoDocument:id,employee_id,document_key,file_path',
        'reportingManagerUser:id,name,email,user_type,designation',
        'laptopAsset:id,asset_name,code,asset_number',
        'mobileAsset:id,asset_name,code,asset_number',
        'photoDocument:id,employee_id,document_key,file_path',
        'exit:id,employee_id,notice_date,last_working_day,exit_type,exit_case_status,completed_at,current_stage,rehired_at,blacklisted',
        'previousEmployments:id,employee_id,company_name,job_title,start_date,end_date',
    ];

    private static function fullWith(): array
    {
        return array_merge(self::WITH, [
            'holidayGroup' => fn($q) => $q->select('id', 'name')
                ->withCount(['holidays', 'employees']),
        ]);
    }

    public function index(Request $request)
    {
        $this->authorize($request, 'can_view');

        $view     = (string) $request->query('view');
        $listView = $view === 'list';
        $exitView = $view === 'exit';
        $onbView  = $view === 'onboarding';

        $q = Employee::query()->withTrashed()->with(match (true) {
            $listView => self::LIST_WITH,
            $exitView => self::EXIT_WITH,
            $onbView  => self::ONBOARDING_WITH,
            default   => self::fullWith(),
        });
        if ($listView) {
            $q->select(self::LIST_COLUMNS);
        } elseif ($exitView) {
            $q->select(self::EXIT_COLUMNS);
        } elseif ($onbView) {
            $q->select(self::ONBOARDING_COLUMNS);
        }
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);

        $this->applySearch($q, $request->query('search'));
        if ($status = $request->query('status')) {
            $q->where('status', $status);
        }
        if ($dept = $request->query('department_id')) {
            $q->where('department_id', $dept);
        }

        $wantCat   = trim((string) $request->query('document_category', ''));
        $wantLevel = trim((string) $request->query('designation_level', ''));
        if ($tplId = (int) $request->integer('for_template_id')) {
            $tpl = \App\Models\HrDocumentTemplate::select('employee_category', 'role_type')->find($tplId);
            if ($tpl) {
                $wantCat   = $wantCat   ?: trim((string) $tpl->employee_category);
                $wantLevel = $wantLevel ?: trim((string) $tpl->role_type);
            }
        }

        if ($cat = $wantCat) {
            $map = \App\Support\HrTemplateMatch::categoryMap();
            $ids = array_keys(array_filter($map, fn ($c) => $c === $cat));
            if ($cat === 'Non-IT') {
                $mapped = array_keys($map);
                $q->where(function ($w) use ($ids, $mapped) {
                    $w->whereIn('department_id', $ids)
                        ->orWhereNull('department_id')
                        ->orWhereNotIn('department_id', $mapped ?: [0]);
                });
            } else {
                $q->whereIn('department_id', $ids ?: [0]);
            }
        }

        if ($level = $wantLevel) {
            $q->whereHas('designation', fn ($d) => $d->where('level', $level));
        }

        if ($request->has('enabled')) {
            $off = ['inactive', 'terminated', 'resigned'];
            $st = DB::raw("COALESCE(LOWER(status), 'active')");
            $q->where(fn($w) => $request->boolean('enabled')
                ? $w->whereNull('deleted_at')->whereNotIn($st, $off)
                : $w->whereNotNull('deleted_at')->orWhereIn($st, $off));
        }

        if ($request->has('onboarded')) {
            $stage = 'COALESCE(onboarding_stage_completed, 0)';
            $request->boolean('onboarded')
                ? $q->whereRaw("{$stage} >= 6")
                : $q->whereRaw("{$stage} < 6");
        }

        if ($request->boolean('onboarded_only')) {
            $q->whereNull('deleted_at')
                ->where('status', 'Active')
                ->where('onboarding_stage_completed', '>=', 6);
        }

        if ($exitView) {
            $this->applyExitVisibility($q);
            $this->applyExitStatusFilter($q, $request->query('exit_status'));
        }

        if ($onbView) {
            $this->applyOnboardingVisibility($q);
            $this->applyOnboardingTabFilter($q, $request->query('onboarding_status'));
        }

        $q->orderByDesc('id');

        $trimAppends = function ($rows) use ($listView, $exitView, $onbView) {
            if (!$listView && !$exitView && !$onbView) return $rows;

            $items = $rows instanceof \Illuminate\Pagination\AbstractPaginator
                ? $rows->items()
                : $rows;

            $drop = match (true) {
                $listView => self::LIST_DROP_APPENDS,
                $exitView => self::EXIT_DROP_APPENDS,
                default   => self::ONBOARDING_DROP_APPENDS,
            };
            $keep = array_values(array_diff((new Employee)->getAppends(), $drop));
            foreach ($items as $row) {
                $row->setAppends($keep);

                if ($row->relationLoaded('reportingManager')) {
                    $row->getRelation('reportingManager')?->setAppends([]);
                }
            }

            $this->batchAncillaryRoles($items);
            if ($exitView) {
                $this->batchOtherAssets($items);
                $this->stringifyExitDates($items);
            }

            return $rows;
        };

        $stampExitFreeze = function ($rows) {
            $items = $rows instanceof \Illuminate\Pagination\AbstractPaginator
                ? $rows->items()
                : $rows;

            $ids    = collect($items)->pluck('id')->filter()->map(fn($v) => (int) $v)->all();
            $frozen = \App\Support\ExitInProgress::initiatedIds($ids);

            foreach ($items as $row) {
                $row->exit_in_progress = in_array((int) $row->id, $frozen, true);
            }

            return $rows;
        };

        $stampDocCategory = function ($rows) use ($request) {
            if (!$request->boolean('with_document_category')) return $rows;

            $items = $rows instanceof \Illuminate\Pagination\AbstractPaginator
                ? $rows->items()
                : $rows;

            $map = \App\Support\HrTemplateMatch::categoryMap();
            foreach ($items as $row) {
                $row->document_category = $map[(int) $row->department_id] ?? 'Non-IT';
            }

            return $rows;
        };

        if ($request->has('per_page') || $request->has('page')) {
            $requested = $request->query('per_page');
            $perPage = is_numeric($requested) && (int) $requested > 0
                ? min(self::MAX_PER_PAGE, (int) $requested)
                : self::DEFAULT_PER_PAGE;

            return response()->json($stampDocCategory($stampExitFreeze($trimAppends($q->paginate($perPage)))));
        }

        return response()->json($stampDocCategory($stampExitFreeze($trimAppends($q->get()))));
    }

    private function batchAncillaryRoles(iterable $items): void
    {
        $idsFor = function ($row): array {
            $ids = (array) ($row->ancillary_role_ids ?: []);
            if (!$ids && $row->ancillary_role_id) $ids = [$row->ancillary_role_id];
            return $ids;
        };

        $wanted = collect($items)->flatMap($idsFor)->unique()->values();
        $byId = $wanted->isEmpty()
            ? collect()
            : \App\Models\Masters\Roles::query()->whereIn('id', $wanted)->get(['id', 'name'])->keyBy('id');

        foreach ($items as $row) {
            $row->setAttribute(
                'ancillary_roles_resolved',
                collect($idsFor($row))->map(fn($id) => $byId->get($id))->filter()->values(),
            );
        }
    }

    private function batchOtherAssets(iterable $items): void
    {
        $idsFor = fn($row): array => array_values(
            array_filter((array) ($row->other_master_asset_ids ?: []))
        );

        $wanted = collect($items)->flatMap($idsFor)->unique()->values();
        $byId = $wanted->isEmpty()
            ? collect()
            : \App\Models\Masters\Assets::query()
            ->whereIn('id', $wanted)
            ->get(['id', 'asset_name', 'code', 'asset_number'])
            ->keyBy('id');

        foreach ($items as $row) {
            $row->setAttribute(
                'other_assets_resolved',
                collect($idsFor($row))->map(fn($id) => $byId->get($id))->filter()->values(),
            );
        }
    }

    private function stringifyExitDates(iterable $items): void
    {
        foreach ($items as $row) {
            $row->mergeCasts(self::EXIT_DATE_CASTS);

            if ($row->relationLoaded('exit')) {
                $row->getRelation('exit')?->mergeCasts(self::EXIT_ROW_DATE_CASTS);
            }
        }
    }

    private function sqlLiveExit(string $extra = ''): string
    {
        return 'EXISTS (SELECT 1 FROM employee_exits x'
            . ' WHERE x.employee_id = employees.id AND x.rehired_at IS NULL'
            . ($extra ? " AND ({$extra})" : '') . ')';
    }

    private function sqlExitInitiated(): string
    {
        return $this->sqlLiveExit(
            "COALESCE(x.exit_type, '') <> ''"
                . ' OR x.last_working_day IS NOT NULL'
                . ' OR x.notice_date IS NOT NULL'
                . ' OR COALESCE(x.current_stage, 0) >= 1'
        );
    }

    private function sqlExited(): string
    {
        return '(('
            . $this->sqlLiveExit("x.exit_case_status = 'Closed' OR x.completed_at IS NOT NULL")
            . ') OR (('
            . $this->sqlLiveExit()
            . ") AND status IN ('Resigned', 'Terminated', 'Inactive')))";
    }

    private function sqlInProgress(): string
    {
        return '((' . $this->sqlExitInitiated() . ") OR status = 'Notice Period')";
    }

    private function sqlBlacklisted(): string
    {
        return $this->sqlLiveExit("LOWER(COALESCE(x.blacklisted, '')) = 'yes'");
    }

    private function applyExitVisibility($q): void
    {
        $q->where('onboarding_stage_completed', '>=', 6)
            ->whereRaw('(deleted_at IS NULL OR (' . $this->sqlExitInitiated() . ') OR ' . $this->sqlExited() . ')');
    }

    private function applyExitStatusFilter($q, ?string $tab): void
    {
        $exited = $this->sqlExited();
        $prog   = $this->sqlInProgress();

        match ($tab) {
            'exited'      => $q->whereRaw($exited),
            'in-progress' => $q->whereRaw("NOT {$exited} AND {$prog}"),
            'active'      => $q->whereRaw("NOT {$exited} AND NOT {$prog}"),
            default       => null,
        };
    }

    private function applyOnboardingVisibility($q): void
    {
        $st = DB::raw("COALESCE(LOWER(status), 'active')");
        $q->whereNull('deleted_at')
            ->whereNotIn($st, ['resigned', 'terminated', 'inactive']);
    }

    private function sqlOnboardingCompleted(): string
    {
        return "(COALESCE(onboarding_stage_completed, 0) >= 6"
            . " AND COALESCE(LOWER(status), 'active') = 'active')";
    }

    private function sqlOnboardingStarted(): string
    {
        return "(COALESCE(onboarding_stage_completed, 0) > 0"
            . " OR COALESCE(wizard_step_completed, 0) > 0)";
    }

    private function applyOnboardingTabFilter($q, ?string $tab): void
    {
        $completed = $this->sqlOnboardingCompleted();
        if ($tab === 'completed') {
            $q->whereRaw($completed);
        } elseif ($tab === 'pending') {
            $q->whereRaw("NOT {$completed}");
        }
    }

    public function onboardingFormBootstrap(Request $request)
    {
        $this->authorize($request, 'can_view');

        $employeeId = $request->query('employee_id');
        $out = [];
        $skipped = [];

        $take = function (string $key, callable $fn) use (&$out, &$skipped) {
            try {
                $res = $fn();
                $out[$key] = $res instanceof \Illuminate\Http\JsonResponse ? $res->getData(true) : $res;
            } catch (\Throwable $e) {
                $skipped[$key] = $e instanceof \Symfony\Component\HttpKernel\Exception\HttpException
                    ? $e->getStatusCode()
                    : 500;
            }
        };

        $sub = function (array $params) use ($request) {
            $r = Request::create('/api/internal', 'GET', $params + array_filter([
                'branch_id' => $request->query('branch_id'),
            ], fn($v) => $v !== null));
            $r->setUserResolver(fn() => $request->user());
            return $r;
        };

        $branch = app(\App\Http\Controllers\Api\BranchController::class);

        $take('managers',       fn() => $this->managers($sub([])));
        $take('legal_entities', fn() => $branch->legalEntityOptions($sub([])));
        $take('branch_shifts',  fn() => $branch->shiftOptions($sub([])));
        $take('leave_plans',    fn() => app(\App\Http\Controllers\Api\LeavePlanController::class)->index($sub([])));
        $take('holiday_groups', fn() => app(\App\Http\Controllers\Api\HolidayGroupController::class)->index($sub([])));

        if ($employeeId) {
            foreach (['laptop', 'mobile', 'other'] as $cat) {
                $take("assets_{$cat}", fn() => $this->availableAssets($sub([
                    'category' => $cat,
                    'exclude_employee_id' => $employeeId,
                ])));
            }
            $take('salary_structures', fn() => app(\App\Http\Controllers\Api\SalaryStructureController::class)
                ->index($sub(['employee_id' => $employeeId, 'active_only' => 1])));
            $take('doc_set', fn() => app(\App\Http\Controllers\Api\HrOnboardingDocSetController::class)
                ->show($sub([]), $employeeId));
        }

        $take('masters', fn() => app(\App\Http\Controllers\Api\MasterController::class)->bulk($sub([
            'keys'   => 'departments,designations,roles,overtime_rates,countries',
            'fields' => 'id,name,status',
        ])));

        return response()->json(['data' => $out, 'skipped' => $skipped]);
    }

    public function onboardingStats(Request $request)
    {
        $this->authorize($request, 'can_view');

        $base = function () use ($request) {
            $q = Employee::query()->withTrashed();
            $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);
            $this->applySearch($q, $request->query('search'));
            $this->applyOnboardingVisibility($q);
            return $q;
        };

        $completed = $this->sqlOnboardingCompleted();
        $started   = $this->sqlOnboardingStarted();

        $row = $base()->selectRaw("
            COUNT(*)                                                        AS total,
            SUM(CASE WHEN {$completed} THEN 1 ELSE 0 END)                   AS completed,
            SUM(CASE WHEN NOT {$completed} AND {$started} THEN 1 ELSE 0 END) AS in_progress,
            SUM(CASE WHEN NOT {$completed} AND NOT {$started}
                     THEN 1 ELSE 0 END)                                     AS not_started
        ")->first();

        $missing = 0;
        foreach (
            $base()->whereRaw("NOT {$completed}")
                ->select(self::ONBOARDING_COLUMNS)
                ->cursor() as $emp
        ) {
            if ($emp->profile_completion < 60) $missing++;
        }

        $total     = (int) ($row->total ?? 0);
        $completedN = (int) ($row->completed ?? 0);

        return response()->json([
            'total'      => $total,
            'completed'  => $completedN,
            'inProgress' => (int) ($row->in_progress ?? 0),
            'notStarted' => (int) ($row->not_started ?? 0),
            'missing'    => $missing,
            'pending'    => $total - $completedN,
        ]);
    }

    public function exitStats(Request $request)
    {
        $this->authorize($request, 'can_view');

        $q = Employee::query()->withTrashed();
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);
        $this->applySearch($q, $request->query('search'));
        $this->applyExitVisibility($q);

        $exited      = $this->sqlExited();
        $prog        = $this->sqlInProgress();
        $blacklisted = $this->sqlBlacklisted();

        $row = $q->selectRaw("
            COUNT(*)                                                    AS total,
            SUM(CASE WHEN {$exited} THEN 1 ELSE 0 END)                  AS exited,
            SUM(CASE WHEN NOT {$exited} AND {$prog} THEN 1 ELSE 0 END)  AS in_progress,
            SUM(CASE WHEN NOT {$exited} AND NOT {$prog}
                     THEN 1 ELSE 0 END)                                 AS active,
            SUM(CASE WHEN {$blacklisted} THEN 1 ELSE 0 END)             AS blacklisted
        ")->first();

        return response()->json([
            'total'       => (int) ($row->total ?? 0),
            'active'      => (int) ($row->active ?? 0),
            'inProgress'  => (int) ($row->in_progress ?? 0),
            'exited'      => (int) ($row->exited ?? 0),
            'blacklisted' => (int) ($row->blacklisted ?? 0),
        ]);
    }

    private const TRAINEE_WORDS = ['intern', 'trainee', 'apprentice', 'articleship'];

    public const TRAINEE_LEVEL = 'Intern / Trainee';

    public static function isTrainee(?Employee $e): bool
    {
        if (!$e) return false;

        return $e->designation?->level === self::TRAINEE_LEVEL
            || self::mentionsAny($e->employee_type, self::TRAINEE_WORDS)
            || self::mentionsAny($e->work_type, self::TRAINEE_WORDS);
    }

    private const HR_WORDS = ['human resource', 'hr'];

    public static function isHrEligible(?Employee $e): bool
    {
        if (!$e || self::isTrainee($e)) return false;

        return self::mentionsAny($e->department?->name, self::HR_WORDS)
            || self::mentionsAny($e->designation?->name, self::HR_WORDS)
            || self::mentionsAny($e->primaryRole?->name, self::HR_WORDS);
    }

    private static function mentionsAny($value, array $words): bool
    {
        $s = strtolower(trim((string) $value));
        if ($s === '') return false;

        foreach ($words as $w) {
            $hit = strlen($w) <= 3
                ? preg_match('/\b' . preg_quote($w, '/') . '\b/', $s) === 1
                : str_contains($s, $w);
            if ($hit) return true;
        }
        return false;
    }

    private function applySearch($q, ?string $search): void
    {
        if (!$search = trim((string) $search)) {
            return;
        }
        $q->where(function ($w) use ($search) {
            $w->where('display_name', 'ilike', "%{$search}%")
                ->orWhere('emp_code', 'ilike', "%{$search}%")
                ->orWhere('email', 'ilike', "%{$search}%")
                ->orWhere('mobile', 'ilike', "%{$search}%")
                ->orWhereHas('department', fn($d) => $d->where('name', 'ilike', "%{$search}%"))
                ->orWhereHas('designation', fn($d) => $d->where('name', 'ilike', "%{$search}%"))
                ->orWhereHas('primaryRole', fn($r) => $r->where('name', 'ilike', "%{$search}%"));
        });
    }

    public function stats(Request $request)
    {
        $this->authorize($request, 'can_view');

        $q = Employee::query()->withTrashed();
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);
        $this->applySearch($q, $request->query('search'));

        $enabled = "(deleted_at IS NULL AND COALESCE(LOWER(status), 'active') NOT IN ('inactive', 'terminated', 'resigned'))";
        $stage   = 'COALESCE(onboarding_stage_completed, 0)';
        $step    = 'COALESCE(wizard_step_completed, 0)';

        $row = $q->selectRaw("
            COUNT(*)                                                              AS total,
            SUM(CASE WHEN {$enabled} THEN 1 ELSE 0 END)                           AS active,
            SUM(CASE WHEN {$enabled} THEN 0 ELSE 1 END)                           AS disabled,
            SUM(CASE WHEN {$enabled} AND {$stage} >= 6 THEN 1 ELSE 0 END)        AS onboarding_completed,
            SUM(CASE WHEN {$enabled} AND {$stage} < 6 AND ({$stage} > 0 OR {$step} > 0)
                     THEN 1 ELSE 0 END)                                           AS new_joiners
        ")->first();

        return response()->json([
            'total'                => (int) ($row->total ?? 0),
            'active'               => (int) ($row->active ?? 0),
            'disabled'             => (int) ($row->disabled ?? 0),
            'onboarding_completed' => (int) ($row->onboarding_completed ?? 0),
            'new_joiners'          => (int) ($row->new_joiners ?? 0),
        ]);
    }

    public function show(Request $request, $id)
    {
        $row = $this->resolveRow($request, $this->resolveIdParam($id));
        if ((int) ($row->user_id ?? 0) !== (int) $request->user()->id) {
            $this->authorize($request, 'can_view');
        }
        [$shiftStart, $shiftEnd] = $row->resolveShiftWindow();
        $row->setAttribute('shift_start', $shiftStart);
        $row->setAttribute('shift_end', $shiftEnd);
        $row->setAttribute('password_status', $this->passwordStatusFor($row));
        $row->setAttribute(
            'exit_in_progress',
            in_array((int) $row->id, \App\Support\ExitInProgress::employeeIds(null, [(int) $row->id]), true),
        );
        return response()->json($row);
    }

    public function updateBankDetails(Request $request, $id)
    {
        $row = $this->resolveRow($request, $this->resolveIdParam($id));

        $isSelf = (int) ($row->user_id ?? 0) === (int) $request->user()->id;
        if (!$isSelf) {
            $this->authorize($request, 'can_edit');
        }

        if ($row->isDisabled()) {
            return response()->json([
                'message' => 'This employee is disabled — restore/re-activate them before editing bank details.',
            ], 422);
        }

        $data = $request->validate([
            'salary_payment_mode' => 'nullable|in:bank,cheque,cash',
            'bank_name'           => ['nullable', 'string', 'max:150', 'regex:/^[A-Za-z ]+$/'],
            'bank_account_number' => ['nullable', 'string', 'regex:/^\d{8,18}$/'],
            'ifsc_code'           => 'nullable|string|regex:/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/',
            'account_holder_name' => ['nullable', 'string', 'max:150', 'regex:/^[A-Za-z ]+$/'],
            'bank_branch'         => ['nullable', 'string', 'max:150', 'regex:/^(?=.*[A-Za-z])[A-Za-z0-9 .,\-\/()&\']+$/'],
            'bank_account_type'   => 'nullable|string|max:30',
        ], [
            'ifsc_code.regex' => 'Enter a valid IFSC code (e.g. HDFC0001234).',
            'bank_account_number.regex' => 'Account Number must be 8 to 18 digits, with no spaces or symbols.',
            'bank_branch.regex' => 'Branch can contain letters, numbers, spaces and . , - / ( ) & only.',
        ]);

        if (!empty($data['ifsc_code'])) {
            $data['ifsc_code'] = strtoupper($data['ifsc_code']);
        }

        $row->fill($data)->save();

        return response()->json([
            'message' => 'Bank details updated.',
            'data'    => $row->only(array_keys($data)),
        ]);
    }

    public function holidays(Request $request, $id)
    {
        $empId = $this->resolveIdParam($id);
        $this->authorizeViewOrSelf($request, $empId);
        $emp = $this->resolveRow($request, $empId);

        $year    = (int) ($request->query('year') ?: now()->year);
        $groupId = $emp->holiday_group_id;
        if (!$groupId) {
            return response()->json(['group' => null, 'year' => $year, 'holidays' => []]);
        }

        $holidays = Holiday::where('holiday_group_id', $groupId)
            ->orderBy('date')
            ->get()
            ->map(function (Holiday $h) use ($year) {
                $arr = $h->toArray();
                if ($h->is_recurring && $h->date) {
                    $d = Carbon::parse($h->date);
                    $arr['date'] = Carbon::create($year, $d->month, $d->day)->toDateString();
                }
                return $arr;
            })
            ->filter(fn($h) => (int) substr((string) $h['date'], 0, 4) === $year)
            ->sortBy('date')
            ->values();

        return response()->json([
            'group'    => ['id' => $groupId, 'name' => $emp->holidayGroup?->name],
            'year'     => $year,
            'holidays' => $holidays,
        ]);
    }

    private function joiningFloorFor($employeeId): string
    {
        $default = now()->subYears(50)->toDateString();
        if (!$employeeId) {
            return $default;
        }

        $rehiredAt = \App\Models\EmployeeExit::where('employee_id', $employeeId)
            ->whereNotNull('rehired_at')
            ->orderByDesc('rehired_at')
            ->value('rehired_at');

        return $rehiredAt ? Carbon::parse($rehiredAt)->toDateString() : $default;
    }

    private function resolveIdParam($id): int
    {
        if (is_numeric($id)) return (int) $id;
        $raw = (string) $id;
        if ($raw === '') return 0;

        $normalised = strtr($raw, '-_', '+/');
        $pad = strlen($normalised) % 4;
        if ($pad) $normalised .= str_repeat('=', 4 - $pad);
        try {
            $decoded = \Illuminate\Support\Facades\Crypt::decryptString($normalised);
            if (is_numeric($decoded)) return (int) $decoded;
        } catch (\Throwable $e) {
        }

        $user = request()->user();
        $q = Employee::withTrashed()->where('emp_code', $raw);
        if ($user && $user->user_type !== 'super_admin') {
            $q->where(function ($w) use ($user) {
                $w->whereNull('client_id')->orWhere('client_id', $user->client_id);
            });
            if ($user->branch_id) {
                $q->where(function ($w) use ($user) {
                    $w->whereNull('branch_id')->orWhere('branch_id', $user->branch_id);
                });
            }
        }
        $byEmpCode = $q->value('id');
        return (int) ($byEmpCode ?? 0);
    }

    public function managers(Request $request)
    {
        $this->authorize($request, 'can_view');
        $user = $request->user();

        $eq = Employee::query()
            ->whereNotNull('id')
            ->where('status', 'Active')
            ->where('onboarding_stage_completed', '>=', 6)
            ->whereDoesntHave('exit', fn($q) => $q->whereNull('rehired_at'));
        $this->applyScope($eq, $user, $request->integer('branch_id') ?: null);
        $hodIds = \App\Support\DepartmentPermissionSync::hodDesignationIds();
        $employees = $eq
            ->select(['id', 'emp_code', 'display_name', 'first_name', 'last_name', 'designation_id', 'department_id'])
            ->with(['designation:id,name', 'department:id,name'])
            ->orderBy('display_name')
            ->get()
            ->map(fn($e) => [
                'id'            => $e->id,
                'kind'          => 'employee',
                'department_id' => $e->department_id,
                'is_hod'        => in_array((int) $e->designation_id, $hodIds, true),
                'rank'          => \App\Support\PositionHierarchy::rankForDesignationName($e->designation?->name),
                'label' => self::managerLabel(
                    $e->display_name ?: trim($e->first_name . ' ' . $e->last_name),
                    $e->designation?->name ?: 'Employee',
                    $e->department?->name,
                ),
            ]);

        $uq = User::query()
            ->whereIn('user_type', ['client_admin', 'client_user', 'branch_user'])
            ->where('status', 'active');
        if (!$user->isSuperAdmin()) {
            $uq->where('client_id', $user->client_id);
            if (in_array($user->user_type, ['branch_user', 'employee'], true)) {
                $uq->where(function ($q) use ($user) {
                    $q->whereNull('branch_id')->orWhere('branch_id', $user->branch_id);
                });
            }
        }
        $loginUsers = $uq
            ->select(['id', 'name', 'user_type', 'designation'])
            ->orderBy('name')
            ->get();

        $linkedEmps = Employee::query()
            ->whereIn('user_id', $loginUsers->pluck('id')->all())
            ->with(['designation:id,name', 'department:id,name'])
            ->get(['id', 'user_id', 'designation_id', 'department_id']);

        $empDesigByUser = $linkedEmps->reduce(function ($map, $e) {
            if ($e->user_id && $e->designation?->name) $map[$e->user_id] = $e->designation->name;
            return $map;
        }, []);

        $empDeptByUser = $linkedEmps->reduce(function ($map, $e) {
            if ($e->user_id && $e->department?->name) $map[$e->user_id] = $e->department->name;
            return $map;
        }, []);

        $loginUsers = $loginUsers->map(fn($u) => [
            'id'    => $u->id,
            'kind'  => $u->user_type,
            'rank'  => \App\Support\PositionHierarchy::TOP_RANK,
            'label' => self::managerLabel(
                $u->name,
                ($empDesigByUser[$u->id] ?? $u->designation) ?: ucfirst(str_replace('_', ' ', $u->user_type)),
                $empDeptByUser[$u->id] ?? null,
            ),
        ]);

        return response()->json([
            'employees'   => $employees->values(),
            'login_users' => $loginUsers->values(),
        ]);
    }

    private static function managerLabel(?string $name, ?string $designation, ?string $department): string
    {
        $parts = array_values(array_filter(
            [trim((string) $name), trim((string) $designation), trim((string) $department)],
            fn($v) => $v !== '',
        ));

        return $parts === [] ? 'Employee' : implode(' — ', $parts);
    }

    public function departmentOrgTree(Request $request, int $departmentId)
    {
        $this->authorize($request, 'can_view');
        $user = $request->user();
        $branchFilter = ($user->branch_id ?: null) ?: ($request->integer('branch_id') ?: null);

        $directors = User::query()
            ->where('client_id', $user->client_id)
            ->where('user_type', 'branch_user')
            ->where('status', 'active')
            ->when($branchFilter, fn($q) => $q->where('branch_id', $branchFilter))
            ->orderBy('name')
            ->get(['id', 'name']);

        $emps = Employee::query()
            ->where('client_id', $user->client_id)
            ->where('department_id', $departmentId)
            ->when($branchFilter, fn($q) => $q->where('branch_id', $branchFilter))
            ->with(['designation:id,name', 'photoDocument'])
            ->orderBy('display_name')
            ->get();

        $byId = [];
        foreach ($directors as $d) {
            $byId['u' . $d->id] = ['id' => 'u' . $d->id, 'name' => $d->name, 'role' => 'Director / CEO', 'photo' => null];
        }
        foreach ($emps as $e) {
            $byId['e' . $e->id] = [
                'id'    => 'e' . $e->id,
                'name'  => $e->display_name ?: trim($e->first_name . ' ' . $e->last_name),
                'role'  => $e->designation?->name ?: 'Employee',
                'photo' => $e->photo_url,
            ];
        }

        $firstDirector = $directors->first() ? 'u' . $directors->first()->id : null;
        $childrenOf = [];
        $orphanRoots = [];
        foreach ($emps as $e) {
            $ck = 'e' . $e->id;
            $pk = null;
            if ($e->reporting_manager_id && isset($byId['e' . $e->reporting_manager_id])) {
                $pk = 'e' . $e->reporting_manager_id;
            } elseif ($e->reporting_manager_user_id && isset($byId['u' . $e->reporting_manager_user_id])) {
                $pk = 'u' . $e->reporting_manager_user_id;
            } elseif ($firstDirector) {
                $pk = $firstDirector;
            }
            if ($pk) {
                $childrenOf[$pk][] = $ck;
            } else {
                $orphanRoots[] = $ck;
            }
        }

        $rootKeys = array_values(array_unique(array_merge(
            array_map(fn($d) => 'u' . $d->id, $directors->all()),
            $orphanRoots
        )));

        $build = function ($key, array $seen = []) use (&$build, $byId, $childrenOf) {
            $node = $byId[$key];
            $seen[$key] = true;
            $kids = array_filter($childrenOf[$key] ?? [], fn($ck) => empty($seen[$ck]));
            $node['children'] = array_values(array_map(fn($ck) => $build($ck, $seen), $kids));
            return $node;
        };
        $roots = array_map(fn($k) => $build($k), $rootKeys);

        return response()->json(['status' => true, 'data' => ['roots' => $roots]]);
    }

    public function nextCode(Request $request)
    {
        $this->authorize($request, 'can_view');
        [$clientId, $branchId] = $this->resolveOwnership($request);

        $q = Employee::query()->withTrashed();
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);

        $max = 0;
        foreach ($q->pluck('emp_code') as $code) {
            if (preg_match('/^EMP-(\d+)$/i', (string) $code, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
        }
        return response()->json([
            'code'   => 'EMP-' . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT),
            'prefix' => 'EMP-',
        ]);
    }

    public function checkEmail(Request $request)
    {
        $this->authorize($request, 'can_view');

        $email = trim((string) $request->query('email', ''));
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return response()->json(['available' => true, 'conflict' => null]);
        }

        $excludeId = $request->integer('exclude_employee_id') ?: null;

        if ($excludeId !== null) {
            $clientId = Employee::withTrashed()->where('id', $excludeId)->value('client_id');
        } else {
            [$clientId] = $this->resolveOwnership($request);
        }
        $clientId = $clientId === null ? null : (int) $clientId;

        $selfRows = [];
        if ($excludeId !== null) {
            $selfRows[] = ['table' => 'employees', 'id' => $excludeId];
            $userId = Employee::withTrashed()->where('id', $excludeId)->value('user_id');
            if ($userId) $selfRows[] = ['table' => 'users', 'id' => (int) $userId];
            foreach (\App\Models\EmployeeOnboardingInvite::where('employee_id', $excludeId)->pluck('id') as $inviteId) {
                $selfRows[] = ['table' => 'employee_onboarding_invites', 'id' => (int) $inviteId];
            }
        }

        $conflict = \App\Support\EmailGuard::firstConflictAcross(
            ['person', 'candidate', 'organisation', 'customer', 'consignee', 'vendor'],
            $email,
            $clientId,
            $selfRows,
        );

        if ($conflict) {
            return response()->json([
                'available' => false,
                'conflict'  => true,
                'message'   => \App\Support\EmailGuard::message($conflict),
            ]);
        }

        return response()->json(['available' => true, 'conflict' => null]);
    }

    public function checkMobile(Request $request)
    {
        $this->authorize($request, 'can_view');

        $mobile = trim((string) $request->query('mobile', ''));
        if ($mobile === '') {
            return response()->json(['available' => true, 'conflict' => null]);
        }

        $excludeId = $request->integer('exclude_employee_id') ?: null;

        if ($excludeId !== null) {
            $clientId = Employee::withTrashed()->where('id', $excludeId)->value('client_id');
        } else {
            [$clientId] = $this->resolveOwnership($request);
        }

        $q = Employee::query()->where('mobile', $mobile);
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        if ($excludeId !== null) $q->where('id', '!=', $excludeId);

        if (! $q->exists()) {
            return response()->json(['available' => true, 'conflict' => null]);
        }

        $message = 'This mobile number is already in use by another employee.';

        return response()->json([
            'available' => false,
            'conflict'  => true,
            'message'   => $message,
        ]);
    }

    public function availableAssets(Request $request)
    {
        $this->authorize($request, 'can_view');
        $category = strtolower((string) $request->query('category', ''));
        $excludeEmployeeId = $request->query('exclude_employee_id');

        if (!in_array($category, ['laptop', 'mobile', 'other'], true)) {
            abort(422, 'category must be one of laptop, mobile, other');
        }

        $catRows = \App\Models\Masters\AssetCategories::query()
            ->whereRaw('LOWER(name) IN (?, ?)', ['laptop', 'mobile'])
            ->when($request->user() && !$request->user()->isSuperAdmin(), function ($q) use ($request) {
                $cid = $request->user()->client_id;
                $q->where(fn($w) => $w->whereNull('client_id')->orWhere('client_id', $cid));
            })
            ->get(['id', 'name']);
        $laptopCatIds = [];
        $mobileCatIds = [];
        foreach ($catRows as $row) {
            $n = strtolower($row->name);
            if ($n === 'laptop') $laptopCatIds[] = (int) $row->id;
            if ($n === 'mobile') $mobileCatIds[] = (int) $row->id;
        }

        $assetQ = \App\Models\Masters\Assets::query();
        $u = $request->user();
        if ($u && !$u->isSuperAdmin()) {
            $assetQ->where(function ($w) use ($u) {
                $w->whereNull('client_id')->orWhere('client_id', $u->client_id);
            });
        }

        $branchId = null;
        if ($excludeEmployeeId) {
            $branchId = Employee::query()
                ->when(
                    $u && !$u->isSuperAdmin() && $u->client_id,
                    fn($q) => $q->where('client_id', $u->client_id)
                )
                ->whereKey((int) $excludeEmployeeId)
                ->value('branch_id');
        }
        if (!$branchId) {
            $branchId = $request->integer('branch_id') ?: ($u?->branch_id ?: null);
        }
        if ($u && ($u->user_type ?? null) === 'branch_user' && $u->branch_id) {
            $branchId = (int) $u->branch_id;
        }
        if ($branchId) {
            $assetQ->where('branch_id', $branchId);
        }

        if ($category === 'laptop') {
            if (empty($laptopCatIds)) return response()->json([]);
            $assetQ->whereIn('asset_type_id', $laptopCatIds);
        } elseif ($category === 'mobile') {
            if (empty($mobileCatIds)) return response()->json([]);
            $assetQ->whereIn('asset_type_id', $mobileCatIds);
        } elseif ($category === 'other') {
            $excludeIds = array_merge($laptopCatIds, $mobileCatIds);
            if (!empty($excludeIds)) {
                $assetQ->whereNotIn('asset_type_id', $excludeIds);
            }
        }

        $assetQ->where(function ($w) {
            $w->whereNull('status')->orWhere('status', 'Active');
        });

        $assets = $assetQ->orderBy('asset_name')->get();
        $assetIds = $assets->pluck('id')->all();

        $bookedIds = collect();
        if (!empty($assetIds)) {
            $bookingQ = Employee::withTrashed()
                ->where(function ($w) {
                    $w->whereNull('status')
                        ->orWhereNotIn('status', ['Resigned', 'Terminated']);
                })
                ->when(
                    $u && !$u->isSuperAdmin() && $u->client_id,
                    fn($q) => $q->where('client_id', $u->client_id)
                );
            $rows = $bookingQ->select(['id', 'laptop_master_asset_id', 'mobile_master_asset_id', 'other_master_asset_ids'])->get();
            foreach ($rows as $r) {
                if ($r->laptop_master_asset_id) $bookedIds->push((int) $r->laptop_master_asset_id);
                if ($r->mobile_master_asset_id) $bookedIds->push((int) $r->mobile_master_asset_id);
                foreach ((array) ($r->other_master_asset_ids ?? []) as $aid) {
                    $bookedIds->push((int) $aid);
                }
            }
        }
        $bookedSet = $bookedIds->unique()->flip();

        $ownSlotIds = [];
        if ($excludeEmployeeId) {
            $self = Employee::withTrashed()
                ->when(
                    $u && !$u->isSuperAdmin() && $u->client_id,
                    fn($q) => $q->where('client_id', $u->client_id)
                )
                ->whereKey((int) $excludeEmployeeId)
                ->first(['id', 'laptop_master_asset_id', 'mobile_master_asset_id', 'other_master_asset_ids']);
            if ($self) {
                if ($category === 'laptop' && $self->laptop_master_asset_id) {
                    $ownSlotIds[] = (int) $self->laptop_master_asset_id;
                } elseif ($category === 'mobile' && $self->mobile_master_asset_id) {
                    $ownSlotIds[] = (int) $self->mobile_master_asset_id;
                } elseif ($category === 'other') {
                    foreach ((array) ($self->other_master_asset_ids ?? []) as $aid) {
                        $ownSlotIds[] = (int) $aid;
                    }
                }
            }
            foreach ($ownSlotIds as $aid) {
                $bookedSet->forget($aid);
            }
        }

        $presentIds = $assets->pluck('id')->map(fn($i) => (int) $i)->flip();
        $staleIds = array_values(array_filter($ownSlotIds, fn($aid) => !$presentIds->has($aid)));
        if (!empty($staleIds)) {
            $stale = \App\Models\Masters\Assets::query()
                ->when($u && !$u->isSuperAdmin(), function ($w) use ($u) {
                    $w->where(fn($q) => $q->whereNull('client_id')->orWhere('client_id', $u->client_id));
                })
                ->whereIn('id', $staleIds)
                ->get();
            $assets = $assets->concat($stale);
        }
        $staleSet = collect($staleIds)->flip();

        return response()->json(
            $assets
                ->reject(fn($a) => $bookedSet->has($a->id))
                ->map(function ($a) use ($staleSet) {
                    $idPart = $a->code ?: $a->asset_number;
                    $label  = trim(($idPart ? $idPart . ' — ' : '') . ($a->asset_name ?? ''));
                    return [
                        'id'            => $a->id,
                        'asset_name'    => $a->asset_name,
                        'asset_number'  => $a->asset_number,
                        'code'          => $a->code,
                        'label'         => $label,
                        'stale_category' => $staleSet->has((int) $a->id),
                    ];
                })
                ->values(),
        );
    }

    public function store(Request $request)
    {
        $this->authorize($request, 'can_add');
        $data = $this->validatePayload($request);
        $data = $this->mirrorAncillaryRoles($data);
        $data = $this->syncNoticePeriodDays($data);
        [$dbClientId] = $this->resolveOwnership($request);
        $this->assertAssetsNotDoubleBooked($data, null, $dbClientId);

        try {
            return DB::transaction(function () use ($request, $data) {
                $auth = $request->user();
                [$clientId, $branchId] = $this->resolveOwnership($request);

                $this->guardDuplicate($data, $clientId, null);

                $this->assertSingleHodPerDepartment($data, $clientId, $branchId, null);

                $this->assertReportingManagerEligible($data, null);

                $this->assertBranchUserCap($branchId);

                $rawPassword = $this->generatePassword();
                $loginUser = User::create([
                    'name' => Employee::composeDisplayName($data['first_name'], $data['middle_name'] ?? null, $data['last_name'] ?? null),
                    'email' => $data['email'],
                    'password' => Hash::make(Str::random(40)),
                    'password_encrypted' => null,
                    'phone'         => $data['mobile'] ?? null,
                    'user_type'     => 'employee',
                    'client_id'     => $clientId,
                    'branch_id'     => $branchId,
                    'status'        => 'active',
                    'designation'   => $request->input('designation_name'),
                    'employee_code' => null,
                ]);

                $empCode = $this->allocateCode($clientId, $branchId);

                $stepCompleted = max(1, min(4, (int) $request->input('wizard_step_completed', 1)));

                $payload = array_merge($data, [
                    'client_id'             => $clientId,
                    'branch_id'             => $branchId,
                    'created_by'            => $auth?->id,
                    'user_id'               => $loginUser->id,
                    'emp_code'              => $empCode,
                    'display_name'          => Employee::composeDisplayName($data['first_name'], $data['middle_name'] ?? null, $data['last_name'] ?? null),
                    'status'                => $data['status'] ?? 'Active',
                    'wizard_step_completed' => $stepCompleted,
                ]);
                $employee = Employee::create($payload);

                if ((int) ($payload['onboarding_stage_completed'] ?? 0) >= OnboardingGuard::COMPLETE_STAGE) {
                    OnboardingGuard::assertDocumentsSigned($employee);
                }

                $this->syncLeavePlanPivot($employee, $data['leave_plan'] ?? null, $auth?->id);

                $loginUser->update(['employee_code' => $empCode]);

                $this->grantSelfServicePermissions($loginUser, $clientId, $branchId, $auth?->id);

                $this->applyHodOnboarding($employee, $auth?->id);

                $employee->load(self::fullWith());

                return response()->json([
                    'message'  => 'Employee created. Welcome email will be sent once the wizard completes Step 4.',
                    'employee' => $employee,
                ], 201);
            });
        } catch (QueryException $e) {
            if ($e->getCode() === '23505') {
                $constraint = $e->getMessage();
                if (str_contains($constraint, 'users_email')) {
                    throw ValidationException::withMessages([
                        'email' => ['This email already has an account in this organization. Each email can be used only once per organization — use a different email.'],
                    ]);
                }
                if (str_contains($constraint, 'emp_code')) {
                    throw ValidationException::withMessages([
                        'employee_code' => ['Could not allocate an employee code — that code is already in use. Please retry.'],
                    ]);
                }
                if (str_contains($constraint, 'pan_number')) {
                    throw ValidationException::withMessages([
                        'pan_number' => ['This PAN is already registered to another employee.'],
                    ]);
                }
            }
            throw $e;
        }
    }

    private function normalisePfType(Employee $row, array $data): array
    {
        if (!array_key_exists('pf_eligible', $data) && !array_key_exists('pf_type', $data)) {
            return $data;
        }
        $pfOn = array_key_exists('pf_eligible', $data)
            ? (bool) $data['pf_eligible']
            : (bool) $row->pf_eligible;
        $pfType = array_key_exists('pf_type', $data) ? $data['pf_type'] : $row->pf_type;
        $data['pf_type'] = $pfOn ? ($pfType ?: 'statutory') : ($pfType ?: $row->pf_type);
        return $data;
    }

    private function assertSalaryNotLockedByExit(Employee $row, array $data): void
    {
        $guarded = [
            'annual_salary',
            'salary_effective_from',
            'salary_frequency',
            'salary_structure',
            'pay_group',
            'bonus_in_annual',
            'tax_regime',
            'pf_eligible',
            'pf_type',
            'esi_applicable',
        ];

        $changing = [];
        foreach ($guarded as $field) {
            if (!array_key_exists($field, $data)) {
                continue;
            }
            if ($this->salaryValueChanged($row->{$field}, $data[$field])) {
                $changing[] = $field;
            }
        }
        if (empty($changing)) {
            return;
        }

        if (!in_array((int) $row->id, \App\Support\ExitInProgress::employeeIds(null, [(int) $row->id]), true)) {
            return;
        }

        throw ValidationException::withMessages([
            'annual_salary' => 'This employee has an exit in progress, so their salary is locked. '
                . 'Dues are settled through the Full & Final settlement in Exit Management — '
                . 'changing the salary here would re-price their final month and the settlement.',
        ]);
    }

    private function salaryValueChanged(mixed $current, mixed $incoming): bool
    {
        $norm = static function (mixed $v): ?string {
            if ($v === null || $v === '') return null;
            if (is_bool($v)) return $v ? '1' : '0';
            if (is_numeric($v)) return rtrim(rtrim(number_format((float) $v, 4, '.', ''), '0'), '.');
            return trim((string) $v);
        };
        return $norm($current) !== $norm($incoming);
    }

    public function update(Request $request, $id)
    {
        $this->authorize($request, 'can_edit');
        $row = $this->resolveRow($request, (int) $id);

        $incomingStatus = (string) $request->input('status', '');
        $reactivating   = $incomingStatus !== ''
            && !in_array(strtolower($incomingStatus), ['inactive', 'resigned', 'terminated'], true);
        if ($reactivating && $row->isDisabled()) {
            $this->assertNotExited($row, 'reactivate');
        }
        if ($row->isDisabled() && !$reactivating) {
            return response()->json([
                'message' => 'This employee is disabled — restore/re-activate them from the HR Employees page before editing or continuing onboarding.',
            ], 422);
        }

        $this->assertExitNotInitiated($row);

        $data = $this->validatePayload($request, $row->id);
        $data = $this->mirrorAncillaryRoles($data);
        $data = $this->syncNoticePeriodDays($data);
        $this->assertSalaryNotLockedByExit($row, $data);
        $this->assertAssetsNotDoubleBooked($data, $row->id, $row->client_id);
        $this->guardDuplicate($data, $row->client_id, $row->id);

        $this->assertSingleHodPerDepartment($data, $row->client_id, $row->branch_id, $row->id, $row);

        $this->assertReportingManagerEligible($data, $row->id, $row);

        $stepFromRequest = (int) $request->input('wizard_step_completed', 0);
        $oldStep = (int) $row->wizard_step_completed;
        $newStep = max($oldStep, $stepFromRequest);

        $macroFromRequest = (int) $request->input('onboarding_stage_completed', 0);
        $oldMacro = (int) $row->onboarding_stage_completed;
        $newMacro = max($oldMacro, $macroFromRequest);
        if ($newStep >= 4) {
            $newMacro = max($newMacro, 1);
        }

        if ($newMacro >= OnboardingGuard::COMPLETE_STAGE && $oldMacro < OnboardingGuard::COMPLETE_STAGE) {
            OnboardingGuard::assertDocumentsSigned($row);
        }

        $oldStatus = (string) $row->getOriginal('status');
        $shiftChangedFrom = array_key_exists('shift', $data)
            ? (string) ($row->getOriginal('shift') ?? '')
            : null;

        $authId = $request->user()?->id;
        $emailChange = null;

        DB::transaction(function () use ($row, $data, $newStep, $newMacro, $oldStatus, $authId, &$emailChange) {
            $data = $this->normalisePfType($row, $data);

            $first  = $data['first_name']  ?? $row->first_name;
            $middle = array_key_exists('middle_name', $data) ? $data['middle_name'] : $row->middle_name;
            $last   = array_key_exists('last_name', $data)   ? $data['last_name']   : $row->last_name;
            $row->update(array_merge($data, [
                'display_name'                => Employee::composeDisplayName($first, $middle, $last),
                'wizard_step_completed'       => $newStep,
                'onboarding_stage_completed'  => $newMacro,
            ]));

            $row->unsetRelations();
            $this->applyHodOnboarding($row->refresh(), $authId);

            if (array_key_exists('leave_plan', $data)) {
                $this->syncLeavePlanPivot($row, $data['leave_plan'], $authId);
            }

            if ($row->user) {
                $newEmail = $data['email'] ?? $row->user->email;
                $oldEmail = (string) $row->user->email;
                $emailChanged = strcasecmp((string) $newEmail, (string) $row->user->email) !== 0;

                $row->user->update([
                    'name'        => $row->display_name,
                    'email'       => $newEmail,
                    'phone'       => $data['mobile'] ?? $row->user->phone,
                    'designation' => $data['designation_name'] ?? $row->user->designation,
                ]);

                if ($emailChanged) {
                    $row->user->update(['must_reset_password' => true]);
                    $row->user->tokens()->delete();
                    $emailChange = [$oldEmail, (string) $newEmail];
                }

                $newStatus = array_key_exists('status', $data)
                    ? (string) $data['status']
                    : $oldStatus;
                if (strcasecmp($oldStatus, $newStatus) !== 0) {
                    $disabled = in_array(strtolower($newStatus), ['inactive', 'resigned', 'terminated'], true);
                    $row->user->update(['status' => $disabled ? 'inactive' : 'active']);
                    if ($disabled) {
                        $row->user->tokens()->delete();
                    }
                }
            }
        });

        $row->loadMissing('user');

        if ($emailChange) {
            $this->notifyEmailChanged($row, $emailChange[0], $emailChange[1], $request);
        }

        if (array_key_exists('pf_eligible', $data) || array_key_exists('esi_applicable', $data)) {
            $activeStructure = \App\Models\SalaryStructure::where('employee_id', $row->id)
                ->where('status', 'active')
                ->orderByDesc('version')
                ->first();

            if ($activeStructure) {
                $wantPf = array_key_exists('pf_eligible', $data)
                    ? (bool) $row->pf_eligible
                    : (bool) $activeStructure->pf_applicable;
                $wantEsi = array_key_exists('esi_applicable', $data)
                    ? strtolower((string) $row->esi_applicable) === 'yes'
                    : (bool) $activeStructure->esi_applicable;

                if (
                    $wantPf !== (bool) $activeStructure->pf_applicable
                    || $wantEsi !== (bool) $activeStructure->esi_applicable
                ) {
                    $newDeductions = array_values((array) ($activeStructure->deductions ?? []));
                    if (!$wantPf) {
                        $newDeductions = array_values(array_filter(
                            $newDeductions,
                            fn($d) => strtolower((string) (((array) $d)['code'] ?? '')) !== 'pf'
                        ));
                    }

                    $effective = now()->toDateString();
                    $prevFrom  = $activeStructure->effective_from
                        ? $activeStructure->effective_from->toDateString()
                        : null;
                    if ($prevFrom && $prevFrom > $effective) {
                        $effective = $prevFrom;
                    }

                    $changes = [];
                    if ($wantPf !== (bool) $activeStructure->pf_applicable) {
                        $changes[] = 'PF ' . ($wantPf ? 'enabled' : 'disabled');
                    }
                    if ($wantEsi !== (bool) $activeStructure->esi_applicable) {
                        $changes[] = 'ESI ' . ($wantEsi ? 'enabled' : 'disabled');
                    }

                    $nextVersion = (int) \App\Models\SalaryStructure::where('employee_id', $row->id)
                        ->max('version') + 1;

                    $activeStructure->update(['status' => 'superseded']);

                    \App\Models\SalaryStructure::create([
                        'client_id'       => $activeStructure->client_id,
                        'branch_id'       => $activeStructure->branch_id,
                        'employee_id'     => $row->id,
                        'version'         => $nextVersion,
                        'effective_from'  => $effective,
                        'status'          => 'active',
                        'earnings'        => array_values((array) ($activeStructure->earnings ?? [])),
                        'deductions'      => $newDeductions,
                        'monthly_gross'   => $activeStructure->monthly_gross,
                        'monthly_ctc'     => $activeStructure->monthly_ctc,
                        'pf_applicable'   => $wantPf,
                        'esi_applicable'  => $wantEsi,
                        'pt_applicable'   => (bool) $activeStructure->pt_applicable,
                        'approval_status' => 'approved',
                        'approved_by'     => $authId,
                        'approved_at'     => now(),
                        'revision_note'   => 'Employee form: ' . implode(', ', $changes),
                        'created_by'      => $authId,
                    ]);
                }
            }

            $openFrom = \App\Models\Payslip::where('employee_id', $row->id)
                ->whereHas('run', fn($q) => $q->whereIn('status', ['draft', 'generated'])
                    ->whereHas('period', fn($p) => $p->where('status', '!=', 'locked')))
                ->with('run.period')
                ->get()
                ->map(fn($s) => $s->run?->period?->period_start)
                ->filter()
                ->min();

            $openingVersionId = $openFrom
                ? \App\Models\SalaryStructure::where('employee_id', $row->id)
                ->whereIn('status', ['active', 'superseded'])
                ->whereDate('effective_from', '<=', $openFrom)
                ->orderByDesc('effective_from')
                ->orderByDesc('version')
                ->value('id')
                : null;

            $structures = \App\Models\SalaryStructure::where('employee_id', $row->id)
                ->whereIn('status', ['active', 'superseded'])
                ->where(function ($q) use ($openFrom, $openingVersionId) {
                    $q->where('status', 'active');
                    if ($openFrom) {
                        $q->orWhereDate('effective_from', '>=', $openFrom);
                    }
                    if ($openingVersionId) {
                        $q->orWhere('id', $openingVersionId);
                    }
                })
                ->get();

            foreach ($structures as $structure) {
                $patch = [];
                if (array_key_exists('pf_eligible', $data)) {
                    $pfOn = (bool) $row->pf_eligible;
                    $patch['pf_applicable'] = $pfOn;

                    if (!$pfOn) {
                        $deductions = (array) ($structure->deductions ?? []);
                        $kept = array_values(array_filter(
                            $deductions,
                            fn($d) => strtolower((string) ($d['code'] ?? '')) !== 'pf'
                        ));
                        if (count($kept) !== count($deductions)) {
                            $patch['deductions'] = $kept;
                        }
                    }
                }
                if (array_key_exists('esi_applicable', $data)) {
                    $patch['esi_applicable'] = strtolower((string) $row->esi_applicable) === 'yes';
                }
                if ($patch) {
                    $structure->update($patch);
                }
            }
        }

        $payrollFields = [
            'annual_salary',
            'enable_payroll',
            'pf_eligible',
            'pf_type',
            'esi_applicable',
            'gender',
            'state_id',
            'date_of_joining',
            'status',
            'bank_account_number',
            'ifsc_code',
            'salary_payment_mode'
        ];
        $frozenCycles = collect();
        if (!empty(array_intersect($payrollFields, array_keys($data)))) {
            try {
                app(\App\Services\PayrollService::class)->recomputeEmployeePayslips(
                    (int) $row->id,
                    $openFrom ?? $this->openPayslipWindowStart((int) $row->id),
                );

                $frozenCycles = \App\Models\Payslip::where('employee_id', $row->id)
                    ->whereHas('run', fn($q) => $q->whereNotIn('status', ['draft', 'generated']))
                    ->with('run.period')
                    ->get()
                    ->map(fn($s) => $s->run?->period?->label)
                    ->filter()
                    ->unique()
                    ->values();
            } catch (\Throwable $e) {
                \Log::warning('Payslip recompute after employee update failed', [
                    'employee_id' => $row->id,
                    'error'       => $e->getMessage(),
                ]);
            }
        }

        if (
            $oldStep < 4
            && $newStep >= 4
            && Settings::shouldSendMail('newUser')
            && $row->user
            && !$row->user->last_login_at
            && !$row->user->password_changed_at
        ) {
            try {
                $rawPassword = $this->generatePassword();

                $row->user->forceFill([
                    'password' => Hash::make($rawPassword),
                    'password_encrypted' => Crypt::encryptString($rawPassword),
                ])->save();

                SendWelcomeCredentials::dispatch(
                    (int) $row->user->id,
                    'employee',
                    PasswordChangedMail::resolveLoginUrl($request),
                )->afterCommit();
            } catch (\Throwable $e) {
                Log::warning('Employee welcome mail (Step 4) failed', [
                    'employee_id' => $row->id,
                    'email' => $row->user->email ?? null,
                    'new_step' => $newStep,
                    'error' => $e->getMessage(),
                ]);
            }
        }
        $shiftNote = '';
        if (
            array_key_exists('shift', $data) && $shiftChangedFrom !== null
            && strcasecmp((string) $shiftChangedFrom, (string) ($row->shift ?? '')) !== 0
        ) {
            $todayIso  = \Carbon\Carbon::now(\App\Models\Attendance::WORK_TZ)->toDateString();
            $workedToday = \App\Models\Attendance::where('employee_id', $row->id)
                ->whereDate('attendance_date', $todayIso)
                ->whereHas('punches')
                ->exists();
            if ($workedToday) {
                $shiftNote = ' — the new shift starts tomorrow: today is already under way on "'
                    . ($shiftChangedFrom ?: 'the previous shift')
                    . '", and the day an employee has already punched into keeps the shift they started on.';
            }
        }

        return response()->json([
            'message'  => 'Updated' . $shiftNote
                . ($frozenCycles->isNotEmpty()
                    ? ' — note: already-approved payroll (' . $frozenCycles->implode(', ')
                    . ') keeps its original figures, so this change will not appear there.'
                    . ' Run a fresh cycle, or post an adjustment, to apply it.'
                    : ''),
            'employee' => (clone $row)->setRelations([])->setAppends([]),
        ]);
    }

    public function destroy(Request $request, $id)
    {
        $this->authorize($request, 'can_delete');
        $row = $this->resolveRow($request, (int) $id);
        $this->guardHierarchicalAction($request->user(), $row, 'delete');

        DB::transaction(function () use ($row) {
            $row->user?->update(['status' => 'inactive']);
            $row->user?->tokens()->delete();
            $row->delete();
        });

        return response()->json(['message' => 'Employee removed and login disabled.']);
    }

    private function completedExitFor(Employee $employee): ?\App\Models\EmployeeExit
    {
        return \App\Models\EmployeeExit::where('employee_id', $employee->id)
            ->whereNull('rehired_at')
            ->where(fn($q) => $q->whereNotNull('completed_at')->orWhere('exit_case_status', 'Closed'))
            ->first();
    }

    private function assertExitNotInitiated(Employee $employee): void
    {
        $exit = \App\Support\ExitInProgress::initiatedFor((int) $employee->id);
        if (!$exit) {
            return;
        }

        $lwd = $exit->last_working_day
            ? ' (last working day ' . \Illuminate\Support\Carbon::parse($exit->last_working_day)->format('d M Y') . ')'
            : '';

        abort(422, "This employee's exit has been initiated{$lwd}, so their profile is locked. "
            . 'Changes here would alter the notice period, salary and reporting line the exit case '
            . 'is being settled on. Edit the case in HR > Exit Management, or cancel the exit there first.');
    }

    private function assertNotExited(Employee $employee, string $action): void
    {
        if (!$this->completedExitFor($employee)) {
            return;
        }
        abort(422, "This employee has exited, so they cannot be {$action}d from here. "
            . 'Bring them back with Reactivate in HR > Exit Management > Exited Employees, '
            . 'which checks whether they are eligible to return.');
    }

    public function restore(Request $request, $id)
    {
        $this->authorize($request, 'can_edit');
        $row = $this->resolveRow($request, (int) $id);
        $this->assertNotExited($row, 're-enable');

        DB::transaction(function () use ($row) {
            if ($row->trashed()) {
                $row->restore();
            }
            if (strtolower((string) $row->status) !== 'active') {
                $row->update(['status' => 'Active']);
            }
            $row->user?->update(['status' => 'active']);
        });

        $row->load(self::fullWith());
        return response()->json([
            'message'  => 'Employee re-enabled.',
            'employee' => $row,
        ]);
    }

    public function forceDestroy(Request $request, $id)
    {
        $this->authorize($request, 'can_delete');
        $row = $this->resolveRow($request, (int) $id);
        $this->guardHierarchicalAction($request->user(), $row, 'delete');

        $status = strtolower((string) $row->status);
        $isDisabled = $row->trashed()
            || in_array($status, ['inactive', 'terminated', 'resigned'], true);
        if (!$isDisabled) {
            return response()->json([
                'message' => 'This employee is still active. Disable them first, then delete.',
            ], 422);
        }

        $displayName = $row->display_name ?: trim(($row->first_name ?? '') . ' ' . ($row->last_name ?? ''));

        DB::transaction(function () use ($row) {
            $row->user?->update(['status' => 'inactive']);
            $row->user?->tokens()->delete();
            $row->forceDelete();
        });

        return response()->json([
            'message' => "Permanently removed {$displayName}.",
        ]);
    }

    private function authorizeViewOrSelf(Request $request, int $employeeId): void
    {
        $user = $request->user();
        if ($user && $employeeId > 0) {
            $ownId = $user->employee_id;
            if ($ownId && (int) $ownId === $employeeId) return;
        }
        $this->authorize($request, 'can_view');
    }

    private function authorize(Request $request, string $perm): void
    {
        $user = $request->user();
        if (!$user) abort(401, 'Authentication required');
        if ($user->isSuperAdmin()) return;

        $moduleId = Module::where('slug', 'hr.employee')->value('id');
        if (!$moduleId) {
            if (in_array($user->user_type, ['client_admin', 'branch_user'], true)) return;
            abort(403, 'Employees module not enabled.');
        }

        $allowed = Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where($perm, true)
            ->exists();
        if (!$allowed) abort(403, $this->permissionDeniedMessage($perm, $user->id, $moduleId));
    }

    private function permissionDeniedMessage(string $perm, int $userId, int $moduleId): string
    {
        if ($perm === 'can_view') {
            return 'You do not have access to the Employee module. Ask your administrator if you need it.';
        }

        $canView = Permission::where('user_id', $userId)
            ->where('module_id', $moduleId)
            ->where('can_view', true)
            ->exists();

        $action = match ($perm) {
            'can_add'    => 'add employees',
            'can_delete' => 'delete employees',
            'can_export' => 'export employees',
            'can_import' => 'import employees',
            default      => 'edit this form',
        };

        return $canView
            ? "You have view-only access to the Employee module — you cannot {$action}."
            : "You do not have permission to {$action}. Ask your administrator for access.";
    }

    private function resolveOwnership(Request $request): array
    {
        $user = $request->user();
        if ($user && $user->user_type === 'super_admin') {
            return [$request->input('client_id'), $request->input('branch_id')];
        }
        if ($user && in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            return [$user->client_id, null];
        }
        if ($user && $user->user_type === 'branch_user') {
            return [$user->client_id, $user->branch_id];
        }
        if ($user && $user->user_type === 'employee') {
            return [$user->client_id, $user->branch_id];
        }
        return [null, null];
    }

    private function applyScope($q, $user, ?int $branchFilter = null): void
    {
        if (!$user) return;
        if ($user->user_type === 'super_admin') {
            if ($branchFilter !== null) $q->where('branch_id', $branchFilter);
            return;
        }

        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            $q->where(function ($w) use ($user) {
                $w->whereNull('client_id')->orWhere('client_id', $user->client_id);
            });
            $this->applySwitcherBranchFilter($q, $user, $branchFilter);
            return;
        }

        if (in_array($user->user_type, ['branch_user', 'employee'], true)) {
            $clientId = $user->client_id;
            $branchId = $user->branch_id;

            $q->where(function ($w) use ($clientId, $branchId) {
                $w->whereNull('client_id')
                    ->orWhere(function ($ww) use ($clientId, $branchId) {
                        $ww->where('client_id', $clientId)->where('branch_id', $branchId);
                    });
            });
            return;
        }

        $q->whereRaw('1 = 0');
    }

    private function applySwitcherBranchFilter($q, $user, ?int $branchFilter): void
    {
        if ($branchFilter === null) return;
        $belongsToClient = Branch::where('id', $branchFilter)
            ->where('client_id', $user->client_id)
            ->exists();
        if (!$belongsToClient) return;
        $q->where('branch_id', $branchFilter);
    }

    private function openPayslipWindowStart(int $employeeId)
    {
        return \App\Models\Payslip::where('employee_id', $employeeId)
            ->whereHas('run', fn ($q) => $q->whereIn('status', ['draft', 'generated'])
                ->whereHas('period', fn ($p) => $p->where('status', '!=', 'locked')))
            ->with('run.period')
            ->get()
            ->map(fn ($s) => $s->run?->period?->period_start)
            ->filter()
            ->min();
    }

    public function updateStep(Request $request, $id)
    {
        $this->authorize($request, 'can_edit');

        $q = Employee::query()->withTrashed()->select(array_merge(
            ['id', 'client_id', 'branch_id', 'wizard_step_completed', 'onboarding_stage_completed'],
            self::STEP_SAFE_FIELDS,
        ));
        $this->applyScope($q, $request->user());
        $row = $q->findOrFail($this->resolveIdParam($id));

        if ($row->isDisabled()) {
            return response()->json([
                'message' => 'This employee is disabled. Re-enable them before editing.',
            ], 422);
        }

        $data = $this->validatePayload($request, $row->id);

        $step  = array_key_exists('wizard_step_completed', $data) ? (int) $data['wizard_step_completed'] : null;
        $macro = array_key_exists('onboarding_stage_completed', $data) ? (int) $data['onboarding_stage_completed'] : null;

        $fields = array_diff_key($data, array_flip([
            'wizard_step_completed', 'onboarding_stage_completed',
        ]));

        $unsafe = array_values(array_diff(array_keys($fields), self::STEP_SAFE_FIELDS));
        if ($unsafe) {
            return response()->json([
                'message'  => 'These fields need the full save.',
                'fields'   => $unsafe,
                'fallback' => true,
            ], 422);
        }

        $patch = [];
        foreach ($fields as $col => $val) {
            if ($row->{$col} != $val) $patch[$col] = $val;
        }

        if ($step !== null && $step > (int) ($row->wizard_step_completed ?? 0)) {
            $patch['wizard_step_completed'] = $step;
        }
        if ($macro !== null && $macro > (int) ($row->onboarding_stage_completed ?? 0)) {
            $patch['onboarding_stage_completed'] = $macro;
        }

        if ($patch) {
            $row->forceFill($patch)->save();
        }

        return response()->json([
            'message' => 'Saved.',
            'data'    => [
                'id'                         => (int) $row->id,
                'wizard_step_completed'      => (int) ($row->wizard_step_completed ?? 0),
                'onboarding_stage_completed' => (int) ($row->onboarding_stage_completed ?? 0),
                'changed'                    => array_keys($patch),
            ],
        ]);
    }
    public function updateOnboardingProgress(Request $request, $id)
    {
        $this->authorize($request, 'can_edit');

        $data = $request->validate([
            'wizard_step_completed'      => ['sometimes', 'integer', 'min:0', 'max:10'],
            'onboarding_stage_completed' => ['sometimes', 'integer', 'min:0', 'max:10'],
        ]);

        $q = Employee::query()->withTrashed()->select([
            'id', 'client_id', 'branch_id',
            'wizard_step_completed', 'onboarding_stage_completed',
        ]);
        $this->applyScope($q, $request->user());
        $row = $q->findOrFail($this->resolveIdParam($id));

        $patch = [];
        foreach (['wizard_step_completed', 'onboarding_stage_completed'] as $col) {
            if (!array_key_exists($col, $data)) continue;
            $want = (int) $data[$col];
            if ($want > (int) ($row->{$col} ?? 0)) $patch[$col] = $want;
        }

        if ($patch) {
            $row->forceFill($patch)->save();
        }

        return response()->json([
            'message' => 'Progress saved.',
            'data'    => [
                'wizard_step_completed'      => (int) ($row->wizard_step_completed ?? 0),
                'onboarding_stage_completed' => (int) ($row->onboarding_stage_completed ?? 0),
            ],
        ]);
    }

    private function resolveRow(Request $request, int $id): Employee
    {
        $q = Employee::query()->withTrashed()->with(self::fullWith());
        $this->applyScope($q, $request->user());
        return $q->findOrFail($id);
    }

    private function passwordStatusFor(Employee $employee): array
    {
        if (!$employee->user_id) {
            return ['state' => 'no_login', 'change_count' => 0, 'changed_at' => null, 'never_logged_in' => true];
        }

        $u = DB::table('users')
            ->where('id', $employee->user_id)
            ->first(['password_change_count', 'password_changed_at', 'must_reset_password', 'last_login_at']);

        if (!$u) {
            return ['state' => 'no_login', 'change_count' => 0, 'changed_at' => null, 'never_logged_in' => true];
        }

        $count = (int) ($u->password_change_count ?? 0);

        $state = match (true) {
            (bool) ($u->must_reset_password ?? false) => 'reset_required',
            $count === 0                              => 'never_changed',
            default                                   => 'changed',
        };

        return [
            'state'        => $state,
            'change_count' => $count,
            'changed_at'   => $u->password_changed_at
                ? Carbon::parse($u->password_changed_at)->toIso8601String()
                : null,
            'never_logged_in' => $u->last_login_at === null,
        ];
    }

    public function setPassword(Request $request, $id)
    {
        $this->authorize($request, 'can_edit');

        if (PositionHierarchy::rankForUserType($request->user()?->user_type) === null) {
            abort(403, 'Only a Branch User or tenant admin can reset an employee\'s login password.');
        }

        $employee = $this->resolveRow($request, $this->resolveIdParam($id));
        $this->guardHierarchicalAction($request->user(), $employee, 'reset the password for');

        $target = $employee->user_id ? User::find($employee->user_id) : null;
        if (!$target) {
            abort(422, 'This employee has no linked login account, so there is no password to reset.');
        }

        if ($target->id === $request->user()->id) {
            abort(422, 'Use the regular Change Password option to update your own password.');
        }

        $data = $request->validate([
            'password' => 'required|string|min:8|confirmed',
        ]);

        if ($this->isPasswordReused($target, $data['password'])) {
            return response()->json(['message' => $this->passwordReuseMessage()], 422);
        }

        $this->recordPasswordHistory($target);
        $target->update([
            'password'            => Hash::make($data['password']),
            'must_reset_password' => false,
        ]);

        if (Settings::shouldSendMail() && $target->email) {
            try {
                Mail::to($target->email)->send(new PasswordChangedMail(
                    $target->name,
                    $target->email,
                    $data['password'],
                    PasswordChangedMail::resolveLoginUrl($request),
                    \App\Support\BrandingResolver::forUser($target),
                ));
            } catch (\Throwable $e) {
                Log::warning('Password-changed confirmation mail failed (admin reset)', [
                    'target_user_id' => $target->id,
                    'email'          => $target->email,
                    'error'          => $e->getMessage(),
                ]);
            }
        }

        return response()->json(['message' => 'Password updated for ' . ($employee->display_name ?: $target->name) . '.']);
    }

    private function assertBranchUserCap(?int $branchId): void
    {
        if (!$branchId) return;
        $branch = Branch::find($branchId);
        if (!$branch) return;

        $cap = (int) ($branch->max_users ?? 0);
        if ($cap <= 0) return;

        $current = User::where('branch_id', $branchId)
            ->where(function ($q) {
                $q->whereNull('status')->orWhere('status', '!=', 'inactive');
            })
            ->count();
        if ($current >= $cap) {
            throw ValidationException::withMessages([
                'email' => [
                    "This branch is configured for at most {$cap} user"
                        . ($cap === 1 ? '' : 's')
                        . " and is already at the cap ({$current})."
                        . ' Raise the limit on the branch first, or remove an existing user.',
                ],
            ]);
        }
    }

    private function guardHierarchicalAction($user, Employee $row, string $verb): void
    {
        if (!$user || $user->user_type === 'super_admin' || !$row->created_by) return;
        if ($row->created_by === $user->id) return;

        $rank = fn(?string $t) => match ($t) {
            'super_admin'  => 4,
            'client_admin' => 3,
            'client_user'  => 3,
            'branch_user'  => 2,
            'employee'     => 1,
            default        => 0,
        };
        $creator = User::find($row->created_by);
        if ($creator && $rank($creator->user_type) > $rank($user->user_type)) {
            abort(403, "You cannot {$verb} this employee — created by a higher-privileged user.");
        }
    }

    private function assertSingleHodPerDepartment(array $data, ?int $clientId, ?int $branchId, ?int $excludeEmployeeId, $existing = null): void
    {
        $designationId = $data['designation_id'] ?? ($existing->designation_id ?? null);
        $departmentId  = $data['department_id']  ?? ($existing->department_id  ?? null);
        $branchScope   = $data['branch_id']      ?? $branchId ?? ($existing->branch_id ?? null);
        if (!$designationId || !$departmentId) {
            return;
        }

        $hodName = \App\Support\SalesVisibility::DESIGNATION_MANAGER;
        $chosen = \App\Models\Masters\Designations::find($designationId);
        $isHod = $chosen && (
            strcasecmp((string) $chosen->name,  $hodName) === 0 ||
            strcasecmp((string) $chosen->level, $hodName) === 0
        );
        if (!$isHod) {
            return;
        }

        $hodIds = \App\Models\Masters\Designations::query()
            ->where(function ($q) use ($hodName) {
                $q->whereRaw('LOWER(name) = ?',  [strtolower($hodName)])
                    ->orWhereRaw('LOWER(level) = ?', [strtolower($hodName)]);
            })
            ->pluck('id')
            ->all();

        $dupe = \App\Models\Employee::query()
            ->where('client_id', $clientId)
            ->where('department_id', $departmentId)
            ->when($branchScope, fn($q) => $q->where('branch_id', $branchScope))
            ->whereIn('designation_id', $hodIds)
            ->when($excludeEmployeeId, fn($q) => $q->where('id', '!=', $excludeEmployeeId))
            ->exists();

        if ($dupe) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'designation_id' => ['This department already has a Head of Department (HOD). Only one HOD is allowed per department.'],
            ]);
        }
    }

    private function assertReportingManagerEligible(array $data, ?int $employeeId = null, $existing = null): void
    {
        $mgrEmpId  = $data['reporting_manager_id']      ?? null;
        $mgrUserId = $data['reporting_manager_user_id'] ?? null;

        if ($employeeId && $mgrEmpId && (int) $mgrEmpId === (int) $employeeId) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'reporting_manager_id' => ['An employee cannot be their own reporting manager.'],
            ]);
        }
        if (!$mgrEmpId && !$mgrUserId) return;

        $designationId = $data['designation_id'] ?? ($existing->designation_id ?? null);
        $hireName = $designationId
            ? \App\Models\Masters\Designations::where('id', $designationId)->value('name')
            : null;
        $hireRank = \App\Support\PositionHierarchy::rankForDesignationName($hireName);

        $mgrRank = null;
        if ($mgrEmpId) {
            $mgrDesigId = \App\Models\Employee::where('id', $mgrEmpId)->value('designation_id');
            $mgrName = $mgrDesigId
                ? \App\Models\Masters\Designations::where('id', $mgrDesigId)->value('name')
                : null;
            $mgrRank = \App\Support\PositionHierarchy::rankForDesignationName($mgrName);
        } elseif ($mgrUserId) {
            $ut = \App\Models\User::where('id', $mgrUserId)->value('user_type');
            $mgrRank = \App\Support\PositionHierarchy::rankForUserType($ut);
        }

        if (!\App\Support\PositionHierarchy::eligible($hireRank, $mgrRank)) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'reporting_manager_id' => ['The selected reporting manager is not eligible for this position — a manager must hold a higher position in the hierarchy.'],
            ]);
        }
    }

    private function applyHodOnboarding(Employee $employee, ?int $actingUserId): void
    {
        $designationId = $employee->designation_id;
        $departmentId  = $employee->department_id;
        if (!$designationId || !$departmentId || !$employee->user_id) {
            return;
        }
        if (!in_array((int) $designationId, \App\Support\DepartmentPermissionSync::hodDesignationIds(), true)) {
            return;
        }

        $branchUserIds = User::where('client_id', $employee->client_id)
            ->where('user_type', 'branch_user')
            ->pluck('id')->all();

        Employee::query()
            ->where('client_id', $employee->client_id)
            ->where('branch_id', $employee->branch_id)
            ->where('department_id', $departmentId)
            ->where('id', '!=', $employee->id)
            ->where(function ($q) use ($branchUserIds) {
                $q->whereIn('reporting_manager_user_id', $branchUserIds ?: [0])
                    ->orWhere(function ($qq) {
                        $qq->whereNull('reporting_manager_id')
                            ->whereNull('reporting_manager_user_id');
                    });
            })
            ->update([
                'reporting_manager_id'      => $employee->id,
                'reporting_manager_user_id' => null,
            ]);

        $hodUser = User::find($employee->user_id);
        if ($hodUser) {
            \App\Support\DepartmentPermissionSync::applyToHodUser($hodUser, (int) $departmentId, $actingUserId);
        }
    }

    private function validatePayload(Request $request, ?int $employeeId = null): array
    {
        $ignoreUserId = null;
        $isUpdate = $employeeId !== null;
        if ($isUpdate) {
            $ignoreUserId = Employee::withTrashed()->where('id', $employeeId)->value('user_id');
        }

        $this->stripDanglingAssetRefs($request);
        foreach (['email', 'official_email'] as $emailField) {
            if ($request->filled($emailField)) {
                $request->merge([$emailField => mb_strtolower(trim($request->input($emailField)))]);
            }
        }
        if ($request->filled('pan_number')) {
            $request->merge(['pan_number' => mb_strtoupper(trim($request->input('pan_number')))]);
        }
        $scopeClientId = $isUpdate
            ? Employee::withTrashed()->where('id', $employeeId)->value('client_id')
            : $this->resolveOwnership($request)[0];
        $scopeClientId = $scopeClientId === null ? null : (int) $scopeClientId;

        $tenantWhere = fn($q) => $scopeClientId === null
            ? $q->whereNull('client_id')
            : $q->where('client_id', $scopeClientId);

        $panRule = ['nullable', 'string', 'regex:/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/'];
        if ($request->filled('pan_number')) {
            $panRule[] = Rule::unique('employees', 'pan_number')
                ->whereNull('deleted_at')
                ->where($tenantWhere)
                ->ignore($employeeId);
        }

        $emailRule = $isUpdate ? ['nullable', 'email', 'max:191'] : ['required', 'email', 'max:191'];

        $orgEmailRule = new \App\Rules\UniqueSystemEmail('organisation', $scopeClientId);
        $withOrg = fn(array $rules) => array_merge($rules, [$orgEmailRule]);

        $emailRule[] = Rule::unique('users', 'email')
            ->whereNull('deleted_at')
            ->where('email_active', true)
            ->where(fn($q) => $q
                ->whereRaw('LOWER(email) = ?', [mb_strtolower((string) $request->input('email'))]))
            ->ignore($ignoreUserId);

        if (!$isUpdate && $request->filled('email')) {
            $emailRule[] = function (string $attribute, $value, $fail) {
                $user = \App\Models\User::query()
                    ->where('email_active', false)
                    ->whereNull('deleted_at')
                    ->whereRaw('LOWER(email) = ?', [mb_strtolower((string) $value)])
                    ->first();
                if (!$user) {
                    return;
                }

                $employee = Employee::withTrashed()->where('user_id', $user->id)->first();
                if (!$employee) {
                    return;
                }

                $exit = \App\Models\EmployeeExit::where('employee_id', $employee->id)
                    ->orderByDesc('id')
                    ->first();

                $who = trim((string) ($employee->display_name
                    ?: trim(($employee->first_name ?? '') . ' ' . ($employee->last_name ?? ''))));
                $who = $who !== '' ? $who : 'a former employee';
                $code = $employee->emp_code ? ' (' . $employee->emp_code . ')' : '';
                $left = $exit?->last_working_day
                    ? ' on ' . \Carbon\Carbon::parse($exit->last_working_day)->format('j M Y')
                    : '';

                $blocked = \App\Http\Controllers\Api\ExitController::rehireBlockedReason($exit, $employee);

                $blocked = $blocked === null ? null : rtrim(trim($blocked), '.');

                $fail($blocked === null
                    ? "This email belongs to {$who}{$code}, who exited{$left}. Rehire them from Exit Management "
                    . 'instead of creating a new employee — a rehire keeps their history, service and documents. '
                    . 'If this is a different person, use a different email address.'
                    : "This email belongs to {$who}{$code}, who exited{$left} and cannot be rehired — {$blocked}. "
                    . 'The address stays associated with that record, so a new employee needs their own email.');
            };
        }

        $attNumRule = ['nullable', 'string', 'max:50'];
        if ($request->filled('attendance_number')) {
            $attNumClientId = optional($request->user())->client_id;
            $attNumRule[] = Rule::unique('employees', 'attendance_number')
                ->whereNull('deleted_at')
                ->where(fn($q) => $attNumClientId ? $q->where('client_id', $attNumClientId) : $q)
                ->ignore($employeeId);
        }

        $isFinalStep   = (int) $request->input('wizard_step_completed', 0) >= 4;
        $payrollOn     = (bool) $request->input('enable_payroll', true);
        $storedSalary = $employeeId
            ? Employee::withTrashed()->whereKey($employeeId)
            ->first(['annual_salary', 'salary_frequency', 'salary_effective_from'])
            : null;
        $hasStoredSalary = $storedSalary
            && $storedSalary->annual_salary !== null
            && (float) $storedSalary->annual_salary > 0;
        $touchesSalary = $request->exists('annual_salary')
            || $request->exists('salary_frequency')
            || $request->exists('salary_effective_from');
        $requireSalary = $isFinalStep && $payrollOn && ($touchesSalary || !$hasStoredSalary);
        $salaryMax     = 999999999999.99;
        $salaryRule    = $requireSalary
            ? ['required', 'numeric', 'min:0.01', "max:{$salaryMax}"]
            : ['nullable',  'numeric', 'min:0',    "max:{$salaryMax}"];
        $salaryFreqRule = $requireSalary ? ['required', 'string', 'max:30']   : ['nullable', 'string', 'max:30'];
        $joiningForSalary = $request->input('date_of_joining')
            ?: ($employeeId ? Employee::whereKey($employeeId)->value('date_of_joining') : null);
        $joiningForSalary = $joiningForSalary
            ? Carbon::parse($joiningForSalary)->toDateString()
            : null;

        $salaryFromRule = $requireSalary ? ['required', 'date'] : ['nullable', 'date'];
        if ($joiningForSalary) {
            $salaryFromRule[] = 'after_or_equal:' . $joiningForSalary;
        }

        $noTags = ['not_regex:/[<>]/'];

        return $request->validate([
            'first_name'   => $isUpdate ? 'nullable|string|max:100' : 'required|string|max:100',
            'middle_name'  => 'nullable|string|max:100',
            'last_name'    => 'nullable|string|max:100',

            'gender'       => 'nullable|in:Male,Female,Other,Prefer not to say',
            'date_of_birth' => 'nullable|date',
            'blood_group'   => 'nullable|string|max:10',
            'nationality_country_id' => 'nullable|integer',
            'work_country_id'        => 'nullable|integer',
            'email'        => $withOrg($emailRule),
            'official_email' => $withOrg(['nullable', 'email', 'max:191']),
            'mobile'       => ['nullable', 'string', 'max:15', 'regex:/^[+0-9\s\-()]{6,15}$/'],
            'alt_mobile'   => ['nullable', 'string', 'max:15', 'regex:/^[+0-9\s\-()]{6,15}$/'],

            'country_id'   => 'nullable|integer',
            'state_id'     => 'nullable|integer',
            'city'         => array_merge(['nullable', 'string', 'max:100'], $noTags),
            'address_line1' => array_merge(['nullable', 'string', 'max:255'], $noTags),
            'address_line2' => array_merge(['nullable', 'string', 'max:255'], $noTags),
            'pincode'      => 'nullable|string|max:20',

            'perm_country_id'   => 'nullable|integer',
            'perm_state_id'     => 'nullable|integer',
            'perm_city'         => array_merge(['nullable', 'string', 'max:100'], $noTags),
            'perm_address_line1' => array_merge(['nullable', 'string', 'max:255'], $noTags),
            'perm_address_line2' => array_merge(['nullable', 'string', 'max:255'], $noTags),
            'perm_pincode'      => 'nullable|string|max:20',

            'legal_entity_id' => [
                'nullable',
                'integer',
                Rule::exists('branches', 'id')->where(function ($q) use ($request) {
                    [$ownerClientId] = $this->resolveOwnership($request);
                    if ($ownerClientId !== null) {
                        $q->where('client_id', $ownerClientId);
                    }
                    $q->whereNull('deleted_at');
                }),
            ],
            'location'        => array_merge(['nullable', 'string', 'max:191'], $noTags),
            'department_id'   => 'nullable|integer',
            'designation_id'  => 'nullable|integer',
            'primary_role_id' => 'nullable|integer',
            'ancillary_role_id'    => 'nullable|integer',
            'ancillary_role_ids'   => 'nullable|array',
            'ancillary_role_ids.*' => 'integer',
            'work_type' => 'nullable|string|max:50',
            'employee_type' => 'nullable|string|in:Full-time,Part-time,Contract,Intern,Consultant',
            'reporting_manager_id'      => 'nullable|integer',
            'reporting_manager_user_id' => 'nullable|integer',
            'has_prior_experience'      => 'nullable|boolean',
            'date_of_joining' => 'nullable|date|after_or_equal:' . $this->joiningFloorFor($employeeId) . '|before_or_equal:' . now()->addYears(2)->toDateString(),

            'probation_policy'   => 'nullable|string|max:50',
            'probation_months'   => 'nullable|integer|min:0|max:60',
            'probation_end_date' => 'nullable|date',
            'notice_period'      => 'nullable|string|max:50',
            'notice_period_days' => 'nullable|integer|min:0|max:365',

            'leave_plan'           => 'nullable|string|max:100',
            'holiday_list'         => 'nullable|string|max:100',
            'holiday_group_id'     => 'nullable|integer',
            'attendance_tracking'  => 'nullable|boolean',
            'shift'                => 'nullable|string|max:50',
            'weekly_off'           => 'nullable|string|max:100',
            'attendance_number'    => $attNumRule,
            'time_tracking'        => 'nullable|string|max:50',
            'penalization_policy'  => 'nullable|string|max:100',
            'overtime'             => 'nullable|string|max:100',
            'expense_policy'       => 'nullable|string|max:100',
            'laptop_assigned'      => 'nullable|string|max:20',
            'mobile_assigned'      => 'nullable|string|max:20',
            'laptop_asset_id'      => 'nullable|string|max:50',
            'mobile_device'        => 'nullable|string|max:100',
            'other_assets'         => 'nullable|string|max:255',

            'enable_payroll'        => 'nullable|boolean',
            'pay_group'             => 'nullable|string|max:100',
            'annual_salary'         => $salaryRule,
            'salary_frequency'      => $salaryFreqRule,
            'salary_effective_from' => $salaryFromRule,
            'salary_structure'      => 'nullable|string|max:50',
            'tax_regime'            => 'nullable|string|max:50',
            'bonus_in_annual'       => 'nullable|boolean',
            'pf_eligible'           => 'nullable|boolean',
            'detailed_breakup'      => 'nullable|boolean',

            'salary_payment_mode'   => 'nullable|in:bank,cheque,cash',
            'bank_name'             => ['required_if:salary_payment_mode,bank', 'nullable', 'string', 'max:150'],
            'bank_account_number'   => ['required_if:salary_payment_mode,bank', 'nullable', 'string', 'regex:/^\d{8,18}$/'],
            'ifsc_code'             => ['required_if:salary_payment_mode,bank', 'nullable', 'string', 'regex:/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/'],
            'account_holder_name'   => ['required_if:salary_payment_mode,bank', 'nullable', 'string', 'max:150'],
            'bank_branch'           => ['required_if:salary_payment_mode,bank', 'nullable', 'string', 'max:150', 'regex:/^(?=.*[A-Za-z])[A-Za-z0-9 .,\-\/()&\']+$/'],
            'bank_account_type'     => 'nullable|string|max:30',
            'uan_number'            => 'nullable|string|regex:/^\d{12}$/',
            'pan_number'            => $panRule,
            'pf_deduction'          => 'nullable|string|max:50',
            'pf_type'               => 'nullable|in:statutory,standard',
            'esi_applicable'        => 'nullable|in:Yes,No',
            'gratuity_nominee_name' => 'nullable|string|max:150',
            'agreed_ctc_lpa'        => 'nullable|numeric|min:0',
            'stage4_completed_at'   => 'nullable|date',

            'assets'  => 'nullable|array',
            'assets.*' => 'integer',

            'laptop_master_asset_id'   => 'nullable|integer|exists:master_assets,id',
            'mobile_master_asset_id'   => 'nullable|integer|exists:master_assets,id',
            'other_master_asset_ids'   => 'nullable|array',
            'other_master_asset_ids.*' => 'integer|exists:master_assets,id',

            'biometric_status'    => 'nullable|in:Not Registered,Registered,Pending,Failed',
            'desk_workstation_no' => 'nullable|string|max:50',
            'id_card_status'      => 'nullable|in:Not Printed,Printed,Issued,Lost,Reissued',
            'status'  => 'nullable|in:Active,Inactive,On Leave,Probation,Notice Period,Resigned,Terminated',
            'onboarding_stage_completed' => 'nullable|integer|min:0|max:6',
        ], [
            'annual_salary.required' => 'Annual CTC is required.',
            'annual_salary.numeric'  => 'Annual CTC must be a valid number.',
            'bank_name.required_if'           => 'Bank Name is required when the salary is paid by bank transfer.',
            'bank_account_number.required_if' => 'Account Number is required when the salary is paid by bank transfer.',
            'ifsc_code.required_if'           => 'IFSC Code is required when the salary is paid by bank transfer.',
            'account_holder_name.required_if' => 'Name on the Account is required when the salary is paid by bank transfer.',
            'bank_branch.required_if'         => 'Branch is required when the salary is paid by bank transfer.',
            'annual_salary.min'      => 'Annual CTC must be greater than 0.',
            'annual_salary.max'      => 'Annual CTC must be ≤ 999,999,999,999.99.',
            'city.not_regex'               => 'City cannot contain < or > characters.',
            'address_line1.not_regex'      => 'Address cannot contain < or > characters.',
            'address_line2.not_regex'      => 'Address cannot contain < or > characters.',
            'perm_city.not_regex'          => 'City cannot contain < or > characters.',
            'perm_address_line1.not_regex' => 'Address cannot contain < or > characters.',
            'perm_address_line2.not_regex' => 'Address cannot contain < or > characters.',
            'location.not_regex'           => 'Location cannot contain < or > characters.',
            'bank_branch.regex'            => 'Branch can contain letters, numbers, spaces and . , - / ( ) & only.',
            'bank_account_number.regex'    => 'Account Number must be 8 to 18 digits, with no spaces or symbols.',
            'email.unique'                 => 'This email address is already in use in the system. Each address can be used only once, by one person, in one organization — use a different email.',
        ]);
    }

    private function stripDanglingAssetRefs(Request $request): void
    {
        $candidates = collect();
        foreach (['laptop_master_asset_id', 'mobile_master_asset_id'] as $f) {
            $v = $request->input($f);
            if ($v !== null && $v !== '' && is_numeric($v)) $candidates->push((int) $v);
        }
        $others = (array) $request->input('other_master_asset_ids', []);
        foreach ($others as $v) {
            if (is_numeric($v)) $candidates->push((int) $v);
        }
        if ($candidates->isEmpty()) return;

        $existing = \App\Models\Masters\Assets::query()
            ->whereIn('id', $candidates->unique()->all())
            ->pluck('id')
            ->map(fn($x) => (int) $x)
            ->flip();

        $merge = [];
        foreach (['laptop_master_asset_id', 'mobile_master_asset_id'] as $f) {
            $v = $request->input($f);
            if ($v !== null && $v !== '' && is_numeric($v) && !$existing->has((int) $v)) {
                $merge[$f] = null;
            }
        }
        if (!empty($others)) {
            $cleaned = array_values(array_filter(
                array_map(fn($v) => is_numeric($v) ? (int) $v : null, $others),
                fn($v) => $v !== null && $existing->has($v),
            ));
            $merge['other_master_asset_ids'] = $cleaned;
        }
        if (!empty($merge)) {
            $request->merge($merge);
        }
    }

    private function syncNoticePeriodDays(array $data): array
    {
        if (!array_key_exists('notice_period', $data)) return $data;
        if (array_key_exists('notice_period_days', $data) && $data['notice_period_days'] !== null) return $data;

        $label = (string) ($data['notice_period'] ?? '');
        if ($label !== '' && preg_match('/no\s*notice/i', $label)) {
            $data['notice_period_days'] = 0;
            return $data;
        }
        if (preg_match('/(\d+)/', $label, $m)) {
            $data['notice_period_days'] = min(365, max(0, (int) $m[1]));
        }
        return $data;
    }

    private function mirrorAncillaryRoles(array $data): array
    {
        if (array_key_exists('ancillary_role_ids', $data)) {
            $ids = array_values(array_filter((array) $data['ancillary_role_ids'], fn($v) => $v !== null && $v !== ''));
            $ids = array_map('intval', $ids);
            $data['ancillary_role_ids'] = $ids;
            $data['ancillary_role_id']  = $ids[0] ?? null;
        } elseif (array_key_exists('ancillary_role_id', $data) && $data['ancillary_role_id']) {
            $data['ancillary_role_ids'] = [(int) $data['ancillary_role_id']];
        }
        return $data;
    }

    private function guardDuplicate(array $data, $clientId, ?int $excludeId): void
    {
        $mobile = trim((string) ($data['mobile'] ?? ''));

        $tenantScope = function ($q) use ($clientId, $excludeId) {
            $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
            if ($excludeId !== null) $q->where('id', '!=', $excludeId);
        };

        if ($mobile !== '') {
            $q = \App\Models\Employee::query()->where('mobile', $mobile);
            $tenantScope($q);
            if ($q->exists()) {
                throw \Illuminate\Validation\ValidationException::withMessages([
                    'mobile' => ['This mobile number is already in use by another employee.'],
                ]);
            }
        }
    }

    private function assertAssetsNotDoubleBooked(
        array $data,
        ?int $employeeId,
        ?int $clientId = null,
    ): void {
        $picked = [];
        if (!empty($data['laptop_master_asset_id'])) {
            $picked[(int) $data['laptop_master_asset_id']] = ['field' => 'laptop_master_asset_id', 'label' => 'Laptop'];
        }
        if (!empty($data['mobile_master_asset_id'])) {
            $picked[(int) $data['mobile_master_asset_id']] = ['field' => 'mobile_master_asset_id', 'label' => 'Mobile'];
        }
        foreach ((array) ($data['other_master_asset_ids'] ?? []) as $aid) {
            $aid = (int) $aid;
            if ($aid && !isset($picked[$aid])) {
                $picked[$aid] = ['field' => 'other_master_asset_ids', 'label' => 'Other asset'];
            }
        }
        if (empty($picked)) return;

        $q = Employee::query()
            ->withTrashed()
            ->where(function ($w) {
                $w->whereNull('status')
                    ->orWhereNotIn('status', ['Resigned', 'Terminated']);
            })
            ->when($clientId, fn($x) => $x->where('client_id', $clientId));
        if ($employeeId) $q->where('id', '!=', $employeeId);
        $rows = $q->select(['id', 'display_name', 'emp_code', 'laptop_master_asset_id', 'mobile_master_asset_id', 'other_master_asset_ids'])->get();

        $errors = [];
        foreach ($rows as $r) {
            $conflict = function (?int $aid) use (&$picked, &$errors, $r) {
                if (!$aid || !isset($picked[$aid])) return;
                $info = $picked[$aid];
                $who  = $r->display_name ?: $r->emp_code ?: ('Employee #' . $r->id);
                $errors[$info['field']][] = "{$info['label']} is already assigned to {$who}.";
                unset($picked[$aid]);
            };
            $conflict((int) $r->laptop_master_asset_id);
            $conflict((int) $r->mobile_master_asset_id);
            foreach ((array) ($r->other_master_asset_ids ?? []) as $aid) {
                $conflict((int) $aid);
            }
        }

        if (!empty($errors)) {
            throw ValidationException::withMessages($errors);
        }
    }

    private function allocateCode($clientId, $branchId): string
    {
        $q = Employee::query()->withTrashed()->lockForUpdate();
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);

        $max = 0;
        foreach ($q->pluck('emp_code') as $code) {
            if (preg_match('/^EMP-(\d+)$/i', (string) $code, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
        }
        return 'EMP-' . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);
    }

    private function notifyEmailChanged(Employee $row, string $oldEmail, string $newEmail, Request $request): void
    {
        $branding = \App\Support\BrandingResolver::forUser($row->user);
        $name     = $row->display_name ?: ($row->user->name ?? 'there');
        $origin   = preg_replace('#/login$#', '', PasswordChangedMail::resolveLoginUrl($request));
        $profile  = $origin . '/profile';
        $branch   = (string) ($row->branch?->name ?: $row->branch?->code ?: '');

        $targets = [
            [$newEmail, EmployeeEmailChangedMail::VARIANT_NEW],
            [$oldEmail, EmployeeEmailChangedMail::VARIANT_OLD],
        ];

        foreach ($targets as [$to, $variant]) {
            if (!filter_var($to, FILTER_VALIDATE_EMAIL)) continue;

            try {
                Mail::to($to)->send(new EmployeeEmailChangedMail(
                    $name, $oldEmail, $newEmail, $variant, $profile, $branding, $branch,
                ));
            } catch (\Throwable $e) {
                Log::warning('Employee email-change notice failed', [
                    'employee_id' => $row->id,
                    'variant'     => $variant,
                    'to'          => $to,
                    'error'       => $e->getMessage(),
                ]);
            }
        }
    }

    private function generatePassword(): string
    {
        $alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
        $digit = '23456789';
        $sym   = '@#$%';
        $pool  = $alpha . $digit . $sym;
        $out   = '';
        for ($i = 0; $i < 12; $i++) {
            $out .= $pool[random_int(0, strlen($pool) - 1)];
        }
        return $out;
    }

    private function syncLeavePlanPivot(Employee $employee, $rawValue, ?int $assignedBy): void
    {
        if ($rawValue === null || $rawValue === '') {
            DB::table('leave_plan_employees')
                ->where('employee_id', $employee->id)
                ->delete();
            return;
        }

        if (!is_numeric($rawValue)) return;
        $planId = (int) $rawValue;
        if ($planId <= 0) return;

        $plan = LeavePlans::find($planId);
        if (!$plan) return;
        if ($plan->client_id !== null && $plan->client_id !== $employee->client_id) return;

        DB::table('leave_plan_employees')->updateOrInsert(
            ['employee_id' => $employee->id],
            [
                'leave_plan_id' => $planId,
                'assigned_at'   => now(),
                'assigned_by'   => $assignedBy,
                'updated_at'    => now(),
                'created_at'    => now(),
            ],
        );
    }

    private function grantSelfServicePermissions(User $user, $clientId, $branchId, $grantedBy): void
    {
        $alwaysOnSlugs = ['dashboard', 'profile'];

        $modules = Module::whereIn('slug', $alwaysOnSlugs)->get();

        foreach ($modules as $m) {
            Permission::firstOrCreate(
                ['user_id' => $user->id, 'module_id' => $m->id],
                [
                    'client_id'   => $clientId,
                    'branch_id'   => $branchId,
                    'role'        => 'employee',
                    'can_view'    => true,
                    'can_add'     => false,
                    'can_edit'    => false,
                    'can_delete'  => false,
                    'can_export'  => false,
                    'can_import'  => false,
                    'can_approve' => false,
                    'granted_by'  => $grantedBy,
                ],
            );
        }
    }
}
