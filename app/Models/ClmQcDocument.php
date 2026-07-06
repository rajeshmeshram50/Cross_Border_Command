<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ClmQcDocument extends Model
{
    public const TYPE_CERT = 'cert';
    public const TYPE_COMP = 'comp';
    public const TYPES     = [self::TYPE_CERT, self::TYPE_COMP];

    public const STATUS_ACTIVE   = 'active';
    public const STATUS_INACTIVE = 'inactive';
    public const STATUSES        = [self::STATUS_ACTIVE, self::STATUS_INACTIVE];

    protected $fillable = [
        'client_id', 'branch_id', 'code', 'name', 'purpose', 'issued_by', 'doc_type',
        'qa_params', 'min_criteria', 'status',
        'created_by', 'updated_by',
    ];

    public function client(): BelongsTo { return $this->belongsTo(Client::class); }
}
