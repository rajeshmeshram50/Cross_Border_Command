<?php

namespace App\Models\P2p;

use App\Models\Branch;
use App\Models\Client;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * P2P · Bulk Sourcing — a sourcing target (batch of products to source).
 */
class SourcingTarget extends Model
{
    use SoftDeletes;

    protected $table = 'p2p_sourcing_targets';

    protected $fillable = [
        'client_id', 'branch_id', 'code', 'source',
        'start_date', 'due_date',
        'assignee_id', 'assignee_name',
        'created_by', 'created_by_name',
        'status',
    ];

    protected $casts = [
        'start_date' => 'date',
        'due_date'   => 'date',
    ];

    public function products(): HasMany
    {
        return $this->hasMany(SourcingProduct::class, 'sourcing_target_id');
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }
}
