<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_sourcing_targets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            $table->string('code', 16);
            $table->string('source', 16)->default('master');

            $table->date('start_date')->nullable();
            $table->date('due_date')->nullable();

            $table->unsignedBigInteger('assignee_id')->nullable()->index();
            $table->string('assignee_name', 255)->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->string('created_by_name', 255)->nullable();

            $table->string('status', 24)->default('In Progress');

            $table->timestamps();
            $table->softDeletes();
            $table->index(['client_id', 'code']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_sourcing_targets');
    }
};
