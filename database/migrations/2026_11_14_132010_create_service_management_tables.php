<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_services', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('created_by')->nullable();

            $table->string('code')->unique();
            $table->string('name');
            $table->text('description')->nullable();

            $table->string('service_type');
            $table->string('classification')->nullable();

            $table->unsignedBigInteger('segment_id')->nullable();
            $table->unsignedBigInteger('hsn_id')->nullable();
            $table->unsignedBigInteger('uom_id')->nullable();
            $table->unsignedBigInteger('haz_class_id')->nullable();
            $table->unsignedBigInteger('condition_id')->nullable();
            $table->unsignedBigInteger('packaging_id')->nullable();
            $table->unsignedBigInteger('department_id')->nullable();
            $table->string('billing_frequency')->nullable();

            $table->decimal('gst_percentage', 5, 2)->default(0.00);

            $table->boolean('contract_required')->default(false);

            $table->string('status')->default('Active');
            $table->timestamps();
            $table->softDeletes();
        });

        Schema::create('p2p_service_suppliers', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('service_id')->index();
            $table->unsignedBigInteger('vendor_id')->index();

            $table->decimal('price', 15, 2);
            $table->decimal('gst_percentage', 5, 2);
            $table->decimal('gst_amount', 15, 2);
            $table->decimal('total_amount', 15, 2);

            $table->timestamps();

            $table->unique(['service_id', 'vendor_id']);
        });

        Schema::create('p2p_service_images', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('service_id')->index();
            $table->string('file_path');
            $table->boolean('is_primary')->default(false);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_service_images');
        Schema::dropIfExists('p2p_service_suppliers');
        Schema::dropIfExists('p2p_services');
    }
};
