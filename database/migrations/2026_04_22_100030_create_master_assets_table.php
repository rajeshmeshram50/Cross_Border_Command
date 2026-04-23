<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_assets', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('asset_name', 255)->nullable();
            $table->string('asset_number', 255)->nullable();
            $table->string('asset_type_id', 255)->nullable();
            $table->date('assign_date')->nullable();
            $table->enum('status', ['Active', 'Inactive', 'Under Repair', 'Disposed'])->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_assets');
    }
};
