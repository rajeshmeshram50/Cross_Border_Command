<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_warehouse_master', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('wh_id', 255)->nullable();
            $table->string('wh_name', 255)->nullable();
            $table->enum('wh_type', ['Own Warehouse', 'Third Party Warehouse'])->nullable();
            $table->string('city', 255)->nullable();
            $table->string('state', 255)->nullable();
            $table->string('pincode', 255)->nullable();
            $table->string('contact_person', 255)->nullable();
            $table->string('contact_phone', 255)->nullable();
            $table->decimal('area_sqft', 18, 4)->nullable();
            $table->text('address')->nullable();
            $table->enum('status', ['Active', 'Inactive'])->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_warehouse_master');
    }
};
