<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_exchange_rate_log', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('currency_code', 255)->nullable();
            $table->string('currency_name', 255)->nullable();
            $table->decimal('rate_vs_inr', 18, 4)->nullable();
            $table->date('effective_date')->nullable();
            $table->enum('rate_source', ['RBI Reference Rate', 'Bank Rate', 'Agreed Rate', 'Custom'])->nullable();
            $table->enum('status', ['Active', 'Superseded'])->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_exchange_rate_log');
    }
};
