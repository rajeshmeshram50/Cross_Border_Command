<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_racks', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->enum('whType', ['Own Warehouse', 'Third Party Warehouse'])->nullable();
            $table->string('warehouse', 255)->nullable();
            $table->string('zone', 255)->nullable();
            $table->string('rackName', 255)->nullable();
            $table->string('rackType', 255)->nullable();
            $table->enum('rackStatus', ['Partially Filled', 'Full', 'Blocked', 'Reserved', 'Under Maintenance', 'Empty'])->nullable();
            $table->string('tempClass', 255)->nullable();
            $table->decimal('shelves', 18, 4)->nullable();
            $table->decimal('maxWeight', 18, 4)->nullable();
            $table->decimal('maxVolume', 18, 4)->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_racks');
    }
};
