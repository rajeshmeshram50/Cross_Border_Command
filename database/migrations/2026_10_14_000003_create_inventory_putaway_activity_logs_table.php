<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_putaway_activity_logs', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            $t->unsignedBigInteger('branch_id')->nullable()->index();

            $t->string('subject_type', 40);
            $t->unsignedBigInteger('subject_id');

            $t->unsignedBigInteger('occupancy_id')->nullable();
            $t->unsignedBigInteger('putaway_id')->nullable();
            $t->unsignedBigInteger('task_id')->nullable();
            $t->unsignedBigInteger('box_id')->nullable();

            $t->string('event', 30);

            $t->json('from_location')->nullable();
            $t->json('to_location')->nullable();

            $t->string('actor_type', 20)->nullable();
            $t->unsignedBigInteger('actor_id')->nullable();
            $t->unsignedBigInteger('device_id')->nullable();
            $t->json('meta')->nullable();

            $t->unsignedBigInteger('created_by')->nullable();

            $t->timestamp('created_at')->useCurrent();

            $t->index(['box_id', 'created_at']);
            $t->index(['occupancy_id', 'created_at']);
            $t->index(['client_id', 'actor_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_putaway_activity_logs');
    }
};
