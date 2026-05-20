<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class StateCodes extends Model
{
    protected $table = 'master_state_codes';

    protected $fillable = [
        'client_id',
        'branch_id',
        'state_id',
        'state_code',
        'status',
        'created_by',
    ];

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * The state this code is for. Eager-loaded by MasterController so the
     * list endpoint returns the state name inline — without this the
     * frontend would have to download every row of master_states (tens
     * of thousands of subdivisions) just to translate the id.
     */
    public function state(): BelongsTo
    {
        return $this->belongsTo(States::class, 'state_id');
    }
}
