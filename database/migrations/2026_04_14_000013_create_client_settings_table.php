<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('client_settings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->nullable()->constrained('clients')->cascadeOnDelete();

            $table->string('group', 50)->nullable()->default('general'); // general, branding, security, notification, approval
            $table->string('key', 100)->nullable();
            $table->text('value')->nullable();
            $table->string('type', 20)->nullable()->default('string'); // string, boolean, integer, json
            $table->text('description')->nullable();

            $table->timestamps();

            $table->unique(['client_id', 'key']);
            $table->index(['client_id', 'group']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('client_settings');
    }
};
