<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ClmTradeDocLibrary extends Model
{
    protected $table = 'clm_trade_doc_library';

    protected $fillable = [
        'client_id', 'code', 'name', 'title', 'doc_type', 'purpose',
        'party', 'file_path', 'content', 'docx_path', 'docx_original_name',
        'header_config', 'footer_config',
        'status', 'created_by', 'updated_by',
    ];

    /** Page-shell header/footer config — same JSON shape used by
     *  hr_document_templates so [[HeaderFooterPanel.tsx]] reads them back
     *  as plain objects with no extra coercion on the frontend. */
    protected $casts = [
        'header_config' => 'array',
        'footer_config' => 'array',
    ];

    public function client(): BelongsTo { return $this->belongsTo(Client::class); }
}
