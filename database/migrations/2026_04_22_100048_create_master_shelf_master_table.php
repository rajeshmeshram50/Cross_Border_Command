<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_shelf_master', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('rack_ref', 255)->nullable();
            $table->string('shelf_name', 255)->nullable();
            $table->decimal('level_no', 18, 4)->nullable();
            $table->enum('shelf_type', ['Standard Shelf', 'Cold Shelf', 'Heavy Duty Shelf', 'Cantilever Shelf', 'Mesh Shelf', 'Wire Deck Shelf'])->nullable();
            $table->decimal('max_weight', 18, 4)->nullable();
            $table->enum('status', ['Available', 'Partially Used', 'Full', 'Blocked', 'Under Maintenance'])->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_shelf_master');
    }
};
