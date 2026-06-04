<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        // ── Seeder ledger ───────────────────────────────────────────────
        // Like the `migrations` table, `seeder_runs` records which seeders
        // have already run. A plain `php artisan db:seed` runs only the
        // tasks NOT yet recorded, then notes them. When everything is
        // already applied it prints "Nothing to seed" instead of re-running
        // (and re-printing) every seeder.
        //
        // - Add a NEW seeder to $tasks → only it runs on the next db:seed.
        // - Edited an EXISTING seeder and want it to re-run? Use
        //   `php artisan db:seed --class=Foo` (bypasses the ledger), or
        //   delete its row from `seeder_runs`.
        // - `migrate:fresh --seed` drops the ledger, so a fresh DB re-seeds
        //   everything.
        //
        // Order matters: GeographySeeder owns master_countries/master_states
        // and must run before MasterDataSeeder (state_codes resolution).
        $tasks = [
            ModuleSeeder::class           => fn () => $this->call(ModuleSeeder::class),
            PlanSeeder::class             => fn () => $this->call(PlanSeeder::class),
            OrganizationTypeSeeder::class => fn () => $this->call(OrganizationTypeSeeder::class),
            'SuperAdminUser'              => fn () => $this->seedSuperAdmin(),
            GeographySeeder::class        => fn () => $this->call(GeographySeeder::class),
            MasterDataSeeder::class       => fn () => $this->call(MasterDataSeeder::class),
        ];

        $hasLedger = Schema::hasTable('seeder_runs');
        $ran = 0;

        foreach ($tasks as $key => $task) {
            if ($hasLedger && DB::table('seeder_runs')->where('seeder', $key)->exists()) {
                continue;   // already applied — skip silently
            }

            $task();

            if ($hasLedger) {
                DB::table('seeder_runs')->updateOrInsert(
                    ['seeder' => $key],
                    ['ran_at' => now()]
                );
            }
            $ran++;
        }

        if (! $hasLedger) {
            $this->command?->warn(
                'seeder_runs ledger missing — ran all seeders. Run `php artisan migrate` '
                . 'so future `db:seed` can skip already-applied seeders.'
            );
        } elseif ($ran === 0) {
            $this->command?->info(
                'Nothing to seed — all seeders already applied. '
                . 'Use `php artisan db:seed --class=Foo` to force-run one.'
            );
        }
    }

    /** Platform super-admin (idempotent by email). */
    private function seedSuperAdmin(): void
    {
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
    }
}
