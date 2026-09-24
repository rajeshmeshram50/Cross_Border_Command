<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ClmTncLibrary extends Model
{
    use BelongsToTenant;
    protected $table = 'clm_tnc_library';

    protected $fillable = [
        'client_id', 'branch_id', 'code', 'segment', 'segment_ids', 'regulatory', 'category', 'scope', 'party', 'content', 'status',
        'created_by', 'updated_by',
    ];

    /** 'segment' - matched by the product's segment; 'global' - one per document category. */
    public const SCOPE_SEGMENT = 'segment';
    public const SCOPE_GLOBAL = 'global';

    protected $casts = ['segment_ids' => 'array'];

    public function client(): BelongsTo { return $this->belongsTo(Client::class); }
}
