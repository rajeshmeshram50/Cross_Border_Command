<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ClmSegmentRule extends Model
{
    public const REG_HIGHLY = 'highly';
    public const REG_LESS   = 'less';
    public const REG_VALUES = [self::REG_HIGHLY, self::REG_LESS];

    protected $fillable = [
        'client_id', 'segment_id', 'segment_code', 'rule_code',
        'regulatory_status', 'auths_json', 'doc_selections',
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
