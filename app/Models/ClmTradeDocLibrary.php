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
        'status', 'created_by', 'updated_by',
    ];

    public function client(): BelongsTo { return $this->belongsTo(Client::class); }
}
