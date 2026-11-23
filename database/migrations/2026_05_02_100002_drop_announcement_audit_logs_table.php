<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('announcement_audit_logs');
    }

    public function down(): void
    {
        Schema::create('announcement_audit_logs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('announcement_id')->index();
            $table->unsignedBigInteger('user_id')->nullable();
            $table->string('action', 30);
            $table->json('meta')->nullable();
            $table->timestamp('created_at')->nullable();

            $table->index(['announcement_id', 'created_at']);
        });
    }
};
