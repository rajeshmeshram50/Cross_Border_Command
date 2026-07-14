<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('debit_note_payments', function (Blueprint $table) {
            $table->id();

            // Tenant scope (stamped from debit_notes / acting user).
            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            // The recovery ALWAYS belongs to a debit note.
            $table->foreignId('debit_note_id')
                ->constrained('debit_notes', 'id', 'dn_pay_dn_id_fk')->cascadeOnDelete();

            $table->decimal('amount', 14, 2)->default(0);        // amount recovered in this transaction
            $table->string('bank_name', 128)->nullable();
            $table->string('reference_no', 64)->nullable();      // UTR / cheque / txn reference
            $table->date('paid_date')->nullable();
            $table->string('attachment_path', 500)->nullable();  // proof of payment
            $table->decimal('balance_after', 14, 2)->default(0); // running DN balance snapshot after this recovery
            $table->string('status', 24)->default('Cleared');    // Cleared / Pending

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['debit_note_id', 'id'], 'dn_pay_dn_id_idx');
            $table->index(['client_id', 'debit_note_id'], 'dn_pay_client_dn_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('debit_note_payments');
    }
};
