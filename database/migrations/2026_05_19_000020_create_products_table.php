<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->nullable()->constrained('clients')->cascadeOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->cascadeOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();

            $table->string('product_code', 50)->nullable()->unique();
            $table->string('name', 255);
            $table->string('generic_name', 255)->nullable();
            $table->text('description')->nullable();
            $table->string('brand', 255)->nullable();

            // Master FK references — nullable so a partial save (Step 1 Core only) is valid.
            // No FK constraints: keeps the products table flexible if a master row is deleted/replaced.
            $table->unsignedBigInteger('segment_id')->nullable();
            $table->string('haz_type', 20)->nullable();             // 'Haz' | 'Non-Haz'
            $table->unsignedBigInteger('haz_class_id')->nullable();
            $table->unsignedBigInteger('uom_id')->nullable();
            $table->unsignedBigInteger('hsn_id')->nullable();
            $table->unsignedBigInteger('condition_id')->nullable();
            $table->unsignedBigInteger('packaging_material_id')->nullable();
            $table->text('confidential_info')->nullable();

            $table->string('primary_image', 500)->nullable();
            $table->json('secondary_images')->nullable();

            // Sales
            $table->decimal('base_price', 15, 2)->nullable();
            $table->unsignedBigInteger('gst_id')->nullable();
            $table->decimal('gst_amount', 15, 2)->nullable();
            $table->decimal('total_price', 15, 2)->nullable();
            $table->string('mark_bottom', 30)->nullable();          // 'Bottom' | 'Non Bottom'

            // Quality - Box matrix
            $table->decimal('net_weight', 12, 3)->nullable();
            $table->decimal('gross_weight', 12, 3)->nullable();
            $table->decimal('length_cm', 12, 2)->nullable();
            $table->decimal('width_cm', 12, 2)->nullable();
            $table->decimal('height_cm', 12, 2)->nullable();

            // Workflow
            // draft     → Core info saved only
            // inactive  → All Step 1 (Core + Sales + Quality) done, no vendor yet
            // active    → Step 2 vendor mapping also complete
            $table->string('status', 20)->default('draft');
            $table->unsignedTinyInteger('step_completed')->default(0); // 0..4 (1=core, 2=sales, 3=quality, 4=vendors)

            $table->timestamps();
            $table->softDeletes();

            $table->index(['client_id', 'branch_id', 'status']);
            $table->index('name');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('products');
    }
};
