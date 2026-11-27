<?php

namespace App\Support;

use App\Models\Module;
use App\Models\Permission;
use App\Models\User;

class ClmMasterAccess
{
    public static function denial(?User $user, $row, string $action, string $moduleSlug): ?string
    {
        $legacy = MasterVisibility::hierarchicalDenial($user, $row, $action);
        if ($legacy === null) {
            return null;
        }

        if (self::hasGrant($user, $moduleSlug, $action)) {
            return null;
        }

        $verb = $action === 'delete' ? 'delete' : 'edit';
        $label = self::moduleName($moduleSlug);

        return "You do not have permission to {$verb} {$label} records. "
             . 'Ask an administrator to grant it under Permissions.';
    }

    private static function hasGrant(?User $user, string $moduleSlug, string $action): bool
    {
        if (!$user) return false;

        $column = $action === 'delete' ? 'can_delete' : 'can_edit';

        $moduleId = self::moduleId($moduleSlug);
        if (!$moduleId) return false;

        return Permission::query()
            ->where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where($column, true)
            ->exists();
    }

    private static array $moduleCache = [];

    private static function moduleId(string $slug): ?int
    {
        if (!array_key_exists($slug, self::$moduleCache)) {
            self::$moduleCache[$slug] = Module::where('slug', $slug)->value('id');
        }
        return self::$moduleCache[$slug] ? (int) self::$moduleCache[$slug] : null;
    }

    private static function moduleName(string $slug): string
    {
        return (string) (Module::where('slug', $slug)->value('name') ?: 'these');
    }
}
