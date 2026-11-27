<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('device_terminals', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            $table->string('serial', 64)->unique();
            $table->string('name', 100)->nullable();

            $table->string('timezone', 64)->default('Asia/Kolkata');

            $table->string('ingest_token', 80)->nullable();

            $table->boolean('is_active')->default(true);
            $table->timestamp('last_seen_at')->nullable();

            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('device_terminals');
    }
};
