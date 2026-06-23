<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · Bulk Sourcing — products belonging to a sourcing target.
 *
 * Rows come from the Product Master (source=master, snapshotted by code so the
 * target is stable even if the master later changes) or are typed in by hand
 * (source=manual). `clarity_*` holds the optional per-product spec note.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_sourcing_products', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sourcing_target_id')->constrained('p2p_sourcing_targets')->cascadeOnDelete();

            $table->string('source', 16)->default('master');   // master | manual
            $table->unsignedBigInteger('product_id')->nullable();   // products.id (master only)

            $table->string('code', 64)->nullable();
            $table->string('name', 255);
            $table->string('segment', 128)->nullable();
            $table->string('hsn', 64)->nullable();
            $table->string('target_price', 64)->nullable();

            $table->string('clarity_type', 16)->nullable();     // text | link | pdf
            $table->text('clarity_value')->nullable();

            $table->string('status', 16)->default('In Progress'); // In Progress | Completed

            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_sourcing_products');
    }
};
