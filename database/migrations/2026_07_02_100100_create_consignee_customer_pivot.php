<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('consignee_customer', function (Blueprint $table) {
            $table->id();
            $table->foreignId('consignee_id')->constrained('consignees')->cascadeOnDelete();
            $table->foreignId('customer_id')->constrained('customers')->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['consignee_id', 'customer_id']);
        });

        DB::statement("
            INSERT INTO consignee_customer (consignee_id, customer_id, created_at, updated_at)
            SELECT id, customer_id, now(), now()
            FROM consignees
            WHERE customer_id IS NOT NULL
            ON CONFLICT (consignee_id, customer_id) DO NOTHING
        ");
    }

    public function down(): void
    {
        Schema::dropIfExists('consignee_customer');
    }
};
