<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_legal_entity_banks', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('legal_entity_id')->index();
            $table->string('bank_name', 255);
            $table->string('branch_name', 255)->nullable();
            $table->string('account_number', 64);
            $table->string('ifsc_code', 32)->nullable();
            $table->string('account_type', 32)->nullable();   // Current / Savings
            $table->boolean('is_primary')->default(false);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_legal_entity_banks');
    }
};
