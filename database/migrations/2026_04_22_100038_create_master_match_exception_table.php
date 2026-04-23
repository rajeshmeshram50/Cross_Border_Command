<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_match_exception', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('exc_code', 255)->nullable();
            $table->string('exc_name', 255)->nullable();
            $table->decimal('tolerance_pct', 18, 4)->nullable();
            $table->enum('blocks_payment', ['Yes — Hard Block', 'Yes — Soft Block (Warning)', 'No'])->nullable();
            $table->string('resolver_role', 255)->nullable();
            $table->enum('status', ['Active', 'Inactive'])->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_match_exception');
    }
};
