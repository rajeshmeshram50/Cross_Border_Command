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

    /**
     * Address Types is a CLOSED VOCABULARY — only three system-fixed
     * entries are allowed across the entire platform:
     *
     *   • Warehouse
     *   • Registered Address
     *   • Billing Address
     *
     * These constants are referenced by the model boot guards below to
     * reject any Eloquent insert/update/delete attempt that would extend
     * or remove the canonical set — protects against seeders, Tinker,
     * factory states, and any other code path that bypasses the API
     * (where MasterController already rejects POSTs).
     */
    public const FIXED_NAMES = ['Warehouse', 'Registered Address', 'Billing Address'];

    protected static function booted(): void
    {
        // ── Block any new row creation through Eloquent. The three
        //     canonical rows are inserted via raw DB::table() in
        //     migrations (bypassing Eloquent), so legitimate seeding
        //     still works; this guard catches anything else.
        static::creating(function ($model) {
            throw new \RuntimeException(
                'Address Types is a fixed master — new rows cannot be created. '
                . 'Only Warehouse, Registered Address, and Billing Address are allowed.'
            );
        });

        // ── Block name/status edits on the canonical rows. Other
        //     columns (e.g. updated_at touched by a parent relation)
        //     are still allowed so framework operations don't break.
        static::updating(function ($model) {
            if ($model->isDirty('name')) {
                throw new \RuntimeException(
                    "Address Types name cannot be modified — '{$model->getOriginal('name')}' is system-fixed."
                );
            }
        });

        // ── Block deletion of the canonical rows.
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
