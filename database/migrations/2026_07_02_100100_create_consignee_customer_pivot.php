<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Many-to-many mapping between consignees and customers. A single consignee
 * can now be linked to multiple customers. The scalar `consignees.customer_id`
 * is retained as the "primary" customer (drives the Same-as-Customer KYC
 * mirror + downstream party resolution); this pivot holds ALL mappings,
 * including the primary.
 */
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

        // Backfill: each existing consignee's single customer_id becomes a
        // mapping row so the M2M list/count matches today's data exactly.
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
