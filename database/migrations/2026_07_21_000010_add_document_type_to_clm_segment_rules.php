<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Document Control Panel · Segment Rules — Domestic / International split.
 *
 * A segment rule now carries a `document_type` (domestic | international) so a
 * single segment can hold TWO rules with different required-document sets: one
 * for domestic trade and one for international. Nullable because rules created
 * before this change have no type — they stay untyped ("legacy") until edited,
 * and the app-layer duplicate check treats null as its own bucket so they are
 * never forced to adopt a type by the migration itself.
 *
 * As with the segment_code guard, uniqueness of (segment_code, document_type)
 * is enforced in the controller, NOT via a DB UNIQUE index — a DB constraint
 * would fail to install against any pre-existing duplicate rows.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('clm_segment_rules', function (Blueprint $table) {
            $table->string('document_type', 16)->nullable()->after('regulatory_status');
            $table->index(['client_id', 'segment_id', 'document_type']);
        });
    }

    public function down(): void
    {
        Schema::table('clm_segment_rules', function (Blueprint $table) {
            $table->dropIndex(['client_id', 'segment_id', 'document_type']);
            $table->dropColumn('document_type');
        });
    }
};
