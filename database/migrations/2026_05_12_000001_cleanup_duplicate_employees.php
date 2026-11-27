<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void
    {
        $groups = DB::table('employees')
            ->select('client_id', 'user_id', DB::raw('COUNT(*) as dup_count'))
            ->whereNotNull('user_id')
            ->whereNull('deleted_at')
            ->groupBy('client_id', 'user_id')
            ->having(DB::raw('COUNT(*)'), '>', 1)
            ->get();

        $now = now();
        $softDeleted = 0;

        foreach ($groups as $g) {
            $rows = DB::table('employees')
                ->where('client_id', $g->client_id)
                ->where('user_id', $g->user_id)
                ->whereNull('deleted_at')
                ->orderByDesc('wizard_step_completed')
                ->orderByDesc('updated_at')
                ->orderByDesc('id')
                ->get(['id']);

            $rows->slice(1)->each(function ($row) use ($now, &$softDeleted) {
                DB::table('employees')->where('id', $row->id)->update([
                    'deleted_at' => $now,
                    'updated_at' => $now,
                ]);
                $softDeleted++;
            });
        }

        if ($softDeleted > 0) {
            \Illuminate\Support\Facades\Log::info(
                "[cleanup_duplicate_employees] soft-deleted {$softDeleted} duplicate employee row(s)"
            );
        }
    }

    public function down(): void
    {
    }
};
