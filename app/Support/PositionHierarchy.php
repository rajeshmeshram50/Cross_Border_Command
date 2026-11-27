<?php

namespace App\Support;

class PositionHierarchy
{
    public const TOP_RANK = 1;

    public const DESIGNATION_RANK = [
        'Head of Department (HOD)' => 2,
        'Team Leader'              => 3,
        'Executive'                => 4,
        'Employee'                 => 5,
        'Intern / Trainee'         => 6,
    ];

    public const UNRANKED = 99;

    public static function rankForDesignationName(?string $name): ?int
    {
        if ($name === null || trim($name) === '') return self::UNRANKED;
        return self::DESIGNATION_RANK[trim($name)] ?? null;
    }

    public static function rankForUserType(?string $userType): ?int
    {
        return in_array($userType, ['branch_user', 'client_admin', 'client_user', 'super_admin'], true)
            ? self::TOP_RANK
            : null;
    }

    public static function eligible(?int $hireRank, ?int $managerRank): bool
    {
        if ($hireRank === null || $managerRank === null) return true;
        return $managerRank < $hireRank;
    }
}
