<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_goods_service_flag', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('flag_code', 255)->nullable();
            $table->string('flag_name', 255)->nullable();
            $table->enum('grn_screen', ['Physical Receipt — Qty + Batch + Warehouse', 'Service Completion — Date + Proof Doc', 'Mixed — Partial Goods + Service'])->nullable();
            $table->string('evidence_type', 255)->nullable();
            $table->enum('status', ['Active', 'Inactive'])->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_goods_service_flag');
    }
};
