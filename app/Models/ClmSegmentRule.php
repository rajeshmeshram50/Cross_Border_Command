<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ClmSegmentRule extends Model
{
    public const REG_HIGHLY = 'highly';
    public const REG_LESS   = 'less';
    public const REG_VALUES = [self::REG_HIGHLY, self::REG_LESS];

    // Domestic vs International trade — a segment can hold one rule of each type,
    // each with its own required-document set. Defaults to International (the
    // column is NOT NULL DEFAULT 'international'; legacy rows were backfilled).
    public const DOC_DOMESTIC      = 'domestic';
    public const DOC_INTERNATIONAL = 'international';
    public const DOC_TYPE_VALUES   = [self::DOC_DOMESTIC, self::DOC_INTERNATIONAL];

    protected $fillable = [
        'client_id', 'branch_id', 'segment_id', 'segment_code', 'rule_code',
        'regulatory_status', 'document_type', 'auths_json', 'doc_selections',
        'mandatory_count', 'optional_count', 'status',
        'created_by', 'updated_by',
    ];

    protected $casts = [
        'auths_json'      => 'array',
        'doc_selections'  => 'array',
        'mandatory_count' => 'integer',
        'optional_count'  => 'integer',
    ];

    public function client(): BelongsTo  { return $this->belongsTo(Client::class); }
    public function segment(): BelongsTo { return $this->belongsTo(ClmSegment::class, 'segment_id'); }
}
