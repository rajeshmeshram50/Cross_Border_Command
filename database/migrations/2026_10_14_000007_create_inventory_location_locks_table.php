<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_location_locks', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            $t->unsignedBigInteger('branch_id')->nullable()->index();

            $t->string('location_type', 10);
            $t->unsignedBigInteger('location_id');
            $t->unsignedBigInteger('warehouse_id')->index();

            $t->unsignedBigInteger('held_by')->nullable();
            $t->string('held_for_type', 40)->nullable();
            $t->unsignedBigInteger('held_for_id')->nullable();
            $t->string('session_id', 64)->nullable();
            $t->string('reason', 30)->default('putaway');

            $t->timestamp('acquired_at')->nullable();
            $t->timestamp('last_heartbeat_at')->nullable();
            $t->timestamp('expires_at')->nullable();

            $t->timestamp('released_at')->nullable();
            $t->string('released_reason', 30)->nullable();

            $t->unsignedBigInteger('created_by')->nullable();
            $t->unsignedBigInteger('updated_by')->nullable();
            $t->timestamps();

            $t->index(['held_for_type', 'held_for_id']);
        });

        DB::statement(
            "alter table inventory_location_locks add constraint location_lock_type_check
             check (location_type in ('zone','rack','shelf'))"
        );

        DB::statement(
            "create unique index uq_loc_lock_live on inventory_location_locks
             (location_type, location_id) where released_at is null"
        );
        DB::statement(
            "create index idx_loc_lock_warehouse_live on inventory_location_locks
             (warehouse_id) where released_at is null"
        );
        DB::statement(
            "create index idx_loc_lock_expiry on inventory_location_locks
             (expires_at) where released_at is null"
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_location_locks');
    }
};
