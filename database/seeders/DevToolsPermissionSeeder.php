<?php

namespace Database\Seeders;

use App\Models\Module;
use App\Models\Permission;
use App\Models\User;
use Illuminate\Database\Seeder;

/**
 * Grants the read-only "Dev Tools" module (view) to tenant admins so it's
 * usable out of the box. Without this nobody holds the permission, and the
 * Permissions cascade ("you can only grant what you already have") means a
 * client_admin could never grant it down to a branch_user. Granting view to
 * client_admin + branch_user makes it visible to them AND grantable onward.
 *
 * super_admin bypasses permissions entirely, so it isn't listed here.
 * Re-runnable (updateOrCreate). Run: php artisan db:seed --class=DevToolsPermissionSeeder
 */
class DevToolsPermissionSeeder extends Seeder
{
    public function run(): void
    {
        $moduleId = Module::where('slug', 'dev-tools')->value('id');
        if (!$moduleId) return;

        User::whereIn('user_type', ['client_admin', 'branch_user'])
            ->get(['id', 'client_id', 'branch_id', 'user_type'])
            ->each(function (User $u) use ($moduleId) {
                Permission::updateOrCreate(
                    ['user_id' => $u->id, 'module_id' => $moduleId],
                    [
                        'client_id' => $u->client_id,
                        'branch_id' => $u->branch_id,
                        'role'      => $u->user_type,
                        'can_view'  => true,
                    ]
                );
            });
    }
}
