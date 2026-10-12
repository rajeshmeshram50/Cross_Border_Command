<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * HR · Document templates keep their code once it is issued. (#67)
 *
 * The code (IT-INT-015) was allocated as "highest surviving code + 1", and the
 * row was HARD deleted. Delete IT-INT-015 and the next template created in
 * that category took IT-INT-015 again — a code someone had already seen, filed
 * against, or quoted in an approval, now pointing at a different document.
 *
 * Soft-deleting is what makes "never reuse" expressible: the allocator can
 * only refuse to hand a number out again if the row that holds it still
 * exists. With deleted_at in place the sequence is computed over
 * withTrashed(), so the gaps a delete leaves are permanent — which is the
 * correct behaviour, exactly as it is for SPI box codes.
 *
 * Nothing else changes for callers: the SoftDeletes trait filters trashed rows
 * out of every existing query, which is what a hard delete did anyway. The two
 * relations that point here (hr_generated_documents.template_id,
 * hr_document_signatures.template_id) already resolved to null once a template
 * was deleted and still do — but the row is now recoverable behind
 * withTrashed() instead of being gone.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('hr_document_templates', function (Blueprint $t) {
            $t->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::table('hr_document_templates', function (Blueprint $t) {
            $t->dropSoftDeletes();
        });
    }
};
