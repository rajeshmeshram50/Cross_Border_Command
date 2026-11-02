<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * CredVault · a credential shared with one person or one team (department).
 *
 * A share is never deleted: revoking stamps revoked_at and the row stays as
 * the record of who could see what, and until when. Expiry is a date, not a
 * job — a share past expires_at is simply no longer honoured.
 *
 * One LIVE share per credential and recipient. Sharing again with the same
 * person updates that row (new permission, new end date) instead of stacking
 * a second one; the partial unique index enforces it under a race.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('credvault_shares')) return;

        Schema::create('credvault_shares', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            $t->unsignedBigInteger('credential_id')->index();
            $t->unsignedBigInteger('shared_by')->index();

            $t->string('recipient_type', 10);            // user | team
            $t->unsignedBigInteger('recipient_user_id')->nullable()->index();
            $t->unsignedBigInteger('recipient_department_id')->nullable()->index();

            $t->string('permission', 10);                // use | view | copy | full
            $t->string('reason', 500)->nullable();
            $t->timestamp('expires_at')->nullable();
            $t->timestamp('revoked_at')->nullable();
            $t->unsignedBigInteger('revoked_by')->nullable();
            $t->timestamps();

            $t->index(['client_id', 'shared_by', 'revoked_at']);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("alter table credvault_shares add constraint credvault_share_type_check check (recipient_type in ('user','team'))");
            DB::statement("alter table credvault_shares add constraint credvault_share_perm_check check (permission in ('use','view','copy','full'))");
            // coalesce: Postgres treats NULLs as distinct, which would let two
            // live team shares through because recipient_user_id is null on both.
            DB::statement(
                "create unique index uq_credvault_share_live on credvault_shares
                 (credential_id, recipient_type, coalesce(recipient_user_id, 0), coalesce(recipient_department_id, 0))
                 where revoked_at is null"
            );
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('credvault_shares');
    }
};
