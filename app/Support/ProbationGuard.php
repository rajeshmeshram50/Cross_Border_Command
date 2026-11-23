<?php

namespace App\Support;

use App\Models\Employee;
use Carbon\Carbon;
use Illuminate\Http\Exceptions\HttpResponseException;

class ProbationGuard
{
    public const DISPLAY_TZ = 'Asia/Kolkata';

    public const EARLY_EXIT_DAYS = 15;

    public static function endDate(?Employee $employee): ?Carbon
    {
        if (!$employee || empty($employee->probation_end_date)) {
            return null;
        }
        return Carbon::parse($employee->probation_end_date)->startOfDay();
    }

    public static function isOnProbation(?Employee $employee, ?Carbon $asOf = null): bool
    {
        $end = self::endDate($employee);
        if (!$end) {
            return false;
        }
        $today = ($asOf ?: Carbon::now(self::DISPLAY_TZ))->copy()->startOfDay();

        return $today->lte($end);
    }

    public static function endDateLabel(?Employee $employee): ?string
    {
        return self::endDate($employee)?->format('j M Y');
    }

    public static function assertCanRaiseLeave(?Employee $employee, bool $isSelf = true): void
    {
        if (!self::isOnProbation($employee)) {
            return;
        }

        $until   = self::endDateLabel($employee);
        $suffix  = $until ? " Leave can be applied from {$until}." : '';
        $message = $isSelf
            ? "You are on probation and cannot apply for leave.{$suffix}"
            : "This employee is on probation, so the leave policy does not apply yet.{$suffix}";

        throw new HttpResponseException(response()->json([
            'message' => $message,
            'errors'  => ['probation' => ['Employee is on probation.']],
        ], 422));
    }

    public static function noticePeriodApplies(?Employee $employee, $resignationDate = null): bool
    {
        return !self::isOnProbation($employee)
            && !self::isEarlyResignation($employee, $resignationDate);
    }

    public static function tenureDays(?Employee $employee, $lastWorkingDay): ?int
    {
        if (!$employee || empty($employee->date_of_joining) || empty($lastWorkingDay)) {
            return null;
        }
        $join = Carbon::parse($employee->date_of_joining)->startOfDay();
        $lwd  = Carbon::parse($lastWorkingDay)->startOfDay();
        if ($lwd->lt($join)) {
            return null;
        }
        return $join->diffInDays($lwd) + 1;
    }

    public static function isEarlyResignation(?Employee $employee, $resignationDate): bool
    {
        $tenure = self::tenureDays($employee, $resignationDate);

        return $tenure !== null && $tenure <= self::EARLY_EXIT_DAYS;
    }

    public static function isEarlyExit(?Employee $employee, $lastWorkingDay, $resignationDate = null): bool
    {
        $tenure = self::tenureDays($employee, $lastWorkingDay);

        return ($tenure !== null && $tenure <= self::EARLY_EXIT_DAYS)
            || self::isEarlyResignation($employee, $resignationDate);
    }
}
