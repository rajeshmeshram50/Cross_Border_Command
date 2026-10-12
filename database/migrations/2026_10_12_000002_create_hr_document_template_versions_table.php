<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * HR · One row per saved version of a document template. (#34)
 *
 * The template table holds only the CURRENT content: every save overwrote
 * content_html in place, so v1 existed as a label with nothing behind it.
 * Bumping the number without keeping what the number refers to would be worse
 * than not bumping it — the Actions column now offers each version for
 * download, and a version you cannot read is not a version.
 *
 * A snapshot, not a diff: the whole body and its letterhead are copied, so a
 * download needs no reconstruction and an old version survives any later
 * change to how templates are rendered.
 *
 * No foreign keys, per the house convention — template_id is joined by hand
 * and a version outlives the template it came from on purpose, which is the
 * point of keeping it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('hr_document_template_versions', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->nullable();
            $t->unsignedBigInteger('branch_id')->nullable();
            $t->unsignedBigInteger('template_id');

            // The label as it stood when this snapshot was taken: v1, v2, …
            $t->string('version', 10);
            // Copied so a version reads correctly even after the template is
            // renamed or re-coded.
            $t->string('code', 32)->nullable();
            $t->string('name', 255)->nullable();
            $t->string('status', 20)->nullable();

            $t->string('editor_mode', 20)->nullable();
            $t->longText('content_html')->nullable();
            $t->json('header_config')->nullable();
            $t->json('footer_config')->nullable();

            /* The uploaded Word file of that version. storeDocx() writes a
               fresh randomly-named file on every upload and never deletes the
               previous one, so the path a snapshot records keeps resolving. */
            $t->string('docx_path', 500)->nullable();
            $t->string('docx_original_name', 255)->nullable();

            $t->unsignedBigInteger('created_by')->nullable();
            $t->timestamps();

            $t->index(['template_id', 'id']);
            $t->index('client_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('hr_document_template_versions');
    }
};
