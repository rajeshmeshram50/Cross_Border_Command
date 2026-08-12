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
     * Department name → template category.
     *
     * Branch users name departments freely, so this is a substring match against
     * hint lists rather than a lookup. Legal is checked first: a "Legal &
     * Compliance Tech" department is Legal, not IT.
     */
    public static function categoryForDepartment(?string $deptName): string
    {
        $name = strtolower(trim((string) $deptName));
        if ($name === '') return 'Non-IT';

        $itHints    = ['it', 'information technology', 'tech', 'engineering', 'software', 'devops', 'qa', 'mobile', 'data', 'product'];
        $legalHints = ['legal', 'compliance', 'governance'];

        foreach ($legalHints as $h) {
            if (str_contains($name, $h)) return 'Legal';
        }
        foreach ($itHints as $h) {
            if (str_contains($name, $h)) return 'IT';
        }
        return 'Non-IT';
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
            ->where('employee_category', self::categoryForDepartment($emp->department?->name));

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
