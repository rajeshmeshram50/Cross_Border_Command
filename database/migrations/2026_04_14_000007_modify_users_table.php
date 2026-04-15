<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Role & Hierarchy
            $table->string('user_type', 20)->nullable()->default('branch_user')
                ->after('email'); // super_admin, client_admin, client_user, branch_user
            $table->foreignId('client_id')->nullable()->after('user_type')
                ->constrained('clients')->cascadeOnDelete();
            $table->foreignId('branch_id')->nullable()->after('client_id')
                ->constrained('branches')->cascadeOnDelete();
            $table->foreignId('department_id')->nullable()->after('branch_id')
                ->constrained('departments')->nullOnDelete();

            // Contact
            $table->string('phone', 20)->nullable()->after('password');

            // Status
            $table->string('status', 20)->nullable()->default('active')
                ->after('phone'); // active, inactive, suspended, pending

            // Profile
            $table->string('avatar', 500)->nullable()->after('status');
            $table->string('designation', 255)->nullable()->after('avatar');
            $table->string('employee_code', 50)->nullable()->after('designation');

            // Auth tracking
            $table->timestamp('last_login_at')->nullable()->after('remember_token');
            $table->string('last_login_ip', 45)->nullable()->after('last_login_at');
            $table->integer('login_count')->nullable()->default(0)->after('last_login_ip');

            // Future: app login
            $table->string('device_token', 500)->nullable()->after('login_count'); // for push notifications
            $table->string('login_source', 20)->nullable()->after('device_token'); // web, app

            // Soft delete
            $table->softDeletes();

            // Indexes
            $table->index('user_type');
            $table->index('client_id');
            $table->index('branch_id');
            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropForeign(['client_id']);
            $table->dropForeign(['branch_id']);
            $table->dropForeign(['department_id']);
            $table->dropIndex(['user_type']);
            $table->dropIndex(['client_id']);
            $table->dropIndex(['branch_id']);
            $table->dropIndex(['status']);
            $table->dropSoftDeletes();
            $table->dropColumn([
                'user_type', 'client_id', 'branch_id', 'department_id',
                'phone', 'status', 'avatar', 'designation', 'employee_code',
                'last_login_at', 'last_login_ip', 'login_count',
                'device_token', 'login_source',
            ]);
        });
    }
};
