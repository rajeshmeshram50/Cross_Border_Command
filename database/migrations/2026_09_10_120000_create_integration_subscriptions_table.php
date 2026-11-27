<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('integration_subscriptions', function (Blueprint $table) {
            $table->id();

            $table->string('name');
            $table->string('provider')->nullable();
            $table->string('category')->nullable();

            $table->string('owner_name')->nullable();
            $table->string('owner_email');

            $table->date('expires_at');
            $table->json('reminder_days');

            $table->boolean('auto_renew')->default(false);
            $table->string('status')->default('active');

            $table->decimal('amount', 12, 2)->nullable();
            $table->string('currency', 3)->default('INR');

            $table->text('notes')->nullable();

            $table->json('reminders_sent')->nullable();
            $table->date('last_reminded_on')->nullable();

            $table->unsignedBigInteger('created_by')->nullable();

            $table->timestamps();

            $table->index(['status', 'expires_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('integration_subscriptions');
    }
};
