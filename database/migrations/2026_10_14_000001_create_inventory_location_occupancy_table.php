<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_location_occupancy', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            $t->unsignedBigInteger('branch_id')->nullable()->index();

            $t->unsignedBigInteger('warehouse_id')->index();
            $t->unsignedBigInteger('zone_id')->index();
            $t->unsignedBigInteger('rack_id')->nullable();
            $t->unsignedBigInteger('shelf_id')->nullable();

            $t->string('occupant_type', 40);
            $t->unsignedBigInteger('occupant_id');
            $t->string('box_code', 40)->nullable();

            $t->decimal('weight_kg', 12, 3)->default(0);
            $t->decimal('volume_cm3', 16, 2)->nullable();
            $t->decimal('footprint_cm2', 14, 2)->nullable();

            $t->string('status', 12)->default('reserved');
            $t->timestamp('reserved_at')->nullable();
            $t->timestamp('placed_at')->nullable();
            $t->unsignedBigInteger('placed_by')->nullable();
            $t->timestamp('released_at')->nullable();
            $t->string('released_reason', 120)->nullable();

            $t->unsignedBigInteger('created_by')->nullable();
            $t->unsignedBigInteger('updated_by')->nullable();

            $t->timestamps();

            $t->index(['occupant_type', 'occupant_id']);
        });

        DB::statement(
            "alter table inventory_location_occupancy add constraint occ_status_check
             check (status in ('reserved','occupied','released'))"
        );

        DB::statement(
            "create unique index uq_occ_occupant_live on inventory_location_occupancy
             (occupant_type, occupant_id) where status in ('reserved','occupied')"
        );
        DB::statement(
            "create index idx_occ_shelf_live on inventory_location_occupancy
             (shelf_id) where status in ('reserved','occupied')"
        );
        DB::statement(
            "create index idx_occ_zone_live on inventory_location_occupancy
             (zone_id) where status in ('reserved','occupied')"
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_location_occupancy');
    }
};
