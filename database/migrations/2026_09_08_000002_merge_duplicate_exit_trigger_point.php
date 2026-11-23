<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const KEEP = 'Exit Management';
    private const DROP = 'Exit Process';

    public function up(): void
    {
        if (!Schema::hasTable('master_trigger_points')) return;

        $dupes = DB::table('master_trigger_points')->where('module_name', self::DROP)->pluck('id');
        if ($dupes->isEmpty()) return;

        $keep = DB::table('master_trigger_points')->where('module_name', self::KEEP)->value('id');

        if (!$keep) {
            DB::table('master_trigger_points')->whereIn('id', $dupes)->update([
                'module_name' => self::KEEP,
                'description' => 'Fires when an employee starts the exit / offboarding flow',
                'updated_at'  => now(),
            ]);
            return;
        }

        if (Schema::hasTable('hr_document_templates')) {
            DB::table('hr_document_templates')->whereIn('trigger_point_id', $dupes)
                ->update(['trigger_point_id' => $keep, 'updated_at' => now()]);
        }

        DB::table('master_trigger_points')->whereIn('id', $dupes)->delete();
    }

    public function down(): void
    {
    }
};
