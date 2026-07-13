<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('debit_note_types', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            $table->string('name', 128);
            $table->string('status', 16)->default('active'); // active / inactive

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            // Same name allowed across branches of one client (branch-scoped master).
            $table->unique(['client_id', 'branch_id', 'name'], 'debit_note_types_client_branch_name_uq');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('debit_note_types');
    }
};
