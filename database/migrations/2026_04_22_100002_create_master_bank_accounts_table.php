<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_bank_accounts', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('bank_name', 255)->nullable();
            $table->string('account_holder', 255)->nullable();
            $table->string('account_number', 255)->nullable();
            $table->string('ifsc_code', 255)->nullable();
            $table->string('branch_name', 255)->nullable();
            $table->string('city', 255)->nullable();
            $table->string('swift_code', 255)->nullable();
            $table->string('ad_code', 255)->nullable();
            $table->enum('is_primary', ['No', 'Yes'])->nullable();
            $table->enum('status', ['Active', 'Inactive'])->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_bank_accounts');
    }
};
