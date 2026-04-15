<?php

namespace Database\Seeders;

use App\Models\Module;
use Illuminate\Database\Seeder;

class ModuleSeeder extends Seeder
{
    public function run(): void
    {
        $modules = [
            ['name' => 'Dashboard', 'slug' => 'dashboard', 'icon' => 'LayoutGrid', 'sort_order' => 1, 'is_default' => true],
            ['name' => 'Clients', 'slug' => 'clients', 'icon' => 'Building2', 'sort_order' => 2, 'is_default' => false, 'description' => 'Manage client organizations'],
            ['name' => 'Branches', 'slug' => 'branches', 'icon' => 'GitBranch', 'sort_order' => 3, 'is_default' => false, 'description' => 'Manage branches/companies'],
            ['name' => 'Employees', 'slug' => 'employees', 'icon' => 'UserCheck', 'sort_order' => 4, 'is_default' => false, 'description' => 'Employee management'],
            ['name' => 'Plans', 'slug' => 'plans', 'icon' => 'CreditCard', 'sort_order' => 5, 'is_default' => false, 'description' => 'Subscription plans'],
            ['name' => 'Payments', 'slug' => 'payments', 'icon' => 'IndianRupee', 'sort_order' => 6, 'is_default' => false, 'description' => 'Payment transactions'],
            ['name' => 'Permissions', 'slug' => 'permissions', 'icon' => 'ShieldCheck', 'sort_order' => 7, 'is_default' => false, 'description' => 'Access control'],
            ['name' => 'Settings', 'slug' => 'settings', 'icon' => 'Settings', 'sort_order' => 8, 'is_default' => false, 'description' => 'System settings'],
            ['name' => 'Profile', 'slug' => 'profile', 'icon' => 'UserCircle', 'sort_order' => 9, 'is_default' => true],
        ];

        foreach ($modules as $mod) {
            Module::updateOrCreate(['slug' => $mod['slug']], $mod);
        }
    }
}
