<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AddressTypes extends Model
{
    protected $table = 'master_address_types';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'status',
        'is_system',
        'created_by',
    ];

    protected $casts = [
        // System-seeded rows (e.g. "Office") are pinned via this flag
        // and protected from delete + name edits in MasterController.
        'is_system' => 'boolean',
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
