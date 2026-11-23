<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    private array $canonical = [
        ['Onboarding',      'Documents that auto-attach to the new-hire onboarding flow.'],
        ['Exit Management', 'Documents that auto-attach to the employee exit flow.'],
        ['Promotion',       'Documents that auto-attach to the employee promotion flow.'],
    ];

    public function up(): void
    {
        $now = now();

        foreach ($this->canonical as [$name, $description]) {
            $exists = DB::table('master_trigger_points')
                ->whereNull('client_id')
                ->whereNull('branch_id')
                ->whereRaw('LOWER(module_name) = ?', [strtolower($name)])
                ->exists();
            if ($exists) continue;
            DB::table('master_trigger_points')->insert([
                'client_id'   => null,
                'branch_id'   => null,
                'module_name' => $name,
                'description' => $description,
                'status'      => 'Active',
                'created_by'  => null,
                'created_at'  => $now,
                'updated_at'  => $now,
            ]);
        }

        $globalIds = [];
        foreach ($this->canonical as [$name]) {
            $id = DB::table('master_trigger_points')
                ->whereNull('client_id')
                ->whereNull('branch_id')
                ->whereRaw('LOWER(module_name) = ?', [strtolower($name)])
                ->value('id');
            if ($id) $globalIds[strtolower($name)] = (int) $id;
        }

        if (\Illuminate\Support\Facades\Schema::hasTable('hr_document_templates')) {
            foreach ($this->canonical as [$name, $description]) {
                $targetId = $globalIds[strtolower($name)] ?? null;
                if (!$targetId) continue;

                $perClientIds = DB::table('master_trigger_points')
                    ->whereNotNull('client_id')
                    ->whereNull('branch_id')
                    ->whereRaw('LOWER(module_name) = ?', [strtolower($name)])
                    ->where('description', $description)
                    ->pluck('id')
                    ->all();

                if (!empty($perClientIds)) {
                    DB::table('hr_document_templates')
                        ->whereIn('trigger_point_id', $perClientIds)
                        ->update(['trigger_point_id' => $targetId]);
                }
            }
        }

        DB::table('master_trigger_points')
            ->whereNotNull('client_id')
            ->whereNull('branch_id')
            ->whereIn('description', array_map(fn ($p) => $p[1], $this->canonical))
            ->whereIn(DB::raw('LOWER(module_name)'), array_map(fn ($p) => strtolower($p[0]), $this->canonical))
            ->delete();
    }

    public function down(): void
    {
        DB::table('master_trigger_points')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->whereRaw('LOWER(module_name) = ?', ['promotion'])
            ->where('description', 'Documents that auto-attach to the employee promotion flow.')
            ->delete();
    }
};
