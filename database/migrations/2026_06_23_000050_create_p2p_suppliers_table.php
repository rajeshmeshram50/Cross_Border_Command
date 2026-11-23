<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_suppliers', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable();

            $table->string('name', 255);
            $table->string('segment', 128)->nullable();
            $table->string('contact', 255)->nullable();
            $table->string('mobile', 64)->nullable();
            $table->string('email', 255)->nullable();

            $table->string('gmaps', 512)->nullable();
            $table->text('address')->nullable();
            $table->string('country', 128)->nullable();
            $table->string('state', 128)->nullable();
            $table->string('state_code', 16)->nullable();
            $table->string('city', 128)->nullable();
            $table->string('card_path', 512)->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_suppliers');
    }
};
