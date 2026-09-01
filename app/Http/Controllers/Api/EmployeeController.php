<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\PasswordChangedMail;
use App\Mail\WelcomeCredentialsMail;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\Holiday;
use App\Models\Masters\LeavePlans;
use App\Models\Module;
use App\Models\Permission;
use App\Models\User;
use App\Support\OnboardingGuard;
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
    /** Page size when a caller opts into pagination without naming one. */
    private const DEFAULT_PER_PAGE = 25;

    /**
     * Ceiling on ?per_page. The HR list sizes its page to the viewport
     * (DataTable's autoFitRows), so the value is whatever fits rather than one
     * of the 10/25/50 the dropdown offers — 200 leaves room for a tall screen
     * while still refusing "give me the whole table", which is the request
     * paginating exists to prevent.
     */
    private const MAX_PER_PAGE = 200;

    /**
     * Relations the employee LIST renders. The full WITH below carries 24, of
     * which the list shows four — the rest (client, branch and its shifts,
     * legal entity, six country/state pairs, assets, exit, previous
     * employments) are loaded, serialised and thrown away on every row.
     */
    private const LIST_WITH = [
        'department:id,name',
        'designation:id,name',
        'primaryRole:id,name',
        'ancillaryRole:id,name',
        // Column-limited on purpose. Left unrestricted this loads a whole
        // Employee per row and re-runs every accessor in $appends for it —
        // a second DB query and a second AES encryption for a cell that shows
        // one name.
        'reportingManager:id,display_name,first_name,last_name',
        'reportingManagerUser:id,name',
        // Backs the photo_url accessor; without it that accessor falls back to
        // a lookup of its own, per row.
        'photoDocument:id,employee_id,document_key,file_path',
    ];

    /**
     * Columns the list needs: the eleven it renders, the foreign keys behind
     * them, and the fields the surviving accessors read.
     *
     * The point of naming them is what is NOT here — bank_account_number,
     * ifsc_code, account_holder_name, pan_number, uan_number, salary, and the
     * permanent address. None of it appears on the screen, and all of it was
     * being sent to every user who can open the employee list.
     */
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
        // Read by the profile_completion accessor (the "Profile %" meter).
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
        // face_registered checks both; face_descriptor is $hidden, so it is read
        // but never serialised.
        'face_registered_at',
        'face_descriptor',
        // Prefill for the Assign Assets dialog, which opens straight off a row.
        'laptop_master_asset_id',
        'mobile_master_asset_id',
        'other_master_asset_ids',
    ];

    /**
     * Appended accessors the list does NOT use. other_assets_resolved runs a
     * query per row to build a list that only the profile's Job tab and Exit
     * Management ever render — both of which fetch their own record.
     */
    private const LIST_DROP_APPENDS = ['other_assets_resolved', 'ancillary_roles_resolved'];


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

    /**
     * Date columns the exit view serves as RAW STRINGS instead of Carbon.
     *
     * A 'date' cast doesn't just format — it builds a Carbon instance per
     * value, then re-serialises it. Across a 326-row page that is ~1,500
     * Carbon objects for the employee dates and the four on each exit row,
     * and it measured as 62% of the whole response time: 852 ms → 320 ms with
     * the casts off, for byte-identical information.
     *
     * Safe because of what the reader does with them. Every consumer in
     * HrExitManagement.tsx either truthiness-checks the value (completed_at,
     * rehired_at, deleted_at) or runs String(v).slice(0, 10) to get a
     * yyyy-mm-dd back out of it — so the ISO instant the cast produced was
     * being thrown away on arrival. Postgres already hands us '2026-06-13'
     * for a date column, which is exactly what slice(0, 10) was digging for.
     *
     * deleted_at is deliberately NOT in here: it is null on all but a handful
     * of rows (a null never builds a Carbon, so it costs nothing), and it is
     * the SoftDeletes column — leaving its cast alone keeps trashed() honest.
     */
    private const EXIT_DATE_CASTS = [
        'date_of_joining'    => 'string',
        'probation_end_date' => 'string',
    ];

    /** Same, for the four date columns selected on the exit row. */
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
        // Feeds the photo_url accessor without an N+1; hidden from the payload.
        'photoDocument:id,employee_id,document_key,file_path',
    ];


    private const ONBOARDING_COLUMNS = [
        // identity + scope
        'id',
        'client_id',
        'branch_id',
        'deleted_at',
        'emp_code',
        'first_name',
        'last_name',
        'display_name',
        // status / progress — drives the Status pill and the tab split
        'status',
        'onboarding_stage_completed',
        'wizard_step_completed',
        // the table's remaining columns
        'department_id',
        'designation_id',
        'primary_role_id',
        'ancillary_role_id',
        'ancillary_role_ids',
        'reporting_manager_id',
        'reporting_manager_user_id',
        'date_of_joining',
        // profile_completion inputs (beyond those already listed above)
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
        // `shifts` is needed by Employee::resolveShiftWindow() — without it the
        // profile can show a shift name but never its timings.
        'branch:id,name,shifts',
        'creator:id,name,user_type',
        'user:id,name,email,status,last_login_at,user_type,designation',
        'department:id,name,code',
        // `level` mirrors the 6 canonical role tiers (Director/CEO … Intern)
        // — the HR document-template generator filters its recipient list by
        // designation.level === template.role_type, so it must be selected.
        'designation:id,name,level',
        // role_category / role_type are needed so role-aware pickers (e.g. the
        // Recruitment "Assigned HR" = HR-category only, "Hiring Manager" =
        // exclude HR/Intern) can filter employees by their primary role.
        'primaryRole:id,name,role_category,role_type',
        'ancillaryRole:id,name',
        // Legal entity = the employing BRANCH (holds the GST/PAN/CIN + banks).
        // `city`/`country` back the read-only "Location" beside the picker.
        'legalEntity:id,name,code,city,state,country',
        'workCountry:id,name',
        'nationalityCountry:id,name',
        'country:id,name',
        'state:id,name,country_id',
        // Permanent-address pair so EmployeeProfile.tsx can show both
        // current and permanent country/state names without extra calls.
        'permCountry:id,name',
        'permState:id,name,country_id',
        'reportingManager:id,first_name,middle_name,last_name,display_name,emp_code,designation_id',
        // Manager's designation so the picker can label them by role
        // (e.g. "Anushka Bakde (HOD)") instead of the generic "(Employee)".
        'reportingManager.designation:id,name',
        /* The manager is a full Employee and carries the photo_url accessor.
           Without its backing document eager-loaded that accessor falls back to
           an employee_documents lookup per manager instance. */
        'reportingManager.photoDocument:id,employee_id,document_key,file_path',
        // Fallback manager — populated when the picker selected a login User
        // (Client/Branch admin) instead of an Employee row. Only one of
        // reportingManager / reportingManagerUser is non-null per employee.
        'reportingManagerUser:id,name,email,user_type,designation',
        'laptopAsset:id,asset_name,code,asset_number',
        'mobileAsset:id,asset_name,code,asset_number',
        // Passport-size photo doc — fed to the `photo_url` accessor so the
        // list/detail JSON exposes it without an N+1 lookup.
        'photoDocument:id,employee_id,document_key,file_path',
        // Exit record (1:1) — surfaces last_working_day / notice_date on
        // the list payload so HrExitManagement can auto-flip Exit In
        // Progress → Exited once the notice period elapses, without an
        // extra round-trip per row. Selected columns only; the full row
        // is loaded on the exit modal itself via /employees/{id}/exit.
        //
        // `rehired_at` MUST stay in this list. A rehire keeps the exit row
        // (the case is history worth having) and only stamps it spent, so
        // exit_case_status stays 'Closed' and completed_at stays set — which
        // is exactly what HrExitManagement reads to decide "Exited". Without
        // rehired_at in the payload its `rehired_at ? null : exit` guard can
        // never fire, and a rehired employee is stuck in the Exited tab and
        // missing from Active Employees forever.
        //
        // `blacklisted` likewise: the Exited list renders a Blacklisted chip
        // from it and gates Reactivate on it (a blacklisted leaver can't be
        // rehired — ExitController::rehireBlockedReason). Missing from the
        // select, it read as undefined, so every row claimed "Not Blacklisted"
        // and offered a Reactivate the server would refuse with a 422.
        'exit:id,employee_id,notice_date,last_working_day,exit_type,exit_case_status,completed_at,current_stage,rehired_at,blacklisted',
        // Prior work experience — drives the EmployeeProfile "Work Experience"
        // card with REAL data (was previously hardcoded sample values). Newest
        // first so the frontend's [0] is the most recent employer.
        'previousEmployments:id,employee_id,company_name,job_title,start_date,end_date',
    ];

    /**
     * WITH plus the entries that cannot live in a const because they carry a
     * closure. Every caller of the full payload goes through this.
     */
    private static function fullWith(): array
    {
        return array_merge(self::WITH, [
            /* withCount, NOT HolidayGroup's two counting accessors. Those are in
               its $appends, so each serialisation ran a COUNT on holidays and
               another on employees — and a belongsTo eager-load hands the same
               group instance to every employee pointing at it, so the list paid
               both once per row. 34 of the 68 queries behind GET /employees
               were exactly this. */
            'holidayGroup' => fn($q) => $q->select('id', 'name')
                ->withCount(['holidays', 'employees']),
        ]);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  LIST / SHOW / NEXT-CODE
     * ───────────────────────────────────────────────────────────────── */

    public function index(Request $request)
    {
        $this->authorize($request, 'can_view');

        // Include soft-deleted rows by default so the SPA's "Disabled
        // Employees" tab can render them. The toggle on each row uses
        // DELETE /employees/{id} which soft-deletes — without this the
        // disabled employees would silently disappear from the list.
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

        /* Active / Disabled split, mirroring what the SPA derives per row: a
         * row is "enabled" when it is not soft-deleted AND its status is none
         * of the three that mean the person is gone. Kept as its own parameter
         * rather than reusing ?status= because the tab is a THREE-value idea
         * (Active / Disabled / All) that no single status column value matches.
         *
         * Only applied when the caller sends the parameter, so every existing
         * consumer keeps getting both kinds of row. */
        if ($request->has('enabled')) {
            $off = ['inactive', 'terminated', 'resigned'];
            // COALESCE, not a bare LOWER(status): the column is nullable and
            // `NULL NOT IN (…)` evaluates to NULL, so a row with no status set
            // would fall out of BOTH tabs and disappear from the screen
            // entirely. The SPA reads a missing status as Active, so this does
            // the same.
            $st = DB::raw("COALESCE(LOWER(status), 'active')");
            $q->where(fn($w) => $request->boolean('enabled')
                ? $w->whereNull('deleted_at')->whereNotIn($st, $off)
                : $w->whereNotNull('deleted_at')->orWhereIn($st, $off));
        }

        // Assignment pickers (e.g. Recruitment's Hiring Manager / Assigned HR
        // dropdowns) opt into this so half-onboarded or inactive staff don't
        // appear as selectable people. Defaults OFF so the HR Employees master
        // list still shows everyone — including disabled rows and in-progress
        // onboarding. Mirrors the gate used by managers() and Exit Management.
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

        /* Accessors are opt-OUT rather than opt-in: $appends is the model's
           default and every other caller still wants all of it. Applied to the
           rows after they are fetched because setAppends() is per-instance —
           there is no query-level switch for it. */
        $trimAppends = function ($rows) use ($listView, $exitView, $onbView) {
            if (!$listView && !$exitView && !$onbView) return $rows;

            /* ->items(), not the paginator itself: collect() on a paginator
               wraps its ARRAY form — current_page, data, links — so mapping over
               it walks the envelope's keys instead of the employees. */
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

                /* The reporting manager is another Employee and arrives with
                   the same accessors attached. Serialising it therefore ran
                   photo_url (an employee_documents lookup) and
                   ancillary_roles_resolved (a master_roles lookup) once per
                   manager — 50 queries on a 25-row page — to fill a cell that
                   prints a name. Neither screen reads anything else off the
                   manager, so it keeps no accessors at all. */
                if ($row->relationLoaded('reportingManager')) {
                    $row->getRelation('reportingManager')?->setAppends([]);
                }
            }

            /* Both views drop the "resolved" accessors above; these rebuild
               them from one query each. The HR list doesn't render the assets,
               so it stops after the roles. */
            $this->batchAncillaryRoles($items);
            if ($exitView) {
                $this->batchOtherAssets($items);
                $this->stringifyExitDates($items);
            }

            return $rows;
        };

        /* Pagination is OPT-IN.
         *
         * Ten other screens read this endpoint (batch payments, onboarding,
         * exit management, broadcast, recruitment, document templates, the
         * employee picker …) and every one of them treats the body as a plain
         * array. Returning the {data, total, …} envelope unconditionally would
         * blank all of them at once, so only a caller that actually asks for a
         * page gets it.
         *
         * per_page is clamped rather than trusted: the HR list sizes its page
         * to the viewport (DataTable's autoFitRows), so the value is whatever
         * happens to fit — not one of the 10/25/50 the dropdown offers — and an
         * unclamped one would let a caller request the entire table back, which
         * is the thing paginating is here to prevent.
         */
        /* Stamp the edit-freeze flag onto every row the caller gets back.
         *
         * One query per page, not one per row — and applied to ALL views, not
         * just the exit view: the HR Employees list is where people click Edit,
         * and a button that only discovers it is frozen by taking a 422 is a
         * worse screen than one that never offers the click. Written straight
         * onto the model like batchAncillaryRoles() does, so it serialises as a
         * plain boolean the SPA can read. */
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

        if ($request->has('per_page') || $request->has('page')) {
            // A junk or non-positive per_page falls back to the DEFAULT, not to
            // the floor: max(1, (int) 'abc') is 1, which would answer a
            // mistyped parameter with 111 single-row pages rather than the
            // sensible page the caller obviously meant.
            $requested = $request->query('per_page');
            $perPage = is_numeric($requested) && (int) $requested > 0
                ? min(self::MAX_PER_PAGE, (int) $requested)
                : self::DEFAULT_PER_PAGE;

            return response()->json($stampExitFreeze($trimAppends($q->paginate($perPage))));
        }

        return response()->json($stampExitFreeze($trimAppends($q->get())));
    }

    /**
     * Headline counts for the HR Employees KPI row and the two tab badges.
     *
     * These used to be derived in the browser by filtering the full employee
     * array. That worked only because index() returned every row; once the list
     * is paginated the browser holds one page, and counting it would report
     * "Total Employees 25" on a tenant of 500.
     *
     * Deliberately NOT filtered by ?search / ?department_id: the cards describe
     * the whole roster, not the current view — which is what the client-side
     * version did, since it counted the unfiltered array.
     *
     * The definitions below mirror apiToRow() in HrEmployees.tsx exactly. If
     * either side changes, the cards stop agreeing with the rows beneath them.
     */
    /**
     * Rebuild `ancillary_roles_resolved` for a page of employees with ONE
     * query, replacing the accessor's one-per-row.
     *
     * As an accessor it issued a SELECT per row — 25 of them for a page — to
     * turn a JSON array of ids into names for the "Ancillary Role" chips.
     * Written straight onto the model, so it serialises exactly as the
     * accessor's output did and no caller can tell the difference.
     *
     * The id order is the user's pick order and is preserved: the chip row
     * reads left to right, and re-sorting it would silently reorder what
     * someone chose.
     *
     * @param  iterable<\App\Models\Employee>  $items
     */
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

    /**
     * Same treatment for `other_assets_resolved`, for the same reason.
     *
     * Exit Management can't simply drop this one the way the HR list does —
     * the asset-recovery stage lists every piece of company property the
     * leaver holds, and the third bucket of it lives in a JSON array of master
     * asset ids. Left as an accessor that is a master_assets SELECT per
     * employee, on top of the ancillary-role one, i.e. two extra queries for
     * every row on screen.
     *
     * @param  iterable<\App\Models\Employee>  $items
     */
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

    /* ── Exit Management: status derived in SQL ─────────────────────────
     * A mirror of apiToExitRow() in HrExitManagement.tsx. Needed because the
     * page is paginated: the browser holds 25 rows, so it can no longer sort
     * employees into tabs by scanning the roster, nor count the tab badges.
     * IF EITHER SIDE CHANGES, BOTH MUST — the frontend holds the documented
     * copy of these rules.
     * ─────────────────────────────────────────────────────────────────── */

    /** A live exit case: one that exists and was not spent by a rehire. */
    private function sqlLiveExit(string $extra = ''): string
    {
        return 'EXISTS (SELECT 1 FROM employee_exits x'
            . ' WHERE x.employee_id = employees.id AND x.rehired_at IS NULL'
            . ($extra ? " AND ({$extra})" : '') . ')';
    }

    /** `exitInitiated`. COALESCE on exit_type — JS reads '' as falsy, SQL doesn't. */
    private function sqlExitInitiated(): string
    {
        return $this->sqlLiveExit(
            "COALESCE(x.exit_type, '') <> ''"
                . ' OR x.last_working_day IS NOT NULL'
                . ' OR x.notice_date IS NOT NULL'
                . ' OR COALESCE(x.current_stage, 0) >= 1'
        );
    }

    /** `status === 'Exited'`. Both halves require the case: disabled is not exited. */
    private function sqlExited(): string
    {
        return '(('
            . $this->sqlLiveExit("x.exit_case_status = 'Closed' OR x.completed_at IS NOT NULL")
            . ') OR (('
            . $this->sqlLiveExit()
            . ") AND status IN ('Resigned', 'Terminated', 'Inactive')))";
    }

    /** `status === 'Exit In Progress'` — only reached when NOT exited. */
    private function sqlInProgress(): string
    {
        return '((' . $this->sqlExitInitiated() . ") OR status = 'Notice Period')";
    }

    /** `status === 'Missing Details'` — only reached when neither above. */
    private function sqlMissingDetails(): string
    {
        return "(COALESCE(email, '') = '' OR department_id IS NULL OR designation_id IS NULL)";
    }

    /**
     * Who the page can see at all: fully onboarded, and either not disabled or
     * carrying a real exit. This was a deliberate superset while the browser
     * held every row and made the exact call itself; paginating removed that
     * option, since a superset would put rows on a page the browser then
     * deleted and a page of 25 would render 23.
     *
     * @param  \Illuminate\Database\Eloquent\Builder  $q
     */
    private function applyExitVisibility($q): void
    {
        $q->where('onboarding_stage_completed', '>=', 6)
            ->whereRaw('(deleted_at IS NULL OR (' . $this->sqlExitInitiated() . ') OR ' . $this->sqlExited() . ')');
    }

    /**
     * Narrow to one tab. Written as an if/else CHAIN like the frontend's: a
     * closed case can still carry a last_working_day, so "in progress" has to
     * mean in-progress AND NOT exited. The Active tab covers Active AND
     * Missing Details — one tab on screen, split only by a badge.
     *
     * @param  \Illuminate\Database\Eloquent\Builder  $q
     */
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

    /**
     * KPI tiles + tab badges for Exit Management. Separate from the list for
     * the same reason stats() is: they describe the whole roster, not the 25
     * rows on screen. Search narrows them so the badges agree with the rows
     * beneath; the tab deliberately does not, since these tiles are the
     * breakdown the tabs are cut from.
     */
    /**
     * Who belongs on the Onboarding Hub at all.
     *
     * Both rules used to run in the browser, over the full unpaginated array.
     * Once the list is a page of eight they have to be exact rather than a
     * superset, or a page of eight arrives and renders six.
     *
     * Soft-deleted rows are dropped because the Hub is a forward-motion
     * surface — offering "Initiate Onboarding" on a disabled account that
     * cannot even sign in. Exited people are dropped for the same reason and
     * are NOT soft-deleted: completing an exit flips status to
     * Resigned/Terminated and disables the login while leaving the row live,
     * so a deleted_at check alone let leavers reappear in the queue.
     */
    private function applyOnboardingVisibility($q): void
    {
        // COALESCE for the same reason applyScope's enabled-filter uses it: the
        // column is nullable and `NULL NOT IN (…)` is NULL, which would drop
        // every status-less row off the screen. A missing status reads Active.
        $st = DB::raw("COALESCE(LOWER(status), 'active')");
        $q->whereNull('deleted_at')
            ->whereNotIn($st, ['resigned', 'terminated', 'inactive']);
    }

    /**
     * "Completed" as the Hub's status pill defines it — all six HR stages done
     * AND the person Active. Expressed once, here, because the tab filter and
     * every count in onboardingStats() have to agree with each other and with
     * the pill the row renders.
     */
    private function sqlOnboardingCompleted(): string
    {
        return "(COALESCE(onboarding_stage_completed, 0) >= 6"
            . " AND COALESCE(LOWER(status), 'active') = 'active')";
    }

    /** Has HR moved this record at all? Separates In Progress from Not Started. */
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

    /**
     * The five KPI tiles and the two tab badges on the Onboarding Hub.
     *
     * Separate from index() for the same reason exitStats() is: the list is
     * paginated, so counting the rows the browser holds would report "Total
     * Employees 8" on a tenant of 365.
     *
     * Follows ?search — the tiles describe whoever is being looked at — but
     * NOT the tab, since the tabs are cut from this very breakdown.
     */

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

        /* Sub-request carrying this caller's identity and branch, because the
           delegated handlers read their filters off the Request. Built rather
           than mutating $request so one key's parameters cannot leak into the
           next key's call. */
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

        /* Employee-scoped keys. Skipped entirely without an id — the form only
           asks for them once it has a saved employee to exclude from the
           available-asset pools. */
        if ($employeeId) {
            foreach (['laptop', 'mobile', 'other'] as $cat) {
                $take("assets_{$cat}", fn() => $this->availableAssets($sub([
                    'category' => $cat,
                    'exclude_employee_id' => $employeeId,
                ])));
            }
            $take('salary_structures', fn() => app(\App\Http\Controllers\Api\SalaryStructureController::class)
                ->index($sub(['employee_id' => $employeeId, 'active_only' => 1])));
        }

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

        // One pass, not four COUNTs that each re-scan the table.
        $row = $base()->selectRaw("
            COUNT(*)                                                        AS total,
            SUM(CASE WHEN {$completed} THEN 1 ELSE 0 END)                   AS completed,
            SUM(CASE WHEN NOT {$completed} AND {$started} THEN 1 ELSE 0 END) AS in_progress,
            SUM(CASE WHEN NOT {$completed} AND NOT {$started}
                     THEN 1 ELSE 0 END)                                     AS not_started
        ")->first();

        /* "Missing Profile Details" is profile_completion < 60, and
           profile_completion is a PHP accessor blending seventeen fields with
           the stage. Re-expressing that in SQL would put one rule in two
           places and let them drift silently — the tile would disagree with the
           bar printed on the row. So the pending rows are streamed with only
           the columns that accessor reads and counted here instead. */
        $missing = 0;
        foreach (
            $base()->whereRaw("NOT {$completed}")
                ->select(self::ONBOARDING_COLUMNS)
                ->cursor() as $emp
        ) {
            if ($emp->profile_completion < 60) $missing++;
        }

        // SUM() is a string on Postgres and null on an empty tenant; these feed
        // a counter animation that expects numbers.
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

        $exited  = $this->sqlExited();
        $prog    = $this->sqlInProgress();
        $missing = $this->sqlMissingDetails();

        // One pass, not five COUNTs that each re-scan the table.
        $row = $q->selectRaw("
            COUNT(*)                                                    AS total,
            SUM(CASE WHEN {$exited} THEN 1 ELSE 0 END)                  AS exited,
            SUM(CASE WHEN NOT {$exited} AND {$prog} THEN 1 ELSE 0 END)  AS in_progress,
            SUM(CASE WHEN NOT {$exited} AND NOT {$prog} AND {$missing}
                     THEN 1 ELSE 0 END)                                 AS missing,
            SUM(CASE WHEN NOT {$exited} AND NOT {$prog} AND NOT {$missing}
                     THEN 1 ELSE 0 END)                                 AS active
        ")->first();

        // SUM() is a string on Postgres and null on an empty tenant; these feed
        // a counter animation that expects numbers.
        return response()->json([
            'total'      => (int) ($row->total ?? 0),
            'active'     => (int) ($row->active ?? 0),
            'inProgress' => (int) ($row->in_progress ?? 0),
            'exited'     => (int) ($row->exited ?? 0),
            'missing'    => (int) ($row->missing ?? 0),
        ]);
    }

    /**
     * Free-text filter shared by the list and the counts.
     *
     * Extracted because stats() has to narrow by exactly the same rule as
     * index(): the tab badges sat at their unfiltered totals while the table
     * below them showed three rows, so the page contradicted itself (QA #173).
     * Two copies of a nine-clause OR would drift the first time one is edited.
     *
     * @param  \Illuminate\Database\Eloquent\Builder  $q
     */
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
                // Department / designation / role names are searchable too.
                // The HR list used to filter the whole array in the browser and
                // matched on those three; once the list is paginated the browser
                // only holds one page, so anything the server can't find is
                // simply unfindable.
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
        /* Same narrowing the list applies, so the badges describe the rows on
           screen. Absent search = whole roster, exactly as before. */
        $this->applySearch($q, $request->query('search'));

        /* "Enabled" is not a column: a row counts as active when it is not
           soft-deleted AND its status is none of the three that mean the person
           has left. COALESCE because status is nullable and the SPA reads a
           missing one as Active. */
        $enabled = "(deleted_at IS NULL AND COALESCE(LOWER(status), 'active') NOT IN ('inactive', 'terminated', 'resigned'))";
        $stage   = 'COALESCE(onboarding_stage_completed, 0)';
        $step    = 'COALESCE(wizard_step_completed, 0)';

        // One pass over the table. Five separate COUNT queries would each
        // re-scan it, and this endpoint is on the critical path of every page
        // load for the list.
        $row = $q->selectRaw("
            COUNT(*)                                                              AS total,
            SUM(CASE WHEN {$enabled} THEN 1 ELSE 0 END)                           AS active,
            SUM(CASE WHEN {$enabled} THEN 0 ELSE 1 END)                           AS disabled,
            SUM(CASE WHEN {$stage} >= 6 THEN 1 ELSE 0 END)                        AS onboarding_completed,
            SUM(CASE WHEN {$stage} < 6 AND ({$stage} > 0 OR {$step} > 0)
                     THEN 1 ELSE 0 END)                                           AS new_joiners
        ")->first();

        // SUM() comes back as a string on Postgres, and null when the tenant has
        // no employees at all — the SPA feeds these straight into a counter
        // animation that expects numbers.
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
        /* Resolved ONCE.
         *
         * This used to resolve the id, fetch the row, run the self-or-can_view
         * check, and then do all three again through authorizeViewOrSelf() —
         * two identical loads of the record and its two dozen relations, plus a
         * second decrypt of the id, for one GET. It halved the endpoint: 52
         * queries became 26 with nothing else changed.
         *
         * The check kept is the cheaper of the two and enforces exactly the
         * same rule — an employee may always read their OWN profile (the
         * self-service page) without the module grant, anyone else's needs
         * can_view. It reads user_id off the row already in hand;
         * authorizeViewOrSelf() asked the database the same question a second
         * time from the other direction.
         */
        $row = $this->resolveRow($request, $this->resolveIdParam($id));
        if ((int) ($row->user_id ?? 0) !== (int) $request->user()->id) {
            $this->authorize($request, 'can_view');
        }
        /* Resolved shift window (branch Shift Details → this employee's shift
           name). Computed, not stored: the employees table holds only the shift
           NAME, so the profile had no way to show the actual timings. */
        [$shiftStart, $shiftEnd] = $row->resolveShiftWindow();
        $row->setAttribute('shift_start', $shiftStart);
        $row->setAttribute('shift_end', $shiftEnd);
        // Lets the Set/Reset Password modal say what state this login is in
        // rather than presenting an identical empty form either way.
        $row->setAttribute('password_status', $this->passwordStatusFor($row));
        /* Is an exit under way? (QA #105)
         *
         * Not derivable on the client: employees.status stays 'Active' until the
         * exit is completed, so the edit form had no way to know the salary is
         * frozen and rendered the Compensation step fully editable. The server
         * refuses the change either way (assertSalaryNotLockedByExit), but a
         * field that accepts input and then fails on save is a worse experience
         * than one that says up front why it is locked. */
        $row->setAttribute(
            'exit_in_progress',
            in_array((int) $row->id, \App\Support\ExitInProgress::employeeIds(null, [(int) $row->id]), true),
        );
        return response()->json($row);
    }

    /**
     * Self-service / HR update of an employee's bank & payment details only.
     *
     * The full update() requires master.employees can_edit, which an ordinary
     * employee never holds — so once bank details were captured at onboarding,
     * nobody could correct them afterwards (#35: "no one can edit the bank
     * details"). This narrow endpoint lets the employee fix their OWN payout
     * account, while HR / branch users (holding can_edit) can fix anyone's in
     * their tenant. Only the bank columns are written — pay, status and every
     * other field are left untouched.
     */
    public function updateBankDetails(Request $request, $id)
    {
        $row = $this->resolveRow($request, $this->resolveIdParam($id));

        // Self may edit their own payout account without the module grant;
        // editing someone else's still requires can_edit (mirrors show()).
        $isSelf = (int) ($row->user_id ?? 0) === (int) $request->user()->id;
        if (!$isSelf) {
            $this->authorize($request, 'can_edit');
        }

        // A disabled (soft-deleted / terminated) employee accepts no edits —
        // same gate as update().
        if ($row->isDisabled()) {
            return response()->json([
                'message' => 'This employee is disabled — restore/re-activate them before editing bank details.',
            ], 422);
        }

        /* NOT frozen during an exit, unlike update(). Deliberate: the Full &
           Final is paid into this account, and an exit is exactly when a wrong
           account number surfaces and has to be corrected. Freezing it would
           block the settlement rather than protect it. Nothing here feeds the
           exit calculation — only where the money lands. */

        $data = $request->validate([
            'salary_payment_mode' => 'nullable|in:bank,cheque,cash',
            /* Letters and spaces only. A bank name and an account holder
               name are both people-and-institution names — the columns were
               taking "324567890()&" and "Trupti#%#@@" straight onto the
               payout record a salary is transferred against (CBC #185). */
            'bank_name'           => ['nullable', 'string', 'max:150', 'regex:/^[A-Za-z ]+$/'],
            // PAN-style account numbers can include letters (NRE/NRO), so we
            // don't enforce digits-only — same rule as the onboarding wizard.
            /* QA #187 — 8 to 18 digits, nothing else.
               This replaces an earlier "account numbers can include letters
               (e.g. NRE/NRO)" exemption. NRE and NRO name an account TYPE, not
               an alphanumeric format: Indian bank account numbers are numeric,
               and all 425 accounts on file already satisfy this, so the
               exemption was protecting a case that does not exist while
               letting "1234@#$%" through. */
            'bank_account_number' => ['nullable', 'string', 'regex:/^\d{8,18}$/'],
            // IFSC: 4 letters, 0, 6 alphanumeric (case-insensitive).
            'ifsc_code'           => 'nullable|string|regex:/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/',
            'account_holder_name' => ['nullable', 'string', 'max:150', 'regex:/^[A-Za-z ]+$/'],
            /* QA #186 — the branch was the one bank field with no shape rule,
               so "@#$%^" saved happily next to a bank name and account holder
               that both refuse anything but letters.
               NOT letters-only like those two, though: real branch names carry
               digits and punctuation — "Sector 17", "M.G. Road", "Andheri
               (East)", "Nagar Road & Kalyani", "Branch No. 2". Rejecting those
               would swap a validation gap for a validation obstacle. The
               lookahead demands at least one letter, so "123" and "---" are
               still refused. */
            'bank_branch'         => ['nullable', 'string', 'max:150', 'regex:/^(?=.*[A-Za-z])[A-Za-z0-9 .,\-\/()&\']+$/'],
            'bank_account_type'   => 'nullable|string|max:30',
        ], [
            'ifsc_code.regex' => 'Enter a valid IFSC code (e.g. HDFC0001234).',
            'bank_account_number.regex' => 'Account Number must be 8 to 18 digits, with no spaces or symbols.',
            // Names what IS allowed, not just what failed — "invalid format"
            // leaves the user guessing which character to remove.
            'bank_branch.regex' => 'Branch can contain letters, numbers, spaces and . , - / ( ) & only.',
        ]);

        // Store IFSC uppercased, the way the onboarding wizard persists it.
        if (!empty($data['ifsc_code'])) {
            $data['ifsc_code'] = strtoupper($data['ifsc_code']);
        }

        $row->fill($data)->save();

        return response()->json([
            'message' => 'Bank details updated.',
            'data'    => $row->only(array_keys($data)),
        ]);
    }

    /**
     * Holidays for THIS employee's assigned Holiday Group, resolved for a given
     * year — recurring holidays shift onto the requested year (mirrors
     * HolidayController::my). Gated by the employee can_view permission the
     * profile already requires, so a manager/admin can see any employee's
     * calendar without holding the separate hr.holiday module grant.
     *
     * Response: { group: {id,name}|null, year, holidays: [{name,date,type,...}] }
     */
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
                // Recurring holidays repeat yearly — surface them on the
                // requested year regardless of the original stored year.
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

    /**
     * Accept either a plain numeric id (legacy / internal usage) or the
     * encrypted token surfaced by `Employee::encrypted_id` (used by SPA
     * URLs so /hr/employees/EMP-001/profile becomes a non-guessable
     * blob). Falls back to a 404 instead of leaking decryption errors —
     * any malformed token reads as "no such employee" downstream once
     * resolveRow runs findOrFail.
     */
    /**
     * Earliest joining date this employee may carry. (#121)
     *
     * Ordinary staff: 50 years back, so a genuine historical hire can still be
     * recorded. A RE-ONBOARDED employee: the day they were rehired — nobody
     * joins before they are brought back, and without this floor the wizard's
     * pre-filled old joining date saved straight through and re-dated the new
     * employment to the previous one.
     *
     * Returns a Y-m-d string for `after_or_equal:`.
     */
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

        // Encrypted token path — Employee::encrypted_id ships a URL-safe
        // version (+ → -, / → _, padding stripped). Reverse those swaps
        // before handing off to Crypt::decryptString.
        $normalised = strtr($raw, '-_', '+/');
        $pad = strlen($normalised) % 4;
        if ($pad) $normalised .= str_repeat('=', 4 - $pad);
        try {
            $decoded = \Illuminate\Support\Facades\Crypt::decryptString($normalised);
            if (is_numeric($decoded)) return (int) $decoded;
        } catch (\Throwable $e) {
            // not an encrypted token — fall through.
        }

        // Legacy URL fallback: callers (and bookmarks) sometimes still pass the
        // plain emp_code (e.g. EMP-001). emp_codes are allocated sequentially
        // PER TENANT, so the SAME code can exist in another client — an unscoped
        // lookup would return whichever row sorts first (often a different
        // tenant's employee). That stray id then fails the tenant-scoped
        // findOrFail in resolveRow with "No query results for Employee N"
        // (e.g. password reset on a newly-onboarded employee). Scope the lookup
        // to the caller's own tenant; super-admins resolve across tenants.
        // Codes now also repeat ACROSS THE BRANCHES of one client (each branch
        // restarts at EMP-001 — see the emp_code_unique_per_branch migration),
        // so a caller who belongs to a branch must resolve within that branch or
        // they'd land on their sibling branch's EMP-001. Callers who legitimately
        // span branches (client_admin / super_admin) keep the wider lookup.
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

    /**
     * Eligible managers picker — used by the Add/Edit Employee wizard so the
     * user can assign a Reporting Manager even before any employees exist.
     *
     * Returns existing employees first (FK-clean), then the tenant's other
     * login users (client_admin, client_user, branch_user) so a brand-new
     * org can still pick a manager. Each row is tagged with `kind` so the
     * frontend can label it (e.g. "Atharv Patekar — Designer (Employee)"
     * vs "QA Admin — Client Admin").
     */
    public function managers(Request $request)
    {
        $this->authorize($request, 'can_view');
        $user = $request->user();

        // Same scope rules as the employee list — employees see managers in
        // their own tenant, super_admins see everything. Honour the active
        // BranchSwitcher selection so the manager picker matches the table.
        //
        // Additional gates to keep the dropdown trustworthy:
        //   - status === 'Active' — Inactive / Resigned / Terminated /
        //     Notice Period people shouldn't be picked as a new hire's
        //     reporting manager. Soft-deleted rows are already excluded
        //     by Eloquent's default scope on Employee (no withTrashed).
        //   - onboarding_stage_completed >= 6 — half-onboarded employees
        //     don't have the org-side context (department, designation,
        //     reporting line of their own) settled yet, so listing them
        //     as a manager would propagate stale data through the new
        //     hire's record. Mirrors the "fully onboarded" gate used by
        //     Exit Management.
        $eq = Employee::query()
            ->whereNotNull('id')
            ->where('status', 'Active')
            ->where('onboarding_stage_completed', '>=', 6)
            // Drop anyone tied to a LIVE exit case — whether it's still IN
            // PROGRESS (exit_case_status 'Open') or already finalised ('Closed'
            // / completed / final status "Exited"). An exit has no
            // withdraw/cancel path and EmployeeExit isn't soft-deleted, so such
            // a row means the person is leaving or already gone: never a valid
            // reporting manager for a new hire. This also acts as
            // belt-and-braces for finalised exits whose employees.status column
            // wasn't flipped for some reason.
            //
            // A REHIRED exit is spent history, not a live case — the person is
            // active staff again. Ignoring rehired_at here barred them from
            // ever being picked as a manager again, since the row is kept
            // rather than deleted.
            ->whereDoesntHave('exit', fn($q) => $q->whereNull('rehired_at'));
        $this->applyScope($eq, $user, $request->integer('branch_id') ?: null);
        // HOD designation ids so the picker can flag which employees are a
        // department's Head — the reporting-manager rule points a non-HOD hire
        // at their department's HOD (or the Branch User until one exists).
        $hodIds = \App\Support\DepartmentPermissionSync::hodDesignationIds();
        $employees = $eq
            // designation_id MUST be selected or the belongsTo('designation')
            // eager-load returns null and every label falls back to "(Employee)".
            ->select(['id', 'emp_code', 'display_name', 'first_name', 'last_name', 'designation_id', 'department_id'])
            ->with(['designation:id,name'])
            ->orderBy('display_name')
            ->get()
            ->map(fn($e) => [
                'id'            => $e->id,
                'kind'          => 'employee',
                // Department + HOD flag drive the reporting-manager rule on the
                // client; an employee reports to their department's HOD.
                'department_id' => $e->department_id,
                'is_hod'        => in_array((int) $e->designation_id, $hodIds, true),
                // Position rank (drives the reporting-manager hierarchy filter on
                // the client — a manager must rank strictly higher than the hire).
                'rank'          => \App\Support\PositionHierarchy::rankForDesignationName($e->designation?->name),
                // Show the employee's DESIGNATION in brackets (e.g. "Anushka
                // Bakde (HOD)") rather than the generic "(Employee)" kind.
                // Falls back to "Employee" only when no designation is set.
                'label' => trim($e->display_name ?: trim($e->first_name . ' ' . $e->last_name))
                    . ' (' . ($e->designation?->name ?: 'Employee') . ')',
            ]);

        // Tenant login users that could plausibly act as managers — only
        // returned for client/branch admins so a non-super-admin still scopes
        // to their own org.
        $uq = User::query()
            ->whereIn('user_type', ['client_admin', 'client_user', 'branch_user'])
            ->where('status', 'active');
        if (!$user->isSuperAdmin()) {
            $uq->where('client_id', $user->client_id);
            // Branch-bound actors (a branch_user AND an employee granted HRMS
            // access) are strictly locked to their own branch — same rule
            // applyScope() enforces for the employee list. Without 'employee'
            // here, a branch employee adding a hire saw branch users from every
            // branch of the client in the Reporting Manager picker. Client-level
            // users (branch_id IS NULL — e.g. Director/CEO) stay visible.
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

        // Resolve each login user's linked EMPLOYEE designation (employees are
        // tied to a login account via employees.user_id). When a user account
        // has an employee record, prefer that employee's designation so the
        // label reads "Name (HOD)" instead of the generic account type.
        $empDesigByUser = Employee::query()
            ->whereIn('user_id', $loginUsers->pluck('id')->all())
            ->whereNotNull('designation_id')
            ->with(['designation:id,name'])
            ->get(['id', 'user_id', 'designation_id'])
            ->reduce(function ($map, $e) {
                if ($e->user_id && $e->designation?->name) $map[$e->user_id] = $e->designation->name;
                return $map;
            }, []);

        $loginUsers = $loginUsers->map(fn($u) => [
            'id'    => $u->id,
            'kind'  => $u->user_type,
            // A login user (Branch User / admin) is the top of the org chart, so
            // it is an eligible manager for every designation.
            'rank'  => \App\Support\PositionHierarchy::TOP_RANK,
            // Designation in brackets — the linked employee's designation
            // first, then the user's own designation, finally the readable
            // user type (e.g. "Client Admin") when none is set.
            'label' => trim($u->name)
                . ' (' . (($empDesigByUser[$u->id] ?? $u->designation) ?: ucfirst(str_replace('_', ' ', $u->user_type))) . ')',
        ]);

        return response()->json([
            'employees'   => $employees->values(),
            'login_users' => $loginUsers->values(),
        ]);
    }

    /**
     * GET /employees/department-tree/{departmentId}
     *
     * Org chart for one department, scoped to the caller's client (+ active
     * branch): the Branch User(s) (Director / CEO) at the top, the single HOD,
     * the Team Leaders, then the remaining employees — the 4-tier hierarchy the
     * reporting-manager rule builds (employee → TL → HOD → Director).
     */
    public function departmentOrgTree(Request $request, int $departmentId)
    {
        $this->authorize($request, 'can_view');
        $user = $request->user();
        $branchFilter = ($user->branch_id ?: null) ?: ($request->integer('branch_id') ?: null);

        // Directors = the Branch User(s) of the client (+ active branch). They are
        // the roots of the chart (an HOD reports to a Branch User).
        $directors = User::query()
            ->where('client_id', $user->client_id)
            ->where('user_type', 'branch_user')
            ->where('status', 'active')
            ->when($branchFilter, fn($q) => $q->where('branch_id', $branchFilter))
            ->orderBy('name')
            ->get(['id', 'name']);

        // Everyone in the department (client + branch scoped). No peer-isolation
        // here: the org chart is a management view of the whole department.
        $emps = Employee::query()
            ->where('client_id', $user->client_id)
            ->where('department_id', $departmentId)
            ->when($branchFilter, fn($q) => $q->where('branch_id', $branchFilter))
            ->with(['designation:id,name', 'photoDocument'])   // photoDocument backs $e->photo_url (passport-size photo)
            ->orderBy('display_name')
            ->get();

        // Flat node map keyed by u{id} (Branch User) / e{id} (Employee).
        $byId = [];
        foreach ($directors as $d) {
            $byId['u' . $d->id] = ['id' => 'u' . $d->id, 'name' => $d->name, 'role' => 'Director / CEO', 'photo' => null];
        }
        foreach ($emps as $e) {
            $byId['e' . $e->id] = [
                'id'    => 'e' . $e->id,
                'name'  => $e->display_name ?: trim($e->first_name . ' ' . $e->last_name),
                'role'  => $e->designation?->name ?: 'Employee',
                'photo' => $e->photo_url,   // passport-size photo, or null → initials fallback
            ];
        }

        // Nest each employee under their actual reporting manager (an employee in
        // this set, or a Branch User). A manager outside the department (or unset)
        // falls back to hanging under the first Director so the chart stays connected.
        $firstDirector = $directors->first() ? 'u' . $directors->first()->id : null;
        $childrenOf = [];   // parentKey => [childKey, …]
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

        // Roots = all Directors (each shows even with no reports) + any employee
        // whose manager couldn't be resolved and there was no Director to hang under.
        $rootKeys = array_values(array_unique(array_merge(
            array_map(fn($d) => 'u' . $d->id, $directors->all()),
            $orphanRoots
        )));

        // Recursively assemble the nested tree, guarding against reporting cycles.
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

    /**
     * Returns the next EMP-### code for the tenant the new row would be
     * stamped under. Keeps the sequence isolated per (client_id, branch_id),
     * mirroring how MasterController generates DEPT-###.
     */
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

    /**
     * Proactive uniqueness probe for the Mobile field.
     *
     *   GET /api/employees/check-mobile?mobile=...&exclude_employee_id=NN
     *
     * Mirrors the tenant scoping used by guardDuplicate() on store/update
     * so the frontend can show a duplicate error on blur — without this
     * the conflict only surfaces after the user clicks "Next" and the
     * server returns 422. Soft-deleted rows are intentionally ignored
     * (they don't block fresh hires there either).
     */
    public function checkMobile(Request $request)
    {
        $this->authorize($request, 'can_view');

        $mobile = trim((string) $request->query('mobile', ''));
        if ($mobile === '') {
            return response()->json(['available' => true, 'conflict' => null]);
        }

        $excludeId = $request->integer('exclude_employee_id') ?: null;

        // For an edit, scope to the row's own client_id (mirrors update's
        // guardDuplicate call). For a new row, fall back to the resolved
        // ownership tenant (mirrors store's path).
        if ($excludeId !== null) {
            $clientId = Employee::withTrashed()->where('id', $excludeId)->value('client_id');
        } else {
            [$clientId] = $this->resolveOwnership($request);
        }

        $q = Employee::query()->where('mobile', $mobile);
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        if ($excludeId !== null) $q->where('id', '!=', $excludeId);

        // Only need to know IF the number is taken — not whose it is. Pulling
        // just the id (or existence) avoids loading another employee's PII.
        if (! $q->exists()) {
            return response()->json(['available' => true, 'conflict' => null]);
        }

        // Generic message — we deliberately DON'T reveal the conflicting
        // employee's name or code. Surfacing another employee's identity (and
        // implicitly, which number belongs to whom) in a validation message
        // is a PII-disclosure the QA flagged. The caller only needs to know
        // the number is taken, not by whom.
        $message = 'This mobile number is already in use by another employee.';

        return response()->json([
            'available' => false,
            // conflict kept as a boolean-ish marker only — no name/emp_code
            // leaked back to the client.
            'conflict'  => true,
            'message'   => $message,
        ]);
    }

    /**
     * Available assets for the Stage 1 — Assets & Security dropdowns.
     *
     *   GET /api/employees/available-assets?category=laptop|mobile|other
     *                                       [&exclude_employee_id=NN]
     *
     * - laptop / mobile  → master_assets in the matching system category.
     * - other            → master_assets NOT in laptop/mobile categories.
     *
     * Assets currently assigned to ANOTHER employee are filtered out so
     * the dropdown only shows free devices. The asset already on the
     * row being edited (`exclude_employee_id`) stays visible so the
     * admin can keep their existing selection.
     */
    public function availableAssets(Request $request)
    {
        $this->authorize($request, 'can_view');
        $category = strtolower((string) $request->query('category', ''));
        $excludeEmployeeId = $request->query('exclude_employee_id');

        if (!in_array($category, ['laptop', 'mobile', 'other'], true)) {
            abort(422, 'category must be one of laptop, mobile, other');
        }

        // Match by category NAME (case-insensitive), accepting any category
        // whose name is "Laptop" or "Mobile" — not just the seeded system
        // rows. In real tenants we found assets linked to user-created
        // categories that share the name (a manager named their own "Laptop"
        // category while the seeded one already existed), which caused the
        // Stage 1 dropdown to silently come back empty even though the
        // Asset Master page clearly listed 25 laptops. Matching by name is
        // forgiving of that data divergence while still scoped to laptop /
        // mobile only — "other" excludes any category named laptop/mobile,
        // so accidental double-counting is impossible.
        $catRows = \App\Models\Masters\AssetCategories::query()
            ->whereRaw('LOWER(name) IN (?, ?)', ['laptop', 'mobile'])
            // Tenant-scoped: without this every client's "Laptop"/"Mobile"
            // category id landed in the list. Harmless for the laptop/mobile
            // branches (a foreign id never matches this tenant's assets) but
            // it made `other` exclude ids that were never ours.
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
        // Tenant scope — assets owned by the same client, plus globally-owned
        // ones (client_id IS NULL).
        $u = $request->user();
        if ($u && !$u->isSuperAdmin()) {
            $assetQ->where(function ($w) use ($u) {
                $w->whereNull('client_id')->orWhere('client_id', $u->client_id);
            });
        }

        // BRANCH scope. This filter was missing entirely (only client_id was
        // applied, despite the comment claiming otherwise), so every branch of
        // a client saw every sibling branch's devices in the Stage 3 asset
        // pickers. An asset physically sits in one branch and cannot be handed
        // to someone in another.
        //
        // Resolve the branch from the EMPLOYEE being assigned when we know them
        // — the picker is always opened on a specific person, and that person's
        // branch is what matters, not whatever the viewer happens to have
        // selected in the switcher. Fall back to the caller's active branch for
        // the Add-Employee case (no row yet). A branch_user is then pinned to
        // their own branch so a hand-crafted request cannot widen the scope.
        // Rows with a NULL branch_id are client-level and stay visible to all.
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
            $branchId = (int) $u->branch_id;   // pinned — every branch is an isolated peer
        }
        // STRICT branch match — deliberately not the usual
        // `branch_id IS NULL OR branch_id = mine` shape used by every other
        // master.
        //
        // That NULL escape hatch means "client-level row, visible to all
        // branches", which is right for a LOOKUP (a Department or a Currency is
        // genuinely shared). An asset is not a lookup: it is one physical
        // device sitting in one office. A laptop with no branch belongs to no
        // office, so it must not be offered for assignment in every office —
        // which is exactly what QA saw, since the seeded demo assets all carry
        // branch_id NULL and were therefore listed by every branch at once.
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

        // Active-only — disposed / under-repair devices shouldn't be
        // assignable to a new hire.
        $assetQ->where(function ($w) {
            $w->whereNull('status')->orWhere('status', 'Active');
        });

        // Pull every asset the requester might see, then strip the ones
        // already booked by other employees.
        $assets = $assetQ->orderBy('asset_name')->get();
        $assetIds = $assets->pluck('id')->all();

        $bookedIds = collect();
        if (!empty($assetIds)) {
            // Only ACTIVE-roster employees actually hold an asset. Someone who
            // has exited (Resigned / Terminated) has effectively returned their
            // devices, so their old assignment must NOT keep the asset locked —
            // otherwise the picker shows "No other assets available" forever
            // even though the holder has left. Soft-deleted rows are excluded
            // for the same reason.
            $bookingQ = Employee::withTrashed()
                // A DISABLED employee is not an exited one. Soft-delete here is
                // the "Disabled Employees" toggle — the person is still on the
                // roster and can be switched back on, and nobody collected their
                // laptop when the toggle flipped. Skipping them handed their
                // still-held devices to the next hire. Release is now driven by
                // exit STATUS alone (below), which is the event that actually
                // means "hardware returned".
                ->where(function ($w) {
                    // NULL-safe on purpose. `status NOT IN ('Resigned', ...)`
                    // evaluates to NULL — not true — when status is NULL, so
                    // SQL drops the row from this scan entirely and every asset
                    // that employee holds silently reads as free.
                    $w->whereNull('status')
                        ->orWhereNotIn('status', ['Resigned', 'Terminated']);
                })
                // Only this tenant's roster can hold this tenant's assets —
                // scanning every client's employees was pure waste.
                ->when(
                    $u && !$u->isSuperAdmin() && $u->client_id,
                    fn($q) => $q->where('client_id', $u->client_id)
                );
            // NOTE: the employee being edited is deliberately NOT excluded from
            // this scan — see the slot-scoped exemption below.
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

        /* Slot-scoped self-exemption.
         *
         * `exclude_employee_id` exists so the device THIS employee already holds
         * stays visible in the picker instead of vanishing as "booked". But it
         * used to drop the employee from the booking scan ENTIRELY, which
         * exempted all three of their slots at once — so a device they hold as
         * their laptop was also offered as a free MOBILE on the same form, and
         * one physical device could be booked into two slots of one person.
         *
         * QA hit this by changing an asset's category from Laptop to Mobile in
         * the Asset master: the device was still linked in the employee's laptop
         * slot, yet showed up as assignable in the mobile dropdown.
         *
         * So exempt only the holding that belongs to the slot being asked about.
         */
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

        /* The saved device may no longer be in the requested category at all —
         * exactly the Laptop→Mobile edit above. It then falls out of `$assets`
         * (the category filter is correct and must stay), leaving the picker
         * with a selected id it cannot resolve, which the UI rendered as a bare
         * number: "the asset ID is displayed in laptop field".
         *
         * Append it, flagged, so the field shows the device's NAME plus a
         * "Category changed" badge. That is the honest state — the slot is
         * pointing at something that is no longer a laptop — and it lets the
         * admin see what happened and re-pick, instead of staring at an id. */
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
                    // Label format: "AST-#### — Asset Name". Prefer the
                    // auto-generated `code` (the public asset ID shown
                    // in the master table); fall back to `asset_number`
                    // (legacy free-text serial) if code is missing.
                    $idPart = $a->code ?: $a->asset_number;
                    $label  = trim(($idPart ? $idPart . ' — ' : '') . ($a->asset_name ?? ''));
                    return [
                        'id'            => $a->id,
                        'asset_name'    => $a->asset_name,
                        'asset_number'  => $a->asset_number,
                        'code'          => $a->code,
                        'label'         => $label,
                        // True only for a device still linked to this slot whose
                        // category has since been changed elsewhere. The picker
                        // badges it so the mismatch is visible rather than silent.
                        'stale_category' => $staleSet->has((int) $a->id),
                    ];
                })
                ->values(),
        );
    }

    /* ─────────────────────────────────────────────────────────────────
     *  STORE — creates Employee + paired User login + sends welcome mail
     * ───────────────────────────────────────────────────────────────── */

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

                // Reject obvious duplicate hires within the same tenant.
                // The Laravel validator already blocks identical login
                // emails (unique on users.email), but the form accepted
                // re-uses of the same human paired with a tweaked email.
                // Catch those before the row is written.
                $this->guardDuplicate($data, $clientId, null);

                // Only one Head of Department (HOD) is allowed per department
                // (within a branch) — the branch's single sales/ops head.
                $this->assertSingleHodPerDepartment($data, $clientId, $branchId, null);

                // Reporting manager must hold a strictly higher position.
                $this->assertReportingManagerEligible($data, null);

                // Enforce the per-branch user cap before we provision a
                // new User row. Every employee gets a login account
                // (User::create below) so each new hire consumes one
                // slot against Branch.max_users. Skipping this check is
                // why a branch configured for "1 user" could still grow
                // to N — the cap was stored but never read.
                $this->assertBranchUserCap($branchId);

                // Provision the login account first — if the email collides we
                // want the whole txn to roll back before writing the employee row.
                //
                // user.status mirrors the forced employee.status='Inactive' below.
                // The wizard only captures half the onboarding data; admins must
                // flip the row to Active explicitly once the rest is filled in
                // (assets, payroll review, etc.) and that flip cascades the
                // login open via update(). Without this mirror, fresh hires
                // could sign in immediately even though their employee record
                // was deliberately held Inactive — a hole QA flagged.
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
                    // Match the Employee row default (now Active). Without
                    // this, a wizard-created employee could open the
                    // welcome email, try to log in, and get "Your account
                    // is not active" even though the admin never disabled
                    // them and the Employees list showed them as Active.
                    'status'        => 'active',
                    'designation'   => $request->input('designation_name'),
                    'employee_code' => null, // populated after we know emp_code
                ]);

                $empCode = $this->allocateCode($clientId, $branchId);

                // Wizard now saves per-step. The frontend ships the step
                // number it just completed (1-4); we record it so Edit can
                // resume at the right step. Default to 1 because the very
                // first save corresponds to step 1 of the wizard.
                $stepCompleted = max(1, min(4, (int) $request->input('wizard_step_completed', 1)));

                // Newly-added employees default to Active so they show
                // up in the Active tab immediately. The frontend can
                // still override (e.g. for a pre-joining record), but
                // when no status is sent we want a sensible default.
                //
                // The earlier "Force Inactive" policy was creating UX
                // confusion — admins clicked "Add Employee", completed
                // the wizard, then couldn't find their new hire in the
                // Active list. Defaulting to Active matches the natural
                // mental model: I just added them, they're working here.
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

                /* Same rule as update(): stage 6 means "onboarded", and an
                   agreement that has not come back signed means they are not.
                   validatePayload accepts onboarding_stage_completed on create
                   too, so without this a POST could mint an employee already
                   stamped complete — with, necessarily, zero signing runs.
                   Throwing here rolls the whole transaction back, login user
                   included. */
                if ((int) ($payload['onboarding_stage_completed'] ?? 0) >= OnboardingGuard::COMPLETE_STAGE) {
                    OnboardingGuard::assertDocumentsSigned($employee);
                }

                // Mirror the leave_plan dropdown selection into the
                // leave_plan_employees pivot. The frontend used to do
                // this via a separate fire-and-forget POST after save,
                // which dropped silently when the call lost its race
                // with the modal closing — employees got
                // employees.leave_plan set but no pivot row, so their
                // own Leave tab rendered "No leave plan assigned".
                // Doing it here inside the same transaction makes the
                // pivot the source of truth.
                $this->syncLeavePlanPivot($employee, $data['leave_plan'] ?? null, $auth?->id);

                // Backfill emp_code onto the user row so legacy code that reads
                // user.employee_code keeps working.
                $loginUser->update(['employee_code' => $empCode]);

                // Seed the standard "self-service" permission row so the new
                // hire can at least sign in and see their own profile module.
                // Admin can grant additional modules from the UI later.
                $this->grantSelfServicePermissions($loginUser, $clientId, $branchId, $auth?->id);

                // If this hire is a department HOD, re-parent the department's
                // employees to them and auto-grant the department permissions.
                $this->applyHodOnboarding($employee, $auth?->id);

                $employee->load(self::fullWith());

                /* Welcome email is intentionally NOT sent here. Step 1
                 * only captures basic identity — sending credentials
                 * before the admin has finished assets / payroll / KYC
                 * means the employee logs in to a half-built profile.
                 * The mail fires from update() when the wizard hits
                 * Step 4 (final step). password_encrypted on the user row
                 * preserves the random password generated above so we can
                 * decrypt + include it in the welcome body later. */

                return response()->json([
                    'message'  => 'Employee created. Welcome email will be sent once the wizard completes Step 4.',
                    'employee' => $employee,
                ], 201);
            });
        } catch (QueryException $e) {
            // Postgres unique violation (23505). Read the CONSTRAINT NAME before
            // blaming a field: this used to map every 23505 raised anywhere in
            // the transaction onto the email message, so an emp_code clash
            // ("EMP-001 already used in another branch of this client") was
            // reported to QA as "this email already has an account" while the
            // address was brand new. Only claim the email is taken when the
            // email index is the one that actually fired.
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

    /* ─────────────────────────────────────────────────────────────────
     *  UPDATE / DESTROY
     * ───────────────────────────────────────────────────────────────── */

    /**
     * Salary is frozen while an exit is in progress (QA #105).
     *
     * Payroll's Salary Setup already refuses to touch an exiting employee, but
     * the Employee Edit wizard's Compensation step wrote the very same columns
     * with no such guard — so the lock was only ever a property of one screen
     * rather than of the employee. Anyone could raise a leaver's CTC from the
     * other form, and because an accepted change cascades into
     * recomputeEmployeePayslips() and into the active salary structure, it would
     * silently re-price their final month and their Full & Final settlement.
     *
     * Only an ACTUAL CHANGE is refused, never mere presence of the fields. The
     * wizard PUTs its whole step every time it saves, so rejecting on presence
     * would make an exiting employee's Compensation step un-saveable — the user
     * could not correct a phone number without first being told, wrongly, that
     * they were changing the salary. Comparing values keeps every unrelated edit
     * working and blocks exactly the thing the ticket is about.
     *
     * Deliberately NOT covered: `status`, which the exit flow itself must be
     * able to move, and `enable_payroll`, which is how HR takes a leaver out of
     * the run — neither is a change to what the employee is paid.
     */
    private function assertSalaryNotLockedByExit(Employee $row, array $data): void
    {
        // Money-defining columns only. pf/esi applicability is included because
        // both feed the deduction the payslip and the F&F are priced on.
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

        // Only ask the exit question when something is actually being changed —
        // an extra query on every employee save would be pure waste.
        if (!in_array((int) $row->id, \App\Support\ExitInProgress::employeeIds(null, [(int) $row->id]), true)) {
            return;
        }

        throw ValidationException::withMessages([
            'annual_salary' => 'This employee has an exit in progress, so their salary is locked. '
                . 'Dues are settled through the Full & Final settlement in Exit Management — '
                . 'changing the salary here would re-price their final month and the settlement.',
        ]);
    }

    /**
     * Has a salary field actually moved? Compares loosely on purpose: the form
     * posts "450000" where the column holds 450000.00, and a cleared field
     * arrives as '' against a null column. Treating either as a change would
     * block saves that change nothing.
     */
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
        // Hierarchical edit guard intentionally removed: per product call,
        // anyone the admin grants `can_edit` on master.employees should be
        // able to update any row in their tenant — including ones created
        // by the admin themselves. Delete still preserves the guard since
        // it's destructive.

        // Block any mutation on a disabled employee. "Disabled" means EITHER
        // soft-deleted (the Remove action) OR a terminal status set via the
        // edit form (Inactive / Resigned / Terminated) — both kill the login,
        // so neither should accept further profile changes. The row is still
        // resolvable (withTrashed) so the admin can restore it, but business
        // updates — especially the onboarding wizard's PUTs — must not proceed
        // against a disabled record. Restore/re-activate first, then edit.
        // (Exception: a PUT whose ONLY effect is flipping status back to an
        // active value is allowed through so re-activation still works.)
        $incomingStatus = (string) $request->input('status', '');
        $reactivating   = $incomingStatus !== ''
            && !in_array(strtolower($incomingStatus), ['inactive', 'resigned', 'terminated'], true);
        // The reactivation exception below must not become a way to un-exit
        // someone: an exited employee comes back through Exit Management's
        // Reactivate or not at all. See assertNotExited().
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
        // Salary is frozen once an exit is under way (QA #105).
        $this->assertSalaryNotLockedByExit($row, $data);
        // Scope from the row being saved, not the acting user — a super_admin
        // has no client of their own and would otherwise scan every tenant.
        $this->assertAssetsNotDoubleBooked($data, $row->id, $row->client_id);
        // Same duplicate guard as store(), but exclude the row being
        // edited so saving an unchanged employee never reports itself
        // as its own duplicate.
        $this->guardDuplicate($data, $row->client_id, $row->id);

        // One HOD per department (branch-scoped). Fall back to the row's own
        // department/branch when a partial wizard PUT omits them.
        $this->assertSingleHodPerDepartment($data, $row->client_id, $row->branch_id, $row->id, $row);

        // Reporting manager must hold a strictly higher position (and can't be
        // the employee themselves). Fall back to the row's own designation when a
        // partial PUT omits it.
        $this->assertReportingManagerEligible($data, $row->id, $row);

        // Track wizard progress as a high-watermark — never decrease it.
        // The frontend posts the step number it just completed; we keep
        // the maximum so a user editing an already-finished employee
        // can't accidentally roll the progress meter backwards.
        $stepFromRequest = (int) $request->input('wizard_step_completed', 0);
        $oldStep = (int) $row->wizard_step_completed;
        $newStep = max($oldStep, $stepFromRequest);
        // (Welcome-email-on-Step-4 transition logic removed — email is now
        // sent immediately from store(). Step transition tracking below is
        // still used by the macro stage tracker.)

        // Same high-watermark rule for the macro 6-stage tracker.
        $macroFromRequest = (int) $request->input('onboarding_stage_completed', 0);
        $oldMacro = (int) $row->onboarding_stage_completed;
        $newMacro = max($oldMacro, $macroFromRequest);
        // Stage 1's internal wizard fully done ⇒ macro stage ≥ 1.
        if ($newStep >= 4) {
            $newMacro = max($newMacro, 1);
        }

        /* Stage 6 is the "onboarding complete" stamp, and it is reachable by
           anything that PUTs this integer — the wizard's own Stage 5 gate had
           been commented out, and rows exist that reached stage 6 without a
           single agreement ever being dispatched. Only guard the TRANSITION
           into 6, so re-saving an already-completed employee (a later profile
           edit) is never blocked by a rule applied after the fact. */
        if ($newMacro >= OnboardingGuard::COMPLETE_STAGE && $oldMacro < OnboardingGuard::COMPLETE_STAGE) {
            OnboardingGuard::assertDocumentsSigned($row);
        }

        $oldStatus = (string) $row->getOriginal('status');

        $authId = $request->user()?->id;
        DB::transaction(function () use ($row, $data, $newStep, $newMacro, $oldStatus, $authId) {
            // first_name might not be in $data on a partial step-3/step-4
            // PATCH (the frontend only sends the fields for the step it
            // just saved). Fall back to the existing row value so
            // display_name doesn't get smashed to "" when the wizard
            // saves a later step alone.
            $first  = $data['first_name']  ?? $row->first_name;
            $middle = array_key_exists('middle_name', $data) ? $data['middle_name'] : $row->middle_name;
            $last   = array_key_exists('last_name', $data)   ? $data['last_name']   : $row->last_name;
            $row->update(array_merge($data, [
                'display_name'                => Employee::composeDisplayName($first, $middle, $last),
                'wizard_step_completed'       => $newStep,
                'onboarding_stage_completed'  => $newMacro,
            ]));

            // Re-run HOD wiring in case this save made the employee an HOD
            // (or changed their department) — idempotent when already applied.
            $this->applyHodOnboarding($row->refresh(), $authId);

            // Keep the leave_plan_employees pivot in sync whenever the
            // Step 3 PUT carries a leave_plan value. A partial PATCH
            // that doesn't touch Step 3 won't have the key, so we
            // intentionally skip the sync rather than clearing the
            // existing assignment. Same source-of-truth rationale as
            // store() — without this the employee's Leave tab stays
            // empty even though the dropdown shows the plan selected.
            if (array_key_exists('leave_plan', $data)) {
                $this->syncLeavePlanPivot($row, $data['leave_plan'], $authId);
            }

            // Keep the linked user in sync — name + email + phone changes here
            // should land on the login account too.
            if ($row->user) {
                $newEmail = $data['email'] ?? $row->user->email;
                // Changing the login email is an identity-level change, so the
                // OLD password must stop working: flag a forced reset and revoke
                // any live tokens. The user can't sign in again until they set a
                // new password via Forgot Password (OTP goes to the NEW email),
                // which clears the flag. Compared case-insensitively so a pure
                // casing edit doesn't needlessly lock the account.
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
                }

                // Cascade employee.status → users.status when it actually
                // changes. Inactive/Resigned/Terminated must block login;
                // anything else (Active/Probation/On Leave/Notice Period)
                // keeps the login open. Tokens are revoked on the
                // transition-to-disabled so any stale Sanctum session is
                // killed immediately. Without this guard, admins flipping
                // status via the edit form leave the user able to sign in.
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

        $row->load(self::fullWith());

        // Payroll connection — if this edit touched a field the payroll engine
        // reads (salary / PF / gender / state / bank / joining / status), push
        // the change into any non-locked payslip already generated for this
        // employee so payroll stays in sync everywhere. Locked runs are frozen.
        /* Mirror the applicability flags onto the ACTIVE salary structure.
         *
         * PF is charged only when BOTH the structure and the employee say so:
         *
         *     if ($pfApplicable && $employee->pf_eligible && …)
         *
         * where $pfApplicable comes from the structure. Saving a structure
         * already writes its flags back to the employee, but nothing did the
         * reverse — so switching PF Applicable from No to Yes on the employee
         * left the structure's flag at false and PF stayed ₹0 on every payslip
         * and in the Salary Report, with no clue why. The recompute below then
         * faithfully recomputed the same zero. (#90)
         *
         * ESI is the same pairing and is mirrored with it. */
        /* Mirrored onto EVERY structure payroll can still resolve, not just the
         * newest active one.
         *
         * PayrollService::activeStructure() picks the version in force on the
         * PERIOD date and deliberately includes 'superseded' rows, so a
         * future-dated revision leaves payroll pricing an open cycle off the
         * older version. Patching only `status=active orderByDesc(version)`
         * then wrote the flag to a row payroll wasn't reading, and the change
         * appeared to do nothing. (#90 reopen) */
        if (array_key_exists('pf_eligible', $data) || array_key_exists('esi_applicable', $data)) {
            $structures = \App\Models\SalaryStructure::where('employee_id', $row->id)
                ->whereIn('status', ['active', 'superseded'])
                ->get();

            foreach ($structures as $structure) {
                $patch = [];
                if (array_key_exists('pf_eligible', $data)) {
                    $pfOn = (bool) $row->pf_eligible;
                    $patch['pf_applicable'] = $pfOn;

                    /* Turning PF off must also drop a MANUAL 'pf' deduction row.
                     *
                     * PayrollService takes a structure's own pf line BEFORE it
                     * consults applicability (so hand-built structures aren't
                     * silently stripped), which meant PF Applicable = No left
                     * the deduction running and the Salary Report still showed
                     * PF. Clearing the row here keeps that precedence intact
                     * while making an explicit "No" actually mean no PF. */
                    if (!$pfOn) {
                        $deductions = (array) ($structure->deductions ?? []);
                        $kept = array_values(array_filter(
                            $deductions,
                            fn ($d) => strtolower((string) ($d['code'] ?? '')) !== 'pf'
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
            'esi_applicable',
            'gender',
            'state_id',
            'date_of_joining',
            'status',
            'bank_account_number',
            'ifsc_code',
            'salary_payment_mode'
        ];
        /* Payslips that could NOT follow this change, by cycle. (QA #90)
         *
         * recomputeEmployeePayslips() only rewrites draft/generated runs —
         * approved and paid runs are frozen by Rule 14/15 and a locked period is
         * skipped. That is correct, but this path said nothing about it, so
         * turning "PF Applicable" from No to Yes reported a plain "Updated"
         * while the Salary Report the user was looking at kept showing no PF.
         * Indistinguishable from the flag not working — which is how this came
         * back as a bug. SalaryStructureController already names the frozen
         * cycles on the same kind of change; this now matches it. */
        $frozenCycles = collect();
        if (!empty(array_intersect($payrollFields, array_keys($data)))) {
            try {
                app(\App\Services\PayrollService::class)->recomputeEmployeePayslips((int) $row->id);

                $frozenCycles = \App\Models\Payslip::where('employee_id', $row->id)
                    ->whereHas('run', fn ($q) => $q->whereNotIn('status', ['draft', 'generated']))
                    ->with('run.period')
                    ->get()
                    ->map(fn ($s) => $s->run?->period?->label)
                    ->filter()
                    ->unique()
                    ->values();
            } catch (\Throwable $e) {
                // Never block an employee save on a payroll recompute hiccup —
                // but do not swallow it either. A failed sync used to report a
                // plain "Updated" while the payslips kept the old PF, which is
                // the same symptom as the flag not working. (#90 reopen)
                \Log::warning('Payslip recompute after employee update failed', [
                    'employee_id' => $row->id,
                    'error'       => $e->getMessage(),
                ]);
            }
        }

        /* Welcome / credentials email fires when the wizard reaches
         * Step 4 (the final step). We use password_encrypted as the
         * "haven't sent yet" marker — once the welcome goes out, we
         * clear that column so subsequent Step 4 PUTs don't re-send.
         *
         * Trigger condition is intentionally lenient: $newStep >= 4
         * (not the strict $oldStep < 4 && $newStep >= 4 transition the
         * old code used). That strict transition silently failed when
         * the frontend updated Step 4 without bumping the watermark
         * cleanly — admins reported "no welcome ever arrived". With
         * the lenient check + password_encrypted clear, we get a
         * single, reliable send the first time the wizard saves at
         * Step 4 or higher.
         *
         * Recipient: $row->user->email — the personal email captured
         * by the wizard's "Personal Email" field. */
        if (
            $oldStep < 4
            && $newStep >= 4
            && Settings::shouldSendMail('newUser')
            && $row->user
            && !$row->user->last_login_at
            /* …and only while the account still carries the password it was
             * CREATED with. (#205)
             *
             * This block mints a fresh random password and overwrites
             * users.password with it. Gated on last_login_at alone, it also
             * fired for an account whose password had been set deliberately —
             * by HR through Employee Profile → Login Password, or by the
             * employee via Forgot Password — as long as they had not signed in
             * yet. Saving the employee wizard past Step 4 then silently
             * replaced that password with an emailed random one, which is the
             * reported "the new password does not get updated": it did update,
             * and a later unrelated save undid it.
             *
             * password_changed_at is stamped by recordPasswordHistory() on
             * every deliberate write (setPassword, changePassword, reset), so a
             * null here means "nobody has ever chosen this password" — the only
             * case where minting one is safe. */
            && !$row->user->password_changed_at
        ) {
            try {
                $rawPassword = $this->generatePassword();

                $row->user->forceFill([
                    'password' => Hash::make($rawPassword),
                    'password_encrypted' => Crypt::encryptString($rawPassword),
                ])->save();

                $clientName = \App\Models\Client::find($row->client_id)?->org_name ?? 'Your Organization';

                Mail::to($row->user->email)->send(new WelcomeCredentialsMail(
                    $row->user->name,
                    $row->user->email,
                    $rawPassword,
                    'employee',
                    $clientName,
                    PasswordChangedMail::resolveLoginUrl($request),
                ));

                $row->user->forceFill(['password_encrypted' => null])->save();
            } catch (\Throwable $e) {
                Log::warning('Employee welcome mail (Step 4) failed', [
                    'employee_id' => $row->id,
                    'email' => $row->user->email ?? null,
                    'new_step' => $newStep,
                    'error' => $e->getMessage(),
                ]);
            }
        }
        /* The saved columns, without the relations or the accessors.
         *
         * Every screen that PUTs here throws the body away — ten call sites,
         * each `await api.put(...)` with nothing on the left — while building
         * it re-ran ancillary_roles_resolved, other_assets_resolved and
         * photo_url (a query apiece), an AES encryption for encrypted_id, and
         * then all of it again for the reporting manager, who is another
         * Employee carrying the same accessors.
         *
         * The columns themselves are already in memory and cost nothing, so
         * they stay: a caller that wants to read back what it saved still can.
         */
        return response()->json([
            'message'  => 'Updated'
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
            // Soft-delete the employee record and disable the login account.
            // Hard-deleting the user would orphan permissions/activity logs.
            // Existing Sanctum tokens are revoked too — without that, any
            // already-issued token keeps authenticating because no middleware
            // re-checks user.status on subsequent requests.
            $row->user?->update(['status' => 'inactive']);
            $row->user?->tokens()->delete();
            $row->delete();
        });

        return response()->json(['message' => 'Employee removed and login disabled.']);
    }

    /**
     * The live (not rehired) exit case for this employee once it has been
     * COMPLETED — null while an exit is merely in progress, or when the last
     * one was undone by a rehire.
     */
    private function completedExitFor(Employee $employee): ?\App\Models\EmployeeExit
    {
        return \App\Models\EmployeeExit::where('employee_id', $employee->id)
            ->whereNull('rehired_at')
            ->where(fn($q) => $q->whereNotNull('completed_at')->orWhere('exit_case_status', 'Closed'))
            ->first();
    }

    /**
     * An EXITED employee stays disabled.
     *
     * Completing an exit disables the employee (ExitController::complete soft-
     * deletes them), which is what puts them in HR > Employees > Disabled. The
     * enable toggle here, and a PUT that flips status back to Active, were both
     * back doors out of that: either one returned an exited person to the
     * active roster without going through Exit Management's Reactivate, and so
     * skipped every rule that lives there — the blacklist bar, the termination
     * bar, the probation bar, and the `rehired_at` stamp that marks the case
     * spent. The person came back as live staff with a closed exit still on
     * file, which then reads as "Exited" everywhere else.
     *
     * The reverse does NOT hold: an ordinary disabled employee has no exit case
     * and is re-enabled here as normal. Only an exit is an exit.
     */
    /**
     * Freeze the employee record once an exit has been initiated against it.
     *
     * An exit case is built from the profile as it stood when notice was
     * given: notice period drives the last working day, salary drives the F&F,
     * department and reporting manager drive the handover. Editing any of that
     * mid-case silently rewrites the basis of a settlement that is already
     * being calculated — and because `employees.status` stays 'Active' until
     * ExitController::complete(), nothing else on the employee row hints that
     * a case is open. This is the only thing standing between an open exit and
     * a changed notice period.
     *
     * Covers every write that lands on PUT /employees/{id} — the Edit form,
     * the onboarding wizard's step saves, and asset assignment, which all post
     * here. The Exit module's own endpoints (/exit, /exit/complete, /rehire,
     * /notice-payment, F&F) are separate controllers and are deliberately
     * untouched: freezing those would freeze the exit itself.
     *
     * Lifts on its own. Complete the exit (the employee becomes disabled, and
     * the isDisabled() guard above takes over with its Reactivate message) or
     * rehire them (`rehired_at` set, the case stops being live) and editing
     * returns to normal — there is no separate unfreeze to remember.
     */
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

    /**
     * Re-enable a soft-deleted employee. Inverse of destroy() — clears
     * deleted_at, flips the row status back to Active, and re-enables
     * the linked login user. The row is fetched with trashed scope so
     * we can find it after destroy() hid it.
     *
     * Refuses on an EXITED employee — see assertNotExited().
     */
    public function restore(Request $request, $id)
    {
        $this->authorize($request, 'can_edit');
        $row = $this->resolveRow($request, (int) $id);
        $this->assertNotExited($row, 're-enable');

        DB::transaction(function () use ($row) {
            if ($row->trashed()) {
                $row->restore();
            }
            // Some rows may have been disabled via PUT-status alone
            // (no soft-delete). Either way, normalise back to Active.
            if (strtolower((string) $row->status) !== 'active') {
                $row->update(['status' => 'Active']);
            }
            // Re-enable the paired login account so the employee can
            // sign in again.
            $row->user?->update(['status' => 'active']);
        });

        $row->load(self::fullWith());
        return response()->json([
            'message'  => 'Employee re-enabled.',
            'employee' => $row,
        ]);
    }

    /**
     * Permanently delete a soft-deleted employee. Only callable on a row
     * already in the Disabled tab — we refuse to force-delete an active
     * employee outright to prevent accidental data loss from a single
     * misclick on the wrong tab.
     *
     * The paired login user is NOT hard-deleted: it gets locked to
     * inactive and its tokens revoked, but the row stays so permissions
     * + activity_logs + audit trails that reference user_id don't go
     * dangling. Only the Employee row itself is removed for good.
     */
    public function forceDestroy(Request $request, $id)
    {
        $this->authorize($request, 'can_delete');
        $row = $this->resolveRow($request, (int) $id);
        $this->guardHierarchicalAction($request->user(), $row, 'delete');

        // Only block a genuinely-ACTIVE employee. "Disabled" can mean either
        // soft-deleted (toggle/destroy) OR a status of Inactive/Terminated/
        // Resigned (set via the edit form or Exit Management) — all of which the
        // frontend shows in the Disabled tab. Any of those are deletable here;
        // a still-active employee must be disabled first to avoid a misclick.
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
            // Lock + revoke the login but keep the user row — permissions,
            // activity_logs and other tables FK to users.id and we don't
            // want orphans.
            $row->user?->update(['status' => 'inactive']);
            $row->user?->tokens()->delete();
            // Wipe the Employee row itself. Soft-deletes related rows
            // (documents, exit, previous_employments) usually cascade via
            // model events or FK ON DELETE — verify on your schema if you
            // add new related tables.
            $row->forceDelete();
        });

        return response()->json([
            'message' => "Permanently removed {$displayName}.",
        ]);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  HELPERS
     * ───────────────────────────────────────────────────────────────── */

    /** Cap the granular permission check to the 'hr.employee' module. */
    /**
     * Like authorize('can_view'), but always allows a user to read THEIR OWN
     * employee record even without the hr.employee grant. Ordinary
     * employees don't hold the HR module permission, yet the self-service
     * profile (/profile → EmployeeProfile) and its panels (Holidays, etc.)
     * must still load their own data. Anyone else falls back to the normal
     * can_view gate.
     */
    private function authorizeViewOrSelf(Request $request, int $employeeId): void
    {
        $user = $request->user();
        if ($user && $employeeId > 0) {
            $ownId = Employee::where('user_id', $user->id)->value('id');
            if ($ownId && (int) $ownId === $employeeId) return;
        }
        $this->authorize($request, 'can_view');
    }

    private function authorize(Request $request, string $perm): void
    {
        $user = $request->user();
        if (!$user) abort(401, 'Authentication required');
        if ($user->isSuperAdmin()) return;

        // Single consolidated Employee permission: HRMS → HR Core → Employee
        // (slug `hr.employee`). It now gates BOTH this API and the frontend
        // menu/route — the former `master.employees` (API-only) and standalone
        // `employees` modules were merged into it.
        $moduleId = Module::where('slug', 'hr.employee')->value('id');
        if (!$moduleId) {
            // First-run: module row not seeded yet. Fall back to plan-default
            // (allow client_admin / branch_user; deny others).
            if (in_array($user->user_type, ['client_admin', 'branch_user'], true)) return;
            abort(403, 'Employees module not enabled.');
        }

        $allowed = Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where($perm, true)
            ->exists();
        if (!$allowed) abort(403, $this->permissionDeniedMessage($perm, $user->id, $moduleId));
    }

    /**
     * The sentence a user sees when this module refuses them.
     *
     * It used to abort with "Missing can_edit on hr.employee" — a column name
     * and a slug, which is what the toaster then showed to a branch employee
     * who had simply been given view-only access. The user cannot act on that,
     * and it names internals to someone who has no business seeing them.
     *
     * The distinction that matters is view-only versus no-access-at-all: the
     * first is a normal, deliberate grant and the message should say so plainly,
     * the second means the module should not have been reachable at all.
     */
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

    /** Pick (client_id, branch_id) for a new row, mirroring MasterController::resolveOwnership. */
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
            // Employees creating other employees inherit their tenant.
            return [$user->client_id, $user->branch_id];
        }
        return [null, null];
    }

    /** Same scoping rules as the master tables — keeps every list query consistent.
     *  When the SPA's BranchSwitcher injects `?branch_id=N`, we narrow further
     *  within the user's existing tenant scope so a client_admin can drill
     *  into a single branch's data. The narrow only
     *  applies if the requested branch belongs to the user's own client (else
     *  silently ignored — no cross-tenant leak even with a hostile param). */
    private function applyScope($q, $user, ?int $branchFilter = null): void
    {
        if (!$user) return;
        if ($user->user_type === 'super_admin') {
            // super_admin can pass branch_id directly; trust it (they cross tenants by design)
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

            // Every branch is an isolated peer — strict branch isolation. They
            // see ONLY rows belonging to their own branch within this tenant.
            // An employee booked under another branch must not appear in this
            // branch user's list. Globally-owned rows (client_id IS NULL) stay
            // visible — they're system rows, not tenant data.
            $q->where(function ($w) use ($clientId, $branchId) {
                $w->whereNull('client_id')
                    ->orWhere(function ($ww) use ($clientId, $branchId) {
                        $ww->where('client_id', $clientId)->where('branch_id', $branchId);
                    });
            });
            // Branch users can't switch — ignore any incoming branch_id.
            return;
        }

        $q->whereRaw('1 = 0');
    }

    /** Apply BranchSwitcher's selected-branch filter only after verifying the
     *  branch belongs to the granter's own client. Cross-tenant ids are ignored
     *  (not 403'd) so a stale localStorage value from a prior login doesn't
     *  brick the page — they just see "all branches in my client" until they
     *  re-pick. */
    private function applySwitcherBranchFilter($q, $user, ?int $branchFilter): void
    {
        if ($branchFilter === null) return;
        $belongsToClient = Branch::where('id', $branchFilter)
            ->where('client_id', $user->client_id)
            ->exists();
        if (!$belongsToClient) return;
        $q->where('branch_id', $branchFilter);
    }

    /** Find an employee row honouring the same tenant scope used in lists.
     *  Includes soft-deleted rows since the index() now surfaces them
     *  for the Disabled tab — restore + show + edit on a disabled row
     *  must all be able to find it. */
    private function resolveRow(Request $request, int $id): Employee
    {
        $q = Employee::query()->withTrashed()->with(self::fullWith());
        $this->applyScope($q, $request->user());
        return $q->findOrFail($id);
    }

    /**
     * What state this employee's login password is in, for the Set/Reset
     * Password modal.
     *
     * The modal used to render the same empty form regardless, so HR could not
     * tell a never-touched onboarding password from one the employee has been
     * using for months — and "Reset" in the title implied a password existed
     * even when nobody had ever set one.
     *
     * `users.password` cannot answer this: account creation seeds it with a
     * random 40-char value, so it is NEVER empty. The real signals are the
     * change counter, the forced-reset flag, and whether the person has ever
     * logged in.
     *
     * Read with an explicit column list rather than the `user` relation, which
     * restricts columns and would silently return nulls here.
     */
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

        // Order matters: a forced reset outranks the rest — it is the one state
        // that tells HR the current password has already stopped working.
        $state = match (true) {
            (bool) ($u->must_reset_password ?? false) => 'reset_required',
            $count === 0                              => 'never_changed',
            default                                   => 'changed',
        };

        return [
            'state'        => $state,
            'change_count' => $count,
            // ISO 8601 with the offset, not the raw '2026-08-17 05:22:22' the
            // query builder hands back. That string has no zone marker, so
            // new Date() reads it as LOCAL time and an early-morning UTC stamp
            // renders a day early in IST — and Safari rejects the format
            // outright. Timestamps are stored UTC here (see DATABASE_DESIGN);
            // the offset lets the browser localise it correctly.
            'changed_at'   => $u->password_changed_at
                ? Carbon::parse($u->password_changed_at)->toIso8601String()
                : null,
            'never_logged_in' => $u->last_login_at === null,
        ];
    }

    public function setPassword(Request $request, $id)
    {
        $this->authorize($request, 'can_edit');

        $employee = $this->resolveRow($request, $this->resolveIdParam($id));
        $this->guardHierarchicalAction($request->user(), $employee, 'reset the password for');

        // Load the FULL user row — the eager-loaded `user` relation restricts
        // columns (no `password`), which would break the reuse-check + history.
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

        // Save the OLD hash to history BEFORE overwriting it.
        $this->recordPasswordHistory($target);
        /* `must_reset_password` is cleared with the write. (#205)
         *
         * Login hard-blocks on that flag (AuthController::login), and it is set
         * whenever an employee's email is changed. So an HR reset on a flagged
         * account reported "Password updated", mailed the new credential, and
         * the employee still could not sign in — the new password was correct
         * and refused. Setting a password IS the reset the flag is waiting for,
         * which is exactly how the two working implementations treat it:
         * AuthController::changePassword and ForgotPasswordController::reset
         * both write the pair together. This was the only path that did not. */
        $target->update([
            'password'            => Hash::make($data['password']),
            'must_reset_password' => false,
        ]);

        // SMTP issue never rolls back the (already persisted) password change.
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
        if ($cap <= 0) return; // 0 / null → unlimited

        // Count only ACTIVE login accounts against the cap. Deleting an employee
        // keeps their user row but flips it to 'inactive' (so audit logs /
        // permissions don't go dangling) — those freed-up seats must NOT keep
        // occupying the branch's user limit. Null status counts as active.
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

    /** Block lower-ranked users from editing/deleting rows owned by higher-ranked ones. */
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

    /**
     * Enforce a single Head of Department (HOD) per department, scoped to the
     * branch. Only fires when the employee being saved is itself an HOD; the
     * reporting-manager columns are irrelevant here (an HOD reports to a
     * branch_user, which is validated separately on the form). Throws a 422 on
     * `designation_id` when another HOD already exists in the same
     * (client, branch, department).
     *
     * @param  array  $data       validated payload
     * @param  object|null  $existing  the row being updated (for fallbacks)
     */
    private function assertSingleHodPerDepartment(array $data, ?int $clientId, ?int $branchId, ?int $excludeEmployeeId, $existing = null): void
    {
        $designationId = $data['designation_id'] ?? ($existing->designation_id ?? null);
        $departmentId  = $data['department_id']  ?? ($existing->department_id  ?? null);
        $branchScope   = $data['branch_id']      ?? $branchId ?? ($existing->branch_id ?? null);
        if (!$designationId || !$departmentId) {
            return;   // can't be an HOD-in-a-department without both
        }

        // Is the chosen designation the HOD designation? (match by name/level)
        $hodName = \App\Support\SalesVisibility::DESIGNATION_MANAGER; // 'Head of Department (HOD)'
        $chosen = \App\Models\Masters\Designations::find($designationId);
        $isHod = $chosen && (
            strcasecmp((string) $chosen->name,  $hodName) === 0 ||
            strcasecmp((string) $chosen->level, $hodName) === 0
        );
        if (!$isHod) {
            return;
        }

        // All designation ids that mean HOD (covers any client-scoped copies).
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

    /**
     * The reporting manager must hold a STRICTLY higher position than the hire
     * (Branch User > HOD > Team Leader > Executive > Employee > Intern/Trainee),
     * and an employee can never be their own manager. Mirrors the client-side
     * dropdown filter so an ineligible pick is rejected even if the UI is
     * bypassed. See \App\Support\PositionHierarchy.
     */
    private function assertReportingManagerEligible(array $data, ?int $employeeId = null, $existing = null): void
    {
        $mgrEmpId  = $data['reporting_manager_id']      ?? null;
        $mgrUserId = $data['reporting_manager_user_id'] ?? null;

        // Self-reference guard (an employee can't report to themselves).
        if ($employeeId && $mgrEmpId && (int) $mgrEmpId === (int) $employeeId) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'reporting_manager_id' => ['An employee cannot be their own reporting manager.'],
            ]);
        }
        if (!$mgrEmpId && !$mgrUserId) return; // no manager set / cleared

        // Hire rank from its designation (fall back to the existing row on a
        // partial update that omits designation_id).
        $designationId = $data['designation_id'] ?? ($existing->designation_id ?? null);
        $hireName = $designationId
            ? \App\Models\Masters\Designations::where('id', $designationId)->value('name')
            : null;
        $hireRank = \App\Support\PositionHierarchy::rankForDesignationName($hireName);

        // Manager rank — an employee via its designation, a login user via user_type.
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

    /**
     * When an employee is (or becomes) the HOD of a department, wire up the
     * department around them:
     *   (a) Re-parent — employees in the same (client, branch, department) that
     *       currently report to a Branch User (or have no manager) are re-pointed
     *       to this HOD. Employees already reporting to someone else are left as-is.
     *   (b) Auto-grant — the HOD's module permissions are overwritten from the
     *       department's saved department_permissions (only those modules).
     * No-op when the employee isn't an HOD. Idempotent, so it's safe to call on
     * every save.
     */
    private function applyHodOnboarding(Employee $employee, ?int $actingUserId): void
    {
        $designationId = $employee->designation_id;
        $departmentId  = $employee->department_id;
        if (!$designationId || !$departmentId || !$employee->user_id) {
            return;
        }
        if (!in_array((int) $designationId, \App\Support\DepartmentPermissionSync::hodDesignationIds(), true)) {
            return; // not an HOD
        }

        // (a) Re-parent employees under a Branch User (or with no manager).
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

        // (b) Auto-grant the department permissions onto the HOD.
        $hodUser = User::find($employee->user_id);
        if ($hodUser) {
            \App\Support\DepartmentPermissionSync::applyToHodUser($hodUser, (int) $departmentId, $actingUserId);
        }
    }

    /**
     * Validation rules.
     *
     * The wizard now saves incrementally (one step at a time), so most
     * fields are nullable to accept partial payloads. Only `first_name` is
     * hard-required since it drives `display_name`. `email` is required
     * for store (we need it on the User row eventually), but on update
     * (when the User account already exists) we accept omitting it.
     */
    private function validatePayload(Request $request, ?int $employeeId = null): array
    {
        $ignoreUserId = null;
        $isUpdate = $employeeId !== null;
        if ($isUpdate) {
            // withTrashed() — the Edit-from-Onboarding flow can target rows
            // whose linked employee was soft-deleted; without this the lookup
            // returns null and the unique check below stops ignoring the
            // existing user, surfacing "email already taken" on every save.
            $ignoreUserId = Employee::withTrashed()->where('id', $employeeId)->value('user_id');
        }

        $this->stripDanglingAssetRefs($request);
        /* Addresses are stored lower-case. The domain half is case-insensitive
           by spec and every provider treats the local half that way too, so
           "Test@Gmail.com" and "test@gmail.com" are one mailbox — storing both
           spellings creates duplicates the uniqueness check below cannot see,
           and a login typed in the other case that never matches.
           official_email was left out of this and drifted from `email`. */
        foreach (['email', 'official_email'] as $emailField) {
            if ($request->filled($emailField)) {
                $request->merge([$emailField => mb_strtolower(trim($request->input($emailField)))]);
            }
        }
        if ($request->filled('pan_number')) {
            $request->merge(['pan_number' => mb_strtoupper(trim($request->input('pan_number')))]);
        }
        // Tenant the dup checks below run against. This MUST be the client the
        // row is actually written under (resolveOwnership), not the acting
        // user's own client_id: a super_admin has client_id = NULL, and the old
        // `$x ? where(...) : $q` / `when($x, ...)` form silently DROPPED the
        // client predicate for them, turning a per-tenant check into a GLOBAL
        // one. Effect: creating an employee whose email exists under a
        // completely different client was rejected with "this email already has
        // an account in this organization" even though the organization had no
        // such user. On update we take the tenant off the existing row so an
        // edit can never be re-scoped by who happens to be saving it.
        $scopeClientId = $isUpdate
            ? Employee::withTrashed()->where('id', $employeeId)->value('client_id')
            : $this->resolveOwnership($request)[0];
        $scopeClientId = $scopeClientId === null ? null : (int) $scopeClientId;

        // Always apply a client predicate — NULL client_id rows form their own
        // bucket, exactly like the COALESCE(client_id, 0) in the DB indexes.
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
        // Email is unique PER TENANT (not globally) — the same email may belong
        // to another client. Scope the dup check to the owning client_id so a
        // collision in a DIFFERENT client no longer blocks creation here. Mirrors
        // the pan_number rule above and the users_email_client_unique DB index.
        // Only an ACTIVE account holds its email slot. When an employee EXITS,
        // their user is marked `email_active = false`, which frees the email for
        // reuse — so an exited person's email no longer blocks a new registration
        // (the flag is reset to true on rehire). See migration add_email_active.
        $emailRule[] = Rule::unique('users', 'email')
            ->whereNull('deleted_at')
            ->where('email_active', true)
            ->where(fn($q) => $tenantWhere($q)
                ->whereRaw('LOWER(email) = ?', [mb_strtolower((string) $request->input('email'))]))
            ->ignore($ignoreUserId);

        // Attendance Number is the mapping key for eSSL biometric devices — a
        // device User ID resolves to exactly one employee via this field, so it
        // must be unique per tenant (mirrors the pan_number rule + the
        // employees_attendance_number_client_unique DB index). Scoped to the
        // creator's client_id so a clash in a DIFFERENT client can't block here.
        // See docs/ESSL_ATTENDANCE_INTEGRATION.md §14.2.
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
        $requireSalary = $isFinalStep && $payrollOn;
        $salaryMax     = 999999999999.99; // decimal(14, 2)
        $salaryRule    = $requireSalary
            ? ['required', 'numeric', 'min:0.01', "max:{$salaryMax}"]
            : ['nullable',  'numeric', 'min:0',    "max:{$salaryMax}"];
        $salaryFreqRule = $requireSalary ? ['required', 'string', 'max:30']   : ['nullable', 'string', 'max:30'];
        /* The first salary runs from the day the employee joined, so the
         * effective date IS the joining date. Both forms mirror it and show it
         * read-only; enforced here too because the form is not the only way in
         * — a direct API call could still date the salary structure wrongly,
         * and salary_structures.effective_from is what payroll reads.
         *
         * Only checked when a joining date is present in the same payload or
         * already on the record: a partial update that touches neither has
         * nothing to compare against. */
        $joiningForSalary = $request->input('date_of_joining')
            ?: ($employeeId ? Employee::whereKey($employeeId)->value('date_of_joining') : null);
        $joiningForSalary = $joiningForSalary
            ? Carbon::parse($joiningForSalary)->toDateString()
            : null;

        $salaryFromRule = $requireSalary ? ['required', 'date'] : ['nullable', 'date'];
        if ($joiningForSalary) {
            $salaryFromRule[] = 'date_equals:' . $joiningForSalary;
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
            'email'        => $emailRule,
            // Stage 3 provisioning — company-issued mailbox assigned at
            // onboarding (e.g. "test.demo@company.com"). Independent of
            // the personal email used for login.
            'official_email' => 'nullable|email|max:191',
            // Tightened from max:30 → max:15 (E.164 international cap).
            // Without this the DB layer rejected 20–30-digit input with a
            // hard 500 error instead of a friendly 422.
            'mobile'       => ['nullable', 'string', 'max:15', 'regex:/^[+0-9\s\-()]{6,15}$/'],
            'alt_mobile'   => ['nullable', 'string', 'max:15', 'regex:/^[+0-9\s\-()]{6,15}$/'],

            // Current address
            'country_id'   => 'nullable|integer',
            'state_id'     => 'nullable|integer',
            'city'         => array_merge(['nullable', 'string', 'max:100'], $noTags),
            'address_line1' => array_merge(['nullable', 'string', 'max:255'], $noTags),
            'address_line2' => array_merge(['nullable', 'string', 'max:255'], $noTags),
            'pincode'      => 'nullable|string|max:20',

            // Permanent address (mirrors current address shape)
            'perm_country_id'   => 'nullable|integer',
            'perm_state_id'     => 'nullable|integer',
            'perm_city'         => array_merge(['nullable', 'string', 'max:100'], $noTags),
            'perm_address_line1' => array_merge(['nullable', 'string', 'max:255'], $noTags),
            'perm_address_line2' => array_merge(['nullable', 'string', 'max:255'], $noTags),
            'perm_pincode'      => 'nullable|string|max:20',

            // Legal entity = one of THIS client's branches (see Employee::legalEntity).
            // Scoped so a crafted id can't attach an employee to another tenant's
            // branch. The client id comes from resolveOwnership, not straight off
            // the user: a super_admin has client_id === null, and passing null into
            // the predicate would match nothing and reject every branch.
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
            // Department + designation arrive in step 2 of the wizard, so
            // they're nullable here — the frontend per-step validator gates
            // them when the user actually clicks Next on step 2.
            'department_id'   => 'nullable|integer',
            'designation_id'  => 'nullable|integer',
            'primary_role_id' => 'nullable|integer',
            'ancillary_role_id'    => 'nullable|integer',
            'ancillary_role_ids'   => 'nullable|array',
            'ancillary_role_ids.*' => 'integer',
            'work_type' => 'nullable|string|max:50',
            // Rule 8 — canonical employment type; PF eligibility reads this.
            // Closed vocabulary so the substring guessing work_type forced is
            // no longer needed.
            'employee_type' => 'nullable|string|in:Full-time,Part-time,Contract,Intern,Consultant',
            'reporting_manager_id'      => 'nullable|integer',
            'reporting_manager_user_id' => 'nullable|integer',
            // Stage 2 Yes/No — "Has the employee worked anywhere before?".
            // Persisted so the radio group can rehydrate on revisit; the
            // legacy "derive from previous_employments row count" was
            // unable to distinguish "No, first job" from "not answered yet".
            'has_prior_experience'      => 'nullable|boolean',
            // Sanity-bound the joining date: reject absurd historical values
            // (e.g. 1900) and far-future dates while still allowing genuine
            // historical join dates for existing staff being added.
            /* Floor lifts to the REHIRE date for a re-onboarded employee. (#121)
             *
             * The 50-year window is right for ordinary staff — recording a
             * genuine historical hire is legitimate. It is wrong for someone
             * brought back through Exit Management: their record still carries
             * the previous employment's joining date, the wizard offers it as
             * the default, and saving it unchanged re-dated the new employment
             * to the old one. Tenure, probation and the return month's payroll
             * proration all key off this column, and Salary Effective From is
             * locked equal to it, so one stale date moves all of them.
             *
             * You cannot have joined before you were rehired, so `rehired_at`
             * is the floor. Employees with no rehire on record keep the
             * 50-year window exactly as before. */
            'date_of_joining' => 'nullable|date|after_or_equal:' . $this->joiningFloorFor($employeeId) . '|before_or_equal:' . now()->addYears(2)->toDateString(),

            'probation_policy'   => 'nullable|string|max:50',
            'probation_months'   => 'nullable|integer|min:0|max:60',
            // Computed on the frontend from joining date + probation policy.
            'probation_end_date' => 'nullable|date',
            'notice_period'      => 'nullable|string|max:50',
            'notice_period_days' => 'nullable|integer|min:0|max:365',

            // Step 3 — Work Details
            'leave_plan'           => 'nullable|string|max:100',
            'holiday_list'         => 'nullable|string|max:100',
            'holiday_group_id'     => 'nullable|integer',
            'attendance_tracking'  => 'nullable|boolean',
            'shift'                => 'nullable|string|max:50',
            'weekly_off'           => 'nullable|string|max:100',
            'attendance_number'    => $attNumRule,
            'time_tracking'        => 'nullable|string|max:50',
            'penalization_policy'  => 'nullable|string|max:100',
            // Holds an Overtime (OT) Master rate_name — keep the ceiling in
            // step with master_overtime_rates.rate_name (100) or a long rate
            // name 422s on save.
            'overtime'             => 'nullable|string|max:100',
            'expense_policy'       => 'nullable|string|max:100',
            'laptop_assigned'      => 'nullable|string|max:20',
            'mobile_assigned'      => 'nullable|string|max:20',
            'laptop_asset_id'      => 'nullable|string|max:50',
            'mobile_device'        => 'nullable|string|max:100',
            'other_assets'         => 'nullable|string|max:255',

            // Step 4 — Compensation
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

            // Stage 4 — Payroll & Finance Setup
            'salary_payment_mode'   => 'nullable|in:bank,cheque,cash',
            /* Bank details are REQUIRED when the salary is paid by bank
             * transfer, and optional for cheque. (#125)
             *
             * The wizard already enforces exactly this and marks the fields
             * with an asterisk while the mode is Bank Transfer, but the API
             * accepted the same stage with every bank field blank — so an
             * employee could be completed through any other client, an import
             * or a direct call with no account to pay into, and the omission
             * only surfaced at disbursement when payroll held the payment.
             *
             * required_if, not required: cheque is a legitimate mode with
             * nothing to fill in, which is the other half of this ticket. The
             * format rules still apply to whatever IS entered in either mode,
             * so a cheque employee cannot use the block as a scratchpad. */
            'bank_name'             => ['required_if:salary_payment_mode,bank', 'nullable', 'string', 'max:150'],
            // QA #187 — 8 to 18 digits. Same rule as updateBankDetails(); this
            // form writes the same column, so a rule on only one of the two is
            // not a rule. (Replaces the old NRE/NRO letters exemption — see the
            // note there.)
            'bank_account_number'   => ['required_if:salary_payment_mode,bank', 'nullable', 'string', 'regex:/^\d{8,18}$/'],
            // IFSC: 4 letters, 0, 6 alphanumeric (case-insensitive).
            'ifsc_code'             => ['required_if:salary_payment_mode,bank', 'nullable', 'string', 'regex:/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/'],
            'account_holder_name'   => ['required_if:salary_payment_mode,bank', 'nullable', 'string', 'max:150'],
            // QA #186 — same rule as updateBankDetails(). Applied here too
            // because the main employee form writes the very same column, and
            // a rule enforced on only one of two doors is not enforced.
            // Required alongside the rest of the block on bank transfer — the
            // wizard asterisks it too. (#125)
            'bank_branch'           => ['required_if:salary_payment_mode,bank', 'nullable', 'string', 'max:150', 'regex:/^(?=.*[A-Za-z])[A-Za-z0-9 .,\-\/()&\']+$/'],
            'bank_account_type'     => 'nullable|string|max:30',
            // UAN: exactly 12 digits when present.
            'uan_number'            => 'nullable|string|regex:/^\d{12}$/',
            // PAN: 5 letters, 4 digits, 1 letter + tenant-unique (see $panRule above).
            'pan_number'            => $panRule,
            'pf_deduction'          => 'nullable|string|max:50',
            // PF calculation method (Stage 4). statutory = 12% capped at the
            // ₹15k EPF ceiling; standard = 12% of full basic. Read by PayrollService.
            'pf_type'               => 'nullable|in:statutory,standard',
            'esi_applicable'        => 'nullable|in:Yes,No',
            'gratuity_nominee_name' => 'nullable|string|max:150',
            'agreed_ctc_lpa'        => 'nullable|numeric|min:0',
            'stage4_completed_at'   => 'nullable|date',

            'assets'  => 'nullable|array',
            'assets.*' => 'integer',

            // Asset assignments (Stage 1 Step 3). Uniqueness across
            // employees is enforced separately in
            // assertAssetsNotDoubleBooked() so we can return a friendly
            // 422 with the conflicting employee name.
            'laptop_master_asset_id'   => 'nullable|integer|exists:master_assets,id',
            'mobile_master_asset_id'   => 'nullable|integer|exists:master_assets,id',
            'other_master_asset_ids'   => 'nullable|array',
            'other_master_asset_ids.*' => 'integer|exists:master_assets,id',

            // Stage 3 — Physical Setup & Identification
            'biometric_status'    => 'nullable|in:Not Registered,Registered,Pending,Failed',
            'desk_workstation_no' => 'nullable|string|max:50',
            'id_card_status'      => 'nullable|in:Not Printed,Printed,Issued,Lost,Reissued',
            'status'  => 'nullable|in:Active,Inactive,On Leave,Probation,Notice Period,Resigned,Terminated',
            'onboarding_stage_completed' => 'nullable|integer|min:0|max:6',
        ], [
            // Annual CTC — the default Laravel wording ("must be at least 0.01")
            // reads as a rounding rule; these say what the field actually needs.
            // Kept in sync with the inline messages in HrEmployees.tsx.
            'annual_salary.required' => 'Annual CTC is required.',
            'annual_salary.numeric'  => 'Annual CTC must be a valid number.',
            /* Name the CONDITION, not just the field. "The bank name field is
               required" gives no clue why it became required halfway through a
               form where it had been optional a moment earlier. (#125) */
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
            // Same wording as updateBankDetails so the field reads identically
            // whichever form the user reached it through (QA #186).
            'bank_branch.regex'            => 'Branch can contain letters, numbers, spaces and . , - / ( ) & only.',
            'bank_account_number.regex'    => 'Account Number must be 8 to 18 digits, with no spaces or symbols.',
            // Email is the login ID and is unique system-wide (across every
            // branch/client) — it can't be branch-scoped without making login
            // ambiguous. Spell that out so an admin who can only see their own
            // branch doesn't read this as a false positive.
            'email.unique'                 => 'This email already has an account in this organization. Each email can be used only once per organization — use a different email.',
        ]);
    }

    /**
     * Filter the asset-FK fields on the request down to ids that actually
     * exist in master_assets. Called from validatePayload() so the
     * `exists:` rules below can stay strict for new picks while old rows
     * with deleted asset refs still save successfully.
     */
    private function stripDanglingAssetRefs(Request $request): void
    {
        // Pull the candidate ids from the request without trusting their
        // shape — the SPA sends ints but PATCH replays could send strings.
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

    /**
     * Reject the save if any of the chosen assets is already booked by
     * Bridge multi-role array → legacy single-int column.
     *
     * If `ancillary_role_ids` is sent, normalise it to clean ints and
     * mirror its first element into the legacy `ancillary_role_id` column
     * so SQL/reports still referencing the old column keep working.
     * If only the legacy single id arrives (older client), expand it
     * into a one-item array so the new code path stays the source of truth.
     */
    /**
     * Keep `notice_period_days` in step with the `notice_period` LABEL.
     *
     * The employee form only ever sends the label ("15 Days") — the integer
     * column is written at onboarding and then never again, so the two drift
     * the moment HR changes the notice period on an existing employee. Every
     * reader (ExitController::noticePeriodDays, ExitNoticePaymentController,
     * NoticePeriodGuard, the SPA) prefers the integer and falls back to parsing
     * the label, which is right when the integer is NULL and wrong when it is
     * STALE: an employee showing "15 Days" on their record was still being
     * charged a 30-day notice period on their exit.
     *
     * Derived here rather than in each reader so there is one source of truth
     * and the columns cannot disagree. An explicit `notice_period_days` in the
     * request still wins — this only fills the gap the form leaves.
     */
    private function syncNoticePeriodDays(array $data): array
    {
        if (!array_key_exists('notice_period', $data)) return $data;
        if (array_key_exists('notice_period_days', $data) && $data['notice_period_days'] !== null) return $data;

        $label = (string) ($data['notice_period'] ?? '');
        // "No Notice Period" and friends mean zero, not "unparseable".
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

    /**
     * Reject duplicate employee entries within the same tenant.
     *
     * Only mobile number is treated as a hard duplicate signal — it's the
     * single most reliable per-person identifier. The legacy
     * (first_name + last_name + date_of_birth) check was removed because
     * two unrelated employees can legitimately share both: common names
     * + birthdays collide more often than the check's authors assumed,
     * and the false positives blocked legitimate hires (admins reported
     * being unable to onboard a new Bhavika because an EMP-004 already
     * had the same name + DOB). Mobile uniqueness still protects against
     * the same-person-typed-twice case the second check was meant for.
     *
     * The check skips when mobile is empty so partial drafts persist.
     * Soft-deleted employees don't block fresh hires.
     */
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
            // Generic message — do NOT disclose the conflicting employee's
            // name / emp_code (PII leak the QA flagged). Existence is enough.
            if ($q->exists()) {
                throw \Illuminate\Validation\ValidationException::withMessages([
                    'mobile' => ['This mobile number is already in use by another employee.'],
                ]);
            }
        }
    }

    /**
     * a different employee. Throws a ValidationException with the
     * conflicting field names so the SPA can highlight them.
     */
    /**
     * Refuse to issue a device that somebody else is already holding.
     *
     * @param  int|null  $clientId  tenant the saved row belongs to
     */
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

        /* Scoped to the SAME tenant. Unscoped, this scanned every employee of
         * every client: saving an asset could fail with "already assigned to
         * <name>" naming somebody in a different company entirely — a blocked
         * save AND another tenant's employee name leaked into the message.
         *
         * Client scope only — deliberately NOT narrowed to the branch as well.
         * That would reopen the opposite bug: a super_admin operating with no
         * branch selected sees every device, and a same-client holder one
         * branch over would slip past and end up double-booked. Cross-branch
         * conflicts cannot arise from the UI anyway, because availableAssets()
         * offers only devices belonging to the caller's branch — so the wider
         * scope costs nothing and catches the case the narrow one misses. */
        $q = Employee::query()
            // A DISABLED employee still physically holds the device; someone who
            // has EXITED has returned it. Same rule availableAssets() applies,
            // so the picker and this guard can never disagree about who holds
            // what.
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

    /** Compute the next EMP-### atomically inside the create transaction. */
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

    /** 12-char URL-safe random — no ambiguous chars (0/O, 1/l). */
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

    /**
     * Mirror the Step 3 Leave Plan dropdown selection into the
     * `leave_plan_employees` pivot so the employee's own Leave tab
     * (which reads from the pivot, not the legacy `leave_plan` string
     * column) shows their plan + accrued balances after login.
     *
     * - Numeric value      → upsert pivot to that plan_id (one plan per
     *                        employee; unique constraint on employee_id
     *                        guarantees old assignments are replaced).
     * - Explicit null / "" → wipe the pivot row (admin cleared the
     *                        dropdown — the legacy string column also
     *                        becomes null in the same save).
     * - Non-numeric string → legacy plan-name data left over from before
     *                        the dropdown was switched to plan_id; leave
     *                        the pivot alone, don't guess at a match.
     *
     * Cross-tenant guard: if the chosen plan belongs to a different
     * client_id than the employee, the assignment is dropped silently
     * — same defensive shape as LeavePlanController::assignEmployees,
     * but here we can't 422 because the caller is mid-wizard.
     */
    private function syncLeavePlanPivot(Employee $employee, $rawValue, ?int $assignedBy): void
    {
        // Explicit clear — admin deselected the plan.
        if ($rawValue === null || $rawValue === '') {
            DB::table('leave_plan_employees')
                ->where('employee_id', $employee->id)
                ->delete();
            return;
        }

        if (!is_numeric($rawValue)) return; // legacy plan-name string — ignore.
        $planId = (int) $rawValue;
        if ($planId <= 0) return;

        $plan = LeavePlans::find($planId);
        if (!$plan) return;
        // Same-tenant check — never let one tenant's plan get assigned
        // to another tenant's employee, even if a stale payload arrives.
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

    /**
     * Default permissions for a freshly-onboarded employee. The principle:
     *   - dashboard / profile / master.employees → always view-only.
     *   - every master.* the granting admin can already view → view-only
     *     for the employee too.
     *
     * Without the second bullet, the Edit Employee wizard's Country / State
     * / Designation / Role / Legal Entity dropdowns return 403 the moment
     * the employee tries to read them, so the form looks empty. Admins can
     * still revoke individual masters per-employee from the Permissions UI.
     */
    private function grantSelfServicePermissions(User $user, $clientId, $branchId, $grantedBy): void
    {
        // Minimum baseline so the new hire can sign in and reach the basics.
        // Anything beyond Dashboard + Profile must be granted explicitly by
        // the branch / client admin from the Permissions screen — we no
        // longer replicate the creator's master.* views by default.
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
