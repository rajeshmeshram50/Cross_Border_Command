<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Recruitment had no qualification field at all (CBC #56), even though the
 * Hiring Request it is usually raised from carries `required_qualification`.
 * Until now that value was appended into the free-text `requirements` blob,
 * where it could not be read back, filtered on, or shown as its own column.
 *
 * Nullable on purpose: a recruitment may legitimately have no formal
 * qualification requirement, and making it required would block every existing
 * row from being edited.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('recruitments', function (Blueprint $table) {
            if (!Schema::hasColumn('recruitments', 'qualification')) {
                $table->string('qualification', 255)->nullable()->after('experience');
            }
        });
    }

    public function down(): void
    {
        Schema::table('recruitments', function (Blueprint $table) {
            if (Schema::hasColumn('recruitments', 'qualification')) {
                $table->dropColumn('qualification');
            }
        });
    }
};
