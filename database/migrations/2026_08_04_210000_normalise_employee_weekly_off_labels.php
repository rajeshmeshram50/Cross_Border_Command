<?php

use App\Support\WeekOff;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        foreach (DB::table('employees')->get(['id', 'weekly_off']) as $e) {
            $canonical = WeekOff::normalise($e->weekly_off);
            if ((string) $e->weekly_off === $canonical) continue;
            DB::table('employees')->where('id', $e->id)->update(['weekly_off' => $canonical]);
        }
    }

    public function down(): void
    {
    }
};
