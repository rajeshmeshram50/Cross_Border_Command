<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ClmAgreementLibrary extends Model
{
    protected $table = 'clm_agreement_library';

    public const REG_HIGHLY = 'highly';
    public const REG_LESS   = 'less';
    public const REG_VALUES = [self::REG_HIGHLY, self::REG_LESS];

    protected $fillable = [
        'client_id', 'code', 'agreement_type', 'title', 'purpose', 'party',
        'regulatory', 'signing', 'segment', 'agr_status', 'content',
        'docx_path', 'docx_original_name',
        'header_config', 'footer_config', 'status',
        'created_by', 'updated_by',
    ];

    protected $casts = [
        'signing'       => 'boolean',
        'header_config' => 'array',
        'footer_config' => 'array',
    ];

    public function client(): BelongsTo { return $this->belongsTo(Client::class); }
}
