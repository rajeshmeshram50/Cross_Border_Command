<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_supplier_categories', function (Blueprint $table) {
            $table->id();

            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('created_by')->nullable()->index();

            $table->string('name');
            $table->enum('supplier_service', ['self', 'other'])->default('self');
            $table->string('supplier_type')->nullable();

            $table->boolean('status')->default(1);

            $table->boolean('is_system')->default(false);

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_supplier_categories');
    }
};
