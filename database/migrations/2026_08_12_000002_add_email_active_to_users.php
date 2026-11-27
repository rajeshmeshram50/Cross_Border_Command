<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('users', 'email_active')) {
            Schema::table('users', function (Blueprint $table) {
                $table->boolean('email_active')->default(true)->after('status');
            });
        }

        if (Schema::hasTable('employee_exits') && Schema::hasColumn('users', 'email_active')) {
            $userIds = DB::table('employees')
                ->join('employee_exits', 'employee_exits.employee_id', '=', 'employees.id')
                ->where('employee_exits.exit_case_status', 'Closed')
                ->whereNull('employee_exits.rehired_at')
                ->whereNotNull('employees.user_id')
                ->pluck('employees.user_id')
                ->all();

            if (!empty($userIds)) {
                DB::table('users')->whereIn('id', $userIds)->update(['email_active' => false]);
            }
        }

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS users_email_client_unique');
            DB::statement('CREATE UNIQUE INDEX users_email_client_unique ON users (COALESCE(client_id, 0), email) WHERE deleted_at IS NULL AND email_active = true');
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS users_email_client_unique');
            DB::statement('CREATE UNIQUE INDEX users_email_client_unique ON users (COALESCE(client_id, 0), email) WHERE deleted_at IS NULL');
        }
        if (Schema::hasColumn('users', 'email_active')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('email_active');
            });
        }
    }
};
