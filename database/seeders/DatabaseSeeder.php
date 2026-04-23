<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        $this->call(ModuleSeeder::class);
        $this->call(PlanSeeder::class);
        $this->call(OrganizationTypeSeeder::class);

        // Super Admin
        User::updateOrCreate(
            ['email' => 'admin@saas.com'],
            [
                'name' => 'Super Admin',
                'password' => Hash::make('password'),
                'phone' => '+91 9999999999',
                'user_type' => 'super_admin',
                'status' => 'active',
                'designation' => 'Platform Administrator',
                'employee_code' => 'SA001',
            ]
        );

        // Seed every master table with 10+ admin-created rows (idempotent).
        $this->call(MasterDataSeeder::class);
    }
}
