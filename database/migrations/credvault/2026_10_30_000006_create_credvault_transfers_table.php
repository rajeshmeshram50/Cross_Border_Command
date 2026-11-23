<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('credvault_transfers')) return;

        Schema::create('credvault_transfers', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id');
            $t->string('kind', 10);
            $t->string('code', 20);
            $t->unsignedBigInteger('user_id')->index();
            $t->string('scope', 10)->nullable();
            $t->string('format', 10);
            $t->string('file_name', 191)->nullable();
            $t->string('source', 40)->nullable();
            $t->unsignedInteger('items')->default(0);
            $t->unsignedInteger('skipped')->default(0);
            $t->unsignedInteger('weak')->default(0);
            $t->unsignedInteger('duplicates')->default(0);
            $t->unsignedBigInteger('size_bytes')->nullable();
            $t->boolean('include_passwords')->default(false);
            $t->boolean('locked')->default(false);
            $t->string('status', 10)->default('done');
            $t->string('failure_reason', 191)->nullable();
            $t->timestamp('created_at')->useCurrent();

            $t->unique(['client_id', 'code']);
            $t->index(['client_id', 'kind', 'created_at']);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("alter table credvault_transfers add constraint credvault_transfer_kind_check check (kind in ('import','export','backup'))");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('credvault_transfers');
    }
};
