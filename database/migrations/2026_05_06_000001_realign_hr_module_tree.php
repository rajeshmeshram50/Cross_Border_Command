<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::transaction(function () {
            $idBySlug = fn (string $slug) =>
                DB::table('modules')->where('slug', $slug)->value('id');

            $moves = [
                'hr.recruitment' => 'hr.core',
                'hr.onboarding'  => 'hr.core',
                'hr.exit'        => 'hr.core',
                'hr.reports'     => 'hr.command',
                'hr.ai_master'   => 'hr.command',
            ];
            foreach ($moves as $leafSlug => $newParentSlug) {
                $newParentId = $idBySlug($newParentSlug);
                if (!$newParentId) continue;
                DB::table('modules')
                    ->where('slug', $leafSlug)
                    ->update(['parent_id' => $newParentId]);
            }

            DB::table('modules')->whereIn('slug', [
                'hr.operations',
                'hr.ai',
                'hr.department',
                'hr.designation',
                'hr.role',
                'hr.kpis',
            ])->delete();
        });
    }

    public function down(): void
    {
    }
};
