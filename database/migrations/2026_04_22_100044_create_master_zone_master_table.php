<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_zone_master', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('zone_id', 255)->nullable();
            $table->string('zone_name', 255)->nullable();
            $table->enum('zone_type', ['Storage Zone', 'Cold Chain Zone', 'Hazardous Zone', 'Dispatch Zone', 'Holding Zone', 'QC Hold Zone', 'Overflow Zone', 'Blocked Zone', 'Regulated Zone'])->nullable();
            $table->string('warehouse', 255)->nullable();
            $table->text('purpose')->nullable();
            $table->enum('cold_chain', ['No', 'Yes'])->nullable();
            $table->enum('hazardous', ['No', 'Yes'])->nullable();
            $table->enum('status', ['Active', 'Inactive'])->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_zone_master');
    }
};
