<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Ledger of which seeders have already run — the seeder equivalent of the
 * `migrations` table. DatabaseSeeder records each seeder class here after it
 * runs, so a plain `php artisan db:seed` only executes seeders NOT yet in
 * this table. When everything is already applied it prints "Nothing to seed"
 * instead of re-running (and re-printing) every seeder.
 *
 * `migrate:fresh` drops this table and recreates it empty, so a fresh DB
 * still seeds everything. `db:seed --class=Foo` bypasses the ledger to
 * force-run a single seeder (e.g. after editing it).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('seeder_runs', function (Blueprint $table) {
            $table->id();
            $table->string('seeder')->unique();   // class name or logical task key
            $table->timestamp('ran_at')->useCurrent();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('seeder_runs');
    }
};
