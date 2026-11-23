<?php

use App\Models\User;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('master_trigger_points')) {
            return;
        }

        $admin = User::where('user_type', 'super_admin')->first();
        if (! $admin) {
            return;
        }

        $defaults = ['Onboarding', 'Exit Process'];
        $now = now();

        foreach ($defaults as $name) {
            $exists = DB::table('master_trigger_points')
                ->whereNull('client_id')
                ->whereNull('branch_id')
                ->where('module_name', $name)
                ->exists();

            if (! $exists) {
                DB::table('master_trigger_points')->insert([
                    'client_id'   => null,
                    'branch_id'   => null,
                    'module_name' => $name,
                    'description' => $name === 'Onboarding'
                        ? 'Fires when a new employee onboarding flow begins'
                        : 'Fires when an employee starts the exit / offboarding flow',
                    'status'      => 'Active',
                    'created_by'  => $admin->id,
                    'created_at'  => $now,
                    'updated_at'  => $now,
                ]);
            }
        }
    }

    public function down(): void
    {
    }
};
