<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Inventory · Product Flags Master — the handling labels a product can carry
 * (Fragile, Cold Chain, Non-Stackable …).
 *
 * SPI box items already hold their flags in a json column, so this master names
 * and explains them; it does not own the assignment.
 *
 * No code column: the displayed PF-004 is "PF-" + the id, zero-padded to 3.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_product_flags', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->nullable()->index();
            $t->unsignedBigInteger('branch_id')->nullable()->index();

            $t->string('flag_name', 120)->nullable();
            // Why the flag exists; the grid's second column.
            $t->string('purpose', 255)->nullable();

            // 1 = active, 0 = inactive.
            $t->unsignedTinyInteger('status')->default(1);
            $t->unsignedBigInteger('created_by')->nullable();
            $t->unsignedBigInteger('updated_by')->nullable();
            $t->timestamps();

            $t->index(['client_id', 'status'], 'inv_flag_client_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_product_flags');
    }
};
