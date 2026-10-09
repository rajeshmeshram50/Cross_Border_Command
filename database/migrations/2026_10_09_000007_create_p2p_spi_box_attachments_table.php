<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · Box photos and documents — one row per file, so a box can carry many.
 *
 * A table rather than the JSON column the rest of P2P uses for multi-file
 * fields (proof_files, inspection_note_files): removing one photo here does not
 * rewrite the others, the removal is recoverable, and a damaged product inside
 * a mixed box can be photographed on its own through box_item_id.
 *
 * box_item_id NULL  = the file is about the carton
 * box_item_id set   = the file is about one product inside it
 *
 * Only metadata lives here; the file itself is on disk under
 * storage/spi/{spi}/boxes/{box}/ like every other upload.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_spi_box_attachments', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('box_id')->index();
            $t->unsignedBigInteger('box_item_id')->nullable()->index();

            $t->string('file_path', 255);
            $t->string('file_name', 160);

            $t->unsignedBigInteger('uploaded_by')->nullable();
            $t->timestamp('created_at')->nullable();
            $t->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_spi_box_attachments');
    }
};
