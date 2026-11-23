<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('credvault_access_requests')) return;

        Schema::create('credvault_access_requests', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            $t->string('code', 20);
            $t->unsignedBigInteger('credential_id')->index();
            $t->unsignedBigInteger('requester_id')->index();
            $t->string('reason', 300)->nullable();
            $t->unsignedSmallInteger('duration_minutes');

            $t->boolean('admin_required')->default(false);
            $t->unsignedBigInteger('admin_user_id')->nullable()->index();
            $t->string('admin_status', 10)->nullable();
            $t->unsignedBigInteger('admin_decided_by')->nullable();
            $t->timestamp('admin_decided_at')->nullable();
            $t->string('admin_note', 300)->nullable();

            $t->boolean('manager_required')->default(false);
            $t->unsignedBigInteger('manager_user_id')->nullable()->index();
            $t->string('manager_status', 10)->nullable();
            $t->unsignedBigInteger('manager_decided_by')->nullable();
            $t->timestamp('manager_decided_at')->nullable();
            $t->string('manager_note', 300)->nullable();

            $t->boolean('otp_required')->default(false);
            $t->timestamp('otp_verified_at')->nullable();
            $t->unsignedTinyInteger('otp_attempts')->default(0);

            $t->string('status', 10)->default('pending');
            $t->timestamp('unlocked_at')->nullable();
            $t->timestamp('expires_at')->nullable();
            $t->timestamp('locked_at')->nullable();
            $t->string('locked_reason', 20)->nullable();
            $t->timestamps();

            $t->unique(['client_id', 'code']);
            $t->index(['client_id', 'status']);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement(
                "alter table credvault_access_requests add constraint credvault_req_status_check
                 check (status in ('pending','approved','unlocked','locked','rejected','cancelled'))"
            );
            DB::statement(
                "create unique index uq_credvault_req_open on credvault_access_requests
                 (credential_id, requester_id) where status in ('pending','approved','unlocked')"
            );
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('credvault_access_requests');
    }
};
