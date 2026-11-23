<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->unsignedInteger('password_change_count')->default(0)->after('login_count');

            $table->timestamp('password_changed_at')->nullable()->after('password_change_count');
        });

        $rows = DB::table('password_histories')
            ->selectRaw('user_id, COUNT(*) AS change_count, MAX(created_at) AS last_changed_at')
            ->groupBy('user_id')
            ->get();

        foreach ($rows as $row) {
            DB::table('users')
                ->where('id', $row->user_id)
                ->update([
                    'password_change_count' => (int) $row->change_count,
                    'password_changed_at'   => $row->last_changed_at,
                ]);
        }
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['password_change_count', 'password_changed_at']);
        });
    }
};
