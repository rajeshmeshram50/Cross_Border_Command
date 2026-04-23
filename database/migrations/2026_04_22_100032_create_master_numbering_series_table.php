<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_numbering_series', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('module', 255)->nullable();
            $table->string('prefix', 255)->nullable();
            $table->enum('fy_format', ['YYYY-YY', 'YYYY', 'YY-YY', 'None'])->nullable();
            $table->decimal('next_number', 18, 4)->nullable();
            $table->enum('is_locked', ['No', 'Yes'])->nullable();
            $table->enum('status', ['Active', 'Inactive'])->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_numbering_series');
    }
};
