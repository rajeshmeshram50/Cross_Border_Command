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
        $tasks = [
            ModuleSeeder::class           => fn() => $this->call(ModuleSeeder::class),
            PlanSeeder::class             => fn() => $this->call(PlanSeeder::class),
            OrganizationTypeSeeder::class => fn() => $this->call(OrganizationTypeSeeder::class),
            'SuperAdminUser'              => fn() => $this->seedSuperAdmin(),
            GeographySeeder::class        => fn() => $this->call(GeographySeeder::class),
            InventoryProductFlagSeeder::class => fn() => $this->call(InventoryProductFlagSeeder::class),
        ];

        $hasLedger   = Schema::hasTable('seeder_runs');
        $hasChecksum = $hasLedger && Schema::hasColumn('seeder_runs', 'checksum');
        $ran = 0;

        foreach ($tasks as $key => $task) {
            $checksum = $this->taskChecksum($key);

            if ($hasLedger) {
                $row = DB::table('seeder_runs')->where('seeder', $key)->first();
                if ($row && $checksum !== null && ($row->checksum ?? null) === $checksum) {
                    continue;
                }
            }

            $task();

            if ($hasLedger) {
                $payload = ['ran_at' => now()];
                if ($hasChecksum) $payload['checksum'] = $checksum;
                DB::table('seeder_runs')->updateOrInsert(['seeder' => $key], $payload);
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

    private function taskChecksum(string $key): ?string
    {
        if (class_exists($key)) {
            try {
                $file = (new \ReflectionClass($key))->getFileName();
                if ($file && is_file($file)) {
                    return md5_file($file) ?: 'static';
                }
            } catch (\Throwable $e) {
            }
        }
        return 'static';
    }

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
