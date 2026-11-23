<?php

namespace Database\Seeders;

use App\Models\Module;
use App\Models\Permission;
use App\Models\User;
use Illuminate\Database\Seeder;

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
