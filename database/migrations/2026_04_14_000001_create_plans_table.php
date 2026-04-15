<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('plans', function (Blueprint $table) {
            $table->id();

            // Plan Info
            $table->string('name', 100)->nullable();
            $table->string('slug', 100)->unique()->nullable();
            $table->decimal('price', 10, 2)->nullable()->default(0);
            $table->string('period', 20)->nullable()->default('month'); // month, quarter, year

            // Limits
            $table->integer('max_branches')->nullable();
            $table->integer('max_users')->nullable();
            $table->string('storage_limit', 20)->nullable(); // '1GB', '25GB'
            $table->string('support_level', 50)->nullable(); // 'Email', 'Priority', 'Dedicated'

            // Display
            $table->boolean('is_featured')->nullable()->default(false);
            $table->string('badge', 50)->nullable(); // 'Most Popular', 'Best Value'
            $table->string('color', 7)->nullable();
            $table->text('description')->nullable();
            $table->string('best_for', 255)->nullable();

            // Status
            $table->string('status', 20)->nullable()->default('active');
            $table->integer('sort_order')->nullable()->default(0);

            // Future fields
            $table->integer('trial_days')->nullable();
            $table->decimal('yearly_discount', 5, 2)->nullable(); // percentage discount for yearly
            $table->boolean('is_custom')->nullable()->default(false);

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('plans');
    }
};
