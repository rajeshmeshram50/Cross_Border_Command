<?php

namespace App\Support;

use App\Models\EmployeeExit;
use Illuminate\Support\Facades\Schema;

class ExitInProgress
{
    public static function employeeIds(?int $clientId = null, ?array $employeeIds = null): array
    {
        if (!Schema::hasTable('employee_exits')) {
            return [];
        }
        if ($employeeIds !== null && empty($employeeIds)) {
            return [];
        }

        return EmployeeExit::query()
            ->when($clientId !== null, fn ($q) => $q->where('client_id', $clientId))
            ->when($employeeIds !== null, fn ($q) => $q->whereIn('employee_id', $employeeIds))
            ->whereNotNull('exit_type')
            ->where('exit_case_status', 'Open')
            ->whereNull('rehired_at')
            ->pluck('employee_id')
            ->map(fn ($v) => (int) $v)
            ->unique()
            ->values()
            ->all();
    }

    public static function initiatedFor(int $employeeId): ?EmployeeExit
    {
        if (!Schema::hasTable('employee_exits')) {
            return null;
        }

        return self::initiatedQuery()->where('employee_id', $employeeId)->first();
    }

    public static function initiatedIds(?array $employeeIds = null): array
    {
        if (!Schema::hasTable('employee_exits')) {
            return [];
        }
        if ($employeeIds !== null && empty($employeeIds)) {
            return [];
        }

        return self::initiatedQuery()
            ->when($employeeIds !== null, fn ($q) => $q->whereIn('employee_id', $employeeIds))
            ->pluck('employee_id')
            ->map(fn ($v) => (int) $v)
            ->unique()
            ->values()
            ->all();
    }

    private static function initiatedQuery()
    {
        return EmployeeExit::query()
            ->whereNull('rehired_at')
            ->where('exit_case_status', 'Open')
            ->where(fn ($w) => $w
                ->where('exit_type', '<>', '')
                ->orWhereNotNull('notice_date')
                ->orWhereNotNull('last_working_day')
                ->orWhere('current_stage', '>=', 1));
    }

    public static function map(array $employeeIds): array
    {
        if (empty($employeeIds) || !Schema::hasTable('employee_exits')) {
            return [];
        }

        return EmployeeExit::query()
            ->whereIn('employee_id', $employeeIds)
            ->whereNotNull('exit_type')
            ->where('exit_case_status', 'Open')
            ->whereNull('rehired_at')
            ->orderBy('id')
            ->get(['employee_id', 'exit_type', 'notice_date', 'last_working_day'])
            ->keyBy('employee_id')
            ->all();
    }
}
