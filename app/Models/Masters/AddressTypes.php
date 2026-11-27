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
        'is_system' => 'boolean',
    ];

    public const FIXED_NAMES = ['Warehouse', 'Registered Office', 'Billing Address'];

    protected static function booted(): void
    {
        static::creating(function ($model) {
            throw new \RuntimeException(
                'Address Types is a fixed master — new rows cannot be created. '
                . 'Only Warehouse, Registered Office, and Billing Address are allowed.'
            );
        });

        static::updating(function ($model) {
            if ($model->isDirty('name')) {
                throw new \RuntimeException(
                    "Address Types name cannot be modified — '{$model->getOriginal('name')}' is system-fixed."
                );
            }
        });

        static::deleting(function ($model) {
            $name = strtolower(trim((string) $model->name));
            $fixed = array_map('strtolower', self::FIXED_NAMES);
            if (in_array($name, $fixed, true)) {
                throw new \RuntimeException(
                    "Address Type '{$model->name}' is system-fixed and cannot be deleted."
                );
            }
        });
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
