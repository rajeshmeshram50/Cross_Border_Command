<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('advance_recovery_ledger', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('advance_request_id');
            $table->unsignedBigInteger('employee_id');
            $table->unsignedBigInteger('client_id')->nullable();
            $table->unsignedBigInteger('branch_id')->nullable();
            $table->unsignedSmallInteger('year');
            $table->unsignedTinyInteger('month');
            $table->decimal('due', 12, 2)->default(0);
            $table->decimal('amount', 12, 2)->default(0);
            $table->decimal('carried', 12, 2)->default(0);
            $table->timestamps();

            $table->unique(['advance_request_id', 'year', 'month'], 'adv_recovery_uniq');
            $table->index(['employee_id', 'year', 'month']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('advance_recovery_ledger');
    }
};
