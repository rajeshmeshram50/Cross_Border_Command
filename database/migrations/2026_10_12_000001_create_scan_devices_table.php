<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('scan_devices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->string('serial', 64);
            $table->string('label', 120);
            $table->string('model', 40)->default('TC27');
            $table->string('location', 120)->nullable();
            $table->string('status', 16)->default('active');
            $table->char('token_hash', 64)->unique();
            $table->timestamp('last_seen_at')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['client_id', 'serial']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('scan_devices');
    }
};
