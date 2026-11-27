<?php

namespace App\Support;

use App\Models\Employee;
use App\Models\HrDocumentTemplate;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

class HrTemplateMatch
{
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

    public static function categoryForDepartment(?string $deptName): string
    {
        return self::hintCategory($deptName) ?? 'Non-IT';
    }

    public static function categoryForDepartmentId(?int $deptId, ?string $deptName = null): string
    {
        $own = self::hintCategory($deptName);
        if ($own !== null) return $own;
        if (!$deptId) return 'Non-IT';

        $seen = [];
        $row  = DB::table('master_departments')->where('id', $deptId)->first(['id', 'name', 'parent_id']);

        if ($row && $deptName === null) {
            $cat = self::hintCategory($row->name ?? null);
            if ($cat !== null) return $cat;
        }

        $depth = 0;
        while ($row && !empty($row->parent_id) && $depth++ < 10) {
            if (isset($seen[(int) $row->id])) break;
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

    public static function categoryMap(): array
    {
        $rows = DB::table('master_departments')->get(['id', 'name', 'parent_id']);
        $byId = [];
        foreach ($rows as $r) $byId[(int) $r->id] = $r;

        $resolved = [];
        $resolve = function (int $id, array $seen = []) use (&$resolve, $byId, &$resolved): string {
            if (isset($resolved[$id])) return $resolved[$id];
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

    public static function categoryForEmployee(Employee $emp): string
    {
        return self::categoryForDepartmentId(
            $emp->department_id ? (int) $emp->department_id : null,
            $emp->department?->name,
        );
    }

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

    public static function onboardingTemplatesFor(Employee $emp)
    {
        return self::templatesForKeyword($emp, 'onboarding');
    }

    public static function exitTemplatesFor(Employee $emp)
    {
        return self::templatesForKeyword($emp, 'exit');
    }

    private static function templatesForKeyword(Employee $emp, string $keyword)
    {
        $q = self::query($emp, $keyword);
        if (!$q) return collect();

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
