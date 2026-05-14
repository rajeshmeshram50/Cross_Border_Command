<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds the free-text "Used in Templates" hint to hr_custom_fields. This is
 * the user's *intent* ("I'm creating this for Relieving Letter + Experience
 * Letter") and is independent from the server-derived `used_in` array
 * (which scans hr_document_templates.content_html for the literal
 * {{FieldName}} placeholder).
 *
 * Why keep both: at create time a custom field has zero real usage (no
 * template references it yet), so the auto-derived column always reads
 * empty until someone wires it up. The hint gives the user a place to
 * record their intent up-front so the page isn't blank for newly-added
 * fields.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('hr_custom_fields', function (Blueprint $table) {
            $table->string('used_in_hint', 500)->nullable()->after('description');
        });
    }

    public function down(): void
    {
        Schema::table('hr_custom_fields', function (Blueprint $table) {
            $table->dropColumn('used_in_hint');
        });
    }
};
