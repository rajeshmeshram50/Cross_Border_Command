<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
