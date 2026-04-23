<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RackTypeMaster extends Model
{
    protected $table = 'master_rack_type_master';

    protected $fillable = [
        'client_id',
        'branch_id',
        'type_code',
        'type_name',
        'description',
        'suitable_for',
        'max_load_per_shelf',
        'typical_shelves',
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
}
