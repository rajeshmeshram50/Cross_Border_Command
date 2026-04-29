<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_legal_entities', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            // Identity
            $table->string('entity_code', 32)->nullable();
            $table->string('entity_name', 255)->nullable();
            $table->string('legal_name', 255)->nullable();
            $table->string('cin', 64)->nullable();
            $table->date('date_of_incorporation')->nullable();
            $table->string('type_of_business', 64)->nullable();
            $table->string('sector', 64)->nullable();
            $table->string('nature_of_business', 64)->nullable();
            $table->unsignedBigInteger('country_id')->nullable()->index();

            // Address
            $table->string('address_line1', 255)->nullable();
            $table->string('address_line2', 255)->nullable();
            $table->string('city', 128)->nullable();
            $table->unsignedBigInteger('state_id')->nullable()->index();
            $table->string('zip_code', 20)->nullable();

            // Financial
            $table->unsignedBigInteger('currency_id')->nullable()->index();
            $table->string('financial_year', 32)->nullable();

            // Documents
            $table->string('logo_path', 512)->nullable();

            $table->enum('status', ['Active', 'Inactive'])->default('Active');
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_legal_entities');
    }
};
