<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('credvault_policies')) return;

        Schema::create('credvault_policies', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->unique();
            $t->json('settings');
            $t->unsignedBigInteger('updated_by')->nullable();
            $t->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('credvault_policies');
    }
};
