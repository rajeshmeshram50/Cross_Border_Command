<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_departments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('name', 255)->nullable();
            $table->string('code', 50)->nullable();
            // Self-referencing parent department (sub-departments).
            $table->unsignedBigInteger('parent_id')->nullable()->index();
            // Department head — currently a free-text name picked from a curated
            // dropdown until a real Employees master exists.
            $table->string('head', 255)->nullable();
            $table->string('email', 255)->nullable();
            $table->text('description')->nullable();
            $table->enum('status', ['Active', 'Inactive'])->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_departments');
    }
};
