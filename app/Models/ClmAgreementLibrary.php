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
        'client_id', 'code', 'agreement_type', 'title', 'party',
        'regulatory', 'signing', 'segment', 'agr_status', 'content', 'status',
        'created_by', 'updated_by',
    ];

    protected $casts = [
        'signing' => 'boolean',
    ];

    public function client(): BelongsTo { return $this->belongsTo(Client::class); }
}
