<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_vendor_directory', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('vendor_company_name', 255)->nullable();
            $table->string('contact_person', 255)->nullable();
            $table->string('mobile_number', 255)->nullable();
            $table->string('email_id', 255)->nullable();
            $table->string('segment_id', 255)->nullable();
            $table->string('address', 255)->nullable();
            $table->enum('country', ['India', 'USA', 'UAE', 'UK', 'Germany', 'Australia', 'Singapore', 'Other'])->nullable();
            $table->string('state', 255)->nullable();
            $table->string('city', 255)->nullable();
            $table->enum('mapping_mode', ['Map from Vendor Master', 'Map New Vendor'])->nullable();
            $table->enum('status', ['Active', 'Inactive'])->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_vendor_directory');
    }
};
