<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $now = now();

        $seed = function ($clientId) use ($now) {
            foreach (['Onboarding', 'Exit Management'] as $name) {
                $exists = DB::table('master_trigger_points')
                    ->where('client_id', $clientId)
                    ->whereNull('branch_id')
                    ->whereRaw('LOWER(module_name) = ?', [strtolower($name)])
                    ->exists();
                if ($exists) continue;

                DB::table('master_trigger_points')->insert([
                    'client_id'    => $clientId,
                    'branch_id'    => null,
                    'module_name'  => $name,
                    'description'  => $name === 'Onboarding'
                        ? 'Documents that auto-attach to the new-hire onboarding flow.'
                        : 'Documents that auto-attach to the employee exit flow.',
                    'status'       => 'Active',
                    'created_by'   => null,
                    'created_at'   => $now,
                    'updated_at'   => $now,
                ]);
            }
        };

        $seed(null);

        $clientIds = DB::table('clients')->pluck('id')->all();
        foreach ($clientIds as $cid) {
            $seed($cid);
        }
    }

    public function down(): void
    {
        DB::table('master_trigger_points')
            ->whereIn(DB::raw('LOWER(module_name)'), ['onboarding', 'exit management'])
            ->whereNull('branch_id')
            ->whereIn('description', [
                'Documents that auto-attach to the new-hire onboarding flow.',
                'Documents that auto-attach to the employee exit flow.',
            ])
            ->delete();
    }
};
