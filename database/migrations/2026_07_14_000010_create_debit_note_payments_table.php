<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('debit_note_payments', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            $table->foreignId('debit_note_id')
                ->constrained('debit_notes', 'id', 'dn_pay_dn_id_fk')->cascadeOnDelete();

            $table->decimal('amount', 14, 2)->default(0);
            $table->string('bank_name', 128)->nullable();
            $table->string('reference_no', 64)->nullable();
            $table->date('paid_date')->nullable();
            $table->string('attachment_path', 500)->nullable();
            $table->decimal('balance_after', 14, 2)->default(0);
            $table->string('status', 24)->default('Cleared');

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
