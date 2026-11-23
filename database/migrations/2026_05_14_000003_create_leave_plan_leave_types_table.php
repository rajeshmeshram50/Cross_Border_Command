<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('leave_plan_leave_types', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('leave_plan_id')->index();
            $table->unsignedBigInteger('leave_type_id')->index();
            $table->json('config_json')->nullable();
            $table->string('quota_summary', 255)->nullable();
            $table->string('eoy_summary', 255)->nullable();
            $table->boolean('is_setup')->default(false);
            $table->timestamps();

            $table->unique(['leave_plan_id', 'leave_type_id'], 'lplt_plan_type_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('leave_plan_leave_types');
    }
};
