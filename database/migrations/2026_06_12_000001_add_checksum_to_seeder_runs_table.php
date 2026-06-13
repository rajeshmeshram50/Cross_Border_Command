<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds a content `checksum` to the `seeder_runs` ledger so DatabaseSeeder can
 * tell a CHANGED seeder file from an unchanged one.
 *
 * Before this, the ledger keyed only on the seeder name — once recorded, a
 * seeder never ran again even after it was edited (new entries were missed
 * on `db:seed`). Now each row also stores the md5 of the seeder's file. A
 * plain `db:seed` re-runs a seeder ONLY when its file checksum differs from
 * what's recorded; because every seeder upserts by key (updateOrCreate),
 * re-running inserts just the NEW rows and never duplicates existing ones.
 *
 * Existing rows get a NULL checksum, which DatabaseSeeder treats as
 * "needs a backfill run" — a one-time, idempotent re-run that records the
 * real checksum, after which unchanged seeders are skipped again.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('seeder_runs')) {
            return;
        }
        Schema::table('seeder_runs', function (Blueprint $table) {
            if (!Schema::hasColumn('seeder_runs', 'checksum')) {
                $table->string('checksum', 64)->nullable()->after('seeder');
            }
        });
    }

    public function down(): void
    {
        if (Schema::hasTable('seeder_runs') && Schema::hasColumn('seeder_runs', 'checksum')) {
            Schema::table('seeder_runs', function (Blueprint $table) {
                $table->dropColumn('checksum');
            });
        }
    }
};
