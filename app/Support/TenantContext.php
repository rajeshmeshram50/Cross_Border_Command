<?php

namespace App\Support;

class TenantContext
{
    private static bool $active = false;
    private static ?int $clientId = null;
    private static ?int $branchId = null;

    public static function set(int $clientId, ?int $branchId): void
    {
        self::$active   = true;
        self::$clientId = $clientId;
        self::$branchId = $branchId ?: null;
    }

    public static function clear(): void
    {
        self::$active   = false;
        self::$clientId = null;
        self::$branchId = null;
    }

    public static function active(): bool { return self::$active; }
    public static function clientId(): ?int { return self::$clientId; }
    public static function branchId(): ?int { return self::$branchId; }

    public static function fromUser($user): void
    {
        self::clear();
        if (!$user || ($user->user_type ?? null) === 'super_admin') return;
        $clientId = $user->client_id ?? optional($user->branch ?? null)->client_id;
        if (!$clientId) return;
        $clientWide = in_array($user->user_type ?? null, ['client_admin', 'client_user'], true);
        self::set((int) $clientId, $clientWide ? null : ($user->branch_id ? (int) $user->branch_id : null));
    }
}
