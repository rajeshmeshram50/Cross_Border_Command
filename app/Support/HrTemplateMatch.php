<?php

namespace App\Support;

use App\Models\Employee;
use App\Models\HrDocumentTemplate;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * The one definition of "which HR document templates apply to this employee".
 *
 * Previously this lived only inside HrDocumentTemplateController::matchForEmployee,
 * which meant anything else needing the same answer — the onboarding-completion
 * guard, in particular — had to restate the rules and would drift away from them
 * the first time the matching changed. Both callers now share this class.
 *
 * A template matches when it is Active, its employee_category equals the
 * category derived from the employee's department, its role_type equals the
 * employee's designation level, and (optionally) its trigger point mentions the
 * requested lifecycle keyword.
 */
class HrTemplateMatch
{
    /**
     * Department name → template category, for ONE name.
     *
     * Branch users name departments freely, so this is a substring match against
     * hint lists rather than a lookup. Legal is checked first: a "Legal &
     * Compliance Tech" department is Legal, not IT.
     *
     * Returns null when nothing matched, so the caller can keep looking up the
     * hierarchy. categoryForDepartment() below is what most callers want.
     */
    private static function hintCategory(?string $deptName): ?string
    {
        $name = strtolower(trim((string) $deptName));
        if ($name === '') return null;

        $itHints    = ['it', 'information technology', 'tech', 'engineering', 'software', 'devops', 'qa', 'mobile', 'data', 'product'];
        $legalHints = ['legal', 'compliance', 'governance'];

        foreach ($legalHints as $h) {
            if (str_contains($name, $h)) return 'Legal';
        }
        foreach ($itHints as $h) {
            if (str_contains($name, $h)) return 'IT';
        }
        return null;
    }

    /** Department name → template category, no hierarchy. Kept for callers that
     *  hold only a name; prefer categoryForDepartmentId(). */
    public static function categoryForDepartment(?string $deptName): string
    {
        return self::hintCategory($deptName) ?? 'Non-IT';
    }

    /**
     * Department → category, INHERITED DOWN THE HIERARCHY. (QA #20)
     *
     * Departments nest (`master_departments.parent_id`), and the classification
     * only ever looked at the employee's own department name. A "Software"
     * department created under "IT" was judged on the word "Software" alone: if
     * its name happened to contain no hint — "App Team", "Developement",
     * "Platform" — it fell through to Non-IT while its parent was the very IT
     * department the template was written for, and the employee simply never
     * appeared in the recipient list.
     *
     * The nearest ancestor that names a category wins, so a child can still
     * override its parent deliberately (a "Legal" sub-department under IT stays
     * Legal), and a child that says nothing inherits.
     *
     * The walk is depth-capped: parent_id is a plain self-reference with no
     * cycle guard in the database, and a loop here would hang every request
     * that classifies an employee.
     */
    public static function categoryForDepartmentId(?int $deptId, ?string $deptName = null): string
    {
        $own = self::hintCategory($deptName);
        if ($own !== null) return $own;
        if (!$deptId) return 'Non-IT';

        $seen = [];
        $row  = DB::table('master_departments')->where('id', $deptId)->first(['id', 'name', 'parent_id']);

        // Name may not have been supplied — try the row's own name first.
        if ($row && $deptName === null) {
            $cat = self::hintCategory($row->name ?? null);
            if ($cat !== null) return $cat;
        }

        $depth = 0;
        while ($row && !empty($row->parent_id) && $depth++ < 10) {
            if (isset($seen[(int) $row->id])) break;   // cycle
            $seen[(int) $row->id] = true;

            $row = DB::table('master_departments')
                ->where('id', $row->parent_id)
                ->first(['id', 'name', 'parent_id']);
            if (!$row) break;

            $cat = self::hintCategory($row->name ?? null);
            if ($cat !== null) return $cat;
        }

        return 'Non-IT';
    }

    /**
     * id → category for EVERY department, in one query. (QA #20)
     *
     * categoryForDepartmentId() walks the parent chain with a query per hop,
     * which is fine for one employee and wasteful for a list of them. This
     * resolves the whole tree once and memoises each node as it goes, so a page
     * of employees costs a single SELECT no matter how deep the hierarchy is.
     *
     * @return array<int, string>
     */
    public static function categoryMap(): array
    {
        $rows = DB::table('master_departments')->get(['id', 'name', 'parent_id']);
        $byId = [];
        foreach ($rows as $r) $byId[(int) $r->id] = $r;

        $resolved = [];
        $resolve = function (int $id, array $seen = []) use (&$resolve, $byId, &$resolved): string {
            if (isset($resolved[$id])) return $resolved[$id];
            // A cycle, or a parent_id pointing at a row that no longer exists.
            if (isset($seen[$id]) || !isset($byId[$id])) return 'Non-IT';

            $row = $byId[$id];
            $cat = self::hintCategory($row->name ?? null);
            if ($cat === null) {
                $seen[$id] = true;
                $cat = !empty($row->parent_id)
                    ? $resolve((int) $row->parent_id, $seen)
                    : 'Non-IT';
            }
            return $resolved[$id] = $cat;
        };

        foreach ($byId as $id => $_) $resolve($id);
        return $resolved;
    }

    /** The category an employee is classified under, hierarchy included. */
    public static function categoryForEmployee(Employee $emp): string
    {
        return self::categoryForDepartmentId(
            $emp->department_id ? (int) $emp->department_id : null,
            $emp->department?->name,
        );
    }

    /**
     * Templates matching $emp, before any caller-specific tenancy scoping.
     *
     * Returns null when a lifecycle keyword was asked for but no trigger point
     * carries it — that is "no templates match", and the caller must not fall
     * through to an unfiltered query. (whereIn on an empty array would quietly
     * match nothing, but an early null makes the intent explicit at the call
     * site and skips the work.)
     */
    public static function query(Employee $emp, ?string $triggerKeyword = null, ?string $exactTriggerName = null): ?Builder
    {
        $q = HrDocumentTemplate::query()
            ->where('status', 'Active')
            ->where('employee_category', self::categoryForEmployee($emp));

        $level = $emp->designation?->level;
        if ($level) $q->where('role_type', $level);

        $keyword = trim((string) $triggerKeyword);
        $exact   = trim((string) $exactTriggerName);
        if ($keyword !== '' || $exact !== '') {
            $tp = DB::table('master_trigger_points');
            if ($keyword !== '') {
                $tp->whereRaw('LOWER(TRIM(module_name)) LIKE ?', ['%' . strtolower($keyword) . '%']);
            } else {
                $tp->whereRaw('LOWER(TRIM(module_name)) = ?', [strtolower($exact)]);
            }
            $ids = $tp->pluck('id')->all();
            if (empty($ids)) return null;
            $q->whereIn('trigger_point_id', $ids);
        }

        return $q;
    }

    /**
     * Templates the Onboarding wizard's Stage 5 actually lists for an employee.
     *
     * Leave / Attendance templates are dropped here for the same reason the SPA
     * drops them: they belong to the HR › Leave & Attendance module, and showing
     * them in onboarding too would double-prompt the employee to acknowledge one
     * policy. The filter must stay in step with Stage5Policies in
     * HrEmployeeOnboarding.tsx — the completion guard counts what the screen
     * shows, or HR gets blocked by a document they were never offered.
     *
     * @return \Illuminate\Support\Collection<int, HrDocumentTemplate>
     */
    public static function onboardingTemplatesFor(Employee $emp)
    {
        $q = self::query($emp, 'onboarding');
        if (!$q) return collect();

        // Scope to what this employee's own tenant can see: global templates,
        // their client's client-wide templates, and their branch's own.
        $q->where(function ($w) use ($emp) {
            $w->whereNull('client_id')
              ->orWhere(function ($ww) use ($emp) {
                  $ww->where('client_id', $emp->client_id)
                     ->where(function ($wb) use ($emp) {
                         $wb->whereNull('branch_id')->orWhere('branch_id', $emp->branch_id);
                     });
              });
        });

        return $q->get()->reject(fn ($t) => preg_match('/\b(leave|attendance)\b/i', (string) $t->name) === 1)
                 ->values();
    }
}
