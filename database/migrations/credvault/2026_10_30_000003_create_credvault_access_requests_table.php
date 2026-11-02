<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * CredVault · a request to unlock a protected credential, and the unlock it
 * turns into.
 *
 * The steps run in a fixed order — Vault Admin, then Reporting Manager, then
 * the requester's authenticator code — and each one is copied from the
 * credential and the policy at the moment the request is raised. Changing
 * the policy later does not move the goalposts on a request already open.
 *
 * status is the request's life:
 *   pending   waiting on the admin or the manager
 *   approved  every approval in, waiting on the OTP
 *   unlocked  open until expires_at
 *   locked    ended early by the requester, or the window ran out
 *   rejected  refused at either approval
 *   cancelled withdrawn by the requester
 *
 * One OPEN request (pending / approved / unlocked) per credential and
 * requester — the partial unique index is what stops a double click raising two.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('credvault_access_requests')) return;

        Schema::create('credvault_access_requests', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            $t->string('code', 20);                      // REQ-0001, per client
            $t->unsignedBigInteger('credential_id')->index();
            $t->unsignedBigInteger('requester_id')->index();
            $t->string('reason', 300)->nullable();
            $t->unsignedSmallInteger('duration_minutes');

            $t->boolean('admin_required')->default(false);
            $t->unsignedBigInteger('admin_user_id')->nullable()->index();
            $t->string('admin_status', 10)->nullable();      // pending | approved | rejected
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
            $t->string('locked_reason', 20)->nullable();     // manual | expired | otp_failed
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
