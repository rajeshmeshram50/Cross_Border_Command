<?php

namespace App\Support;

use App\Models\Employee;
use App\Models\EmployeeExit;
use App\Models\LeaveRequest;
use App\Models\Masters\LeaveTypes;
use Carbon\Carbon;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\Log;

class NoticePeriodGuard
{
    public const DISPLAY_TZ = 'Asia/Kolkata';

    public static function activeExit(?Employee $employee, ?Carbon $asOf = null): ?EmployeeExit
    {
        if (!$employee) {
            return null;
        }

        $row = EmployeeExit::where('employee_id', $employee->id)
            ->whereNotNull('notice_date')
            ->whereNull('rehired_at')
            ->where(fn ($q) => $q->whereNull('exit_case_status')->orWhere('exit_case_status', '!=', 'Closed'))
            ->orderByDesc('id')
            ->first();

        if (!$row) {
            return null;
        }

        $today = ($asOf ?: Carbon::now(self::DISPLAY_TZ))->copy()->startOfDay();
        $start = Carbon::parse($row->notice_date)->startOfDay();
        if ($today->lt($start)) {
            return null;
        }
        if ($row->last_working_day && $today->gt(Carbon::parse($row->last_working_day)->startOfDay())) {
            return null;
        }

        return $row;
    }

    public static function isOnNoticePeriod(?Employee $employee, ?Carbon $asOf = null): bool
    {
        if (self::activeExit($employee, $asOf)) {
            return true;
        }
        return $employee && strcasecmp((string) $employee->status, 'Notice Period') === 0;
    }

    public static function isUnpaidType(?LeaveTypes $type): bool
    {
        if (!$type) {
            return false;
        }
        return strcasecmp((string) $type->paid_unpaid, 'Unpaid') === 0
            || strcasecmp((string) $type->type, 'Unpaid Leave') === 0;
    }

    public static function lastWorkingDayLabel(?Employee $employee): ?string
    {
        $row = self::activeExit($employee);
        return $row && $row->last_working_day
            ? Carbon::parse($row->last_working_day)->format('j M Y')
            : null;
    }

    public static function assertLeaveAllowed(?Employee $employee, ?LeaveTypes $type, bool $isSelf = true): void
    {
        if (!self::isOnNoticePeriod($employee) || self::isUnpaidType($type)) {
            return;
        }

        $lwd     = self::lastWorkingDayLabel($employee);
        $until   = $lwd ? " (serving notice until {$lwd})" : '';
        $message = $isSelf
            ? "You are serving your notice period{$until}, so paid leave cannot be applied for. You may apply for unpaid leave — note that each unpaid day extends your last working day by a day."
            : "This employee is serving their notice period{$until}, so paid leave cannot be granted. Only unpaid leave is allowed, and each unpaid day extends their last working day by a day.";

        throw new HttpResponseException(response()->json([
            'message' => $message,
            'errors'  => ['notice_period' => ['Paid leave is not allowed during the notice period.']],
        ], 422));
    }

    public static function applyExtension(LeaveRequest $leave, ?Employee $employee): int
    {
        try {
            if ($leave->notice_extension_days !== null) {
                return 0;
            }
            $exit = self::activeExit($employee);
            if (!$exit || !$exit->last_working_day) {
                return 0;
            }
            $type = $leave->relationLoaded('leaveType') ? $leave->leaveType : LeaveTypes::find($leave->leave_type_id);
            if (!self::isUnpaidType($type)) {
                return 0;
            }
            $days = (int) ceil((float) $leave->days);
            if ($days <= 0) {
                return 0;
            }

            $exit->last_working_day = Carbon::parse($exit->last_working_day)->addDays($days)->toDateString();
            $exit->save();

            $leave->notice_extension_days = $days;
            $leave->save();

            return $days;
        } catch (\Throwable $e) {
            Log::warning('Notice-period last-working-day extension failed', [
                'leave_request_id' => $leave->id,
                'error'            => $e->getMessage(),
            ]);
            return 0;
        }
    }

    public static function revertExtension(LeaveRequest $leave, ?Employee $employee): int
    {
        try {
            $days = (int) ($leave->notice_extension_days ?? 0);
            if ($days <= 0) {
                return 0;
            }
            $exit = $employee
                ? EmployeeExit::where('employee_id', $employee->id)->orderByDesc('id')->first()
                : null;
            if ($exit && $exit->last_working_day) {
                $exit->last_working_day = Carbon::parse($exit->last_working_day)->subDays($days)->toDateString();
                $exit->save();
            }
            $leave->notice_extension_days = null;
            $leave->save();

            return $days;
        } catch (\Throwable $e) {
            Log::warning('Notice-period last-working-day revert failed', [
                'leave_request_id' => $leave->id,
                'error'            => $e->getMessage(),
            ]);
            return 0;
        }
    }
}
