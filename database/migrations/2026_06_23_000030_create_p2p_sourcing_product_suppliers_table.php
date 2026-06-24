<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · Bulk Sourcing — suppliers mapped against a sourcing product.
 *
 * source=master rows point at a Vendor (supplier_id) and snapshot its details;
 * source=new rows are ad-hoc suppliers captured inline via the "New Supplier"
 * form (address fields included).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_sourcing_product_suppliers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sourcing_product_id')->constrained('p2p_sourcing_products')->cascadeOnDelete();

            $table->unsignedBigInteger('supplier_id')->nullable();  // vendors.id (master only)
            $table->string('source', 16)->default('master');        // master | new

            $table->string('name', 255);
            $table->string('segment', 128)->nullable();
            $table->string('contact', 255)->nullable();
            $table->string('mobile', 64)->nullable();
            $table->string('email', 255)->nullable();

            // New-supplier address details
            $table->string('gmaps', 512)->nullable();
            $table->text('address')->nullable();
            $table->string('country', 128)->nullable();
            $table->string('state', 128)->nullable();
            $table->string('state_code', 16)->nullable();
            $table->string('city', 128)->nullable();

            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_sourcing_product_suppliers');
    }
};
