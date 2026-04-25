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

        // Geography first — owns master_countries (249 ISO countries) and
        // master_states (subdivisions for major trade partners). Runs before
        // MasterDataSeeder so state_codes can resolve Indian state names.
        $this->call(GeographySeeder::class);

        // Seed every other master table with 10+ admin-created rows (idempotent).
        $this->call(MasterDataSeeder::class);
    }
}
