<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class VendorTypes extends Model
{
    protected $table = 'master_vendor_types';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'kind',
        'service_type',
        'classification',
        'description',
        'status',
        'is_system',
        'created_by',
    ];

    protected $casts = ['is_system' => 'boolean'];

    /** The dropdown's group heading; null for the three ungrouped types. */
    public function getGroupAttribute(): ?string
    {
        return match ($this->service_type) {
            'self_consumable'   => 'Self Consumable Service Provider',
            'other_operational' => 'Other Operational Service Provider',
            default             => null,
        };
    }

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
