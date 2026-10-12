<?php

namespace App\Models\Inventory;

use App\Models\Branch;
use App\Models\Client;
use App\Models\Concerns\BelongsToTenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Inventory · a handling label a product can carry (Fragile, Cold Chain …).
 *
 * SPI box items hold their flags in a json column, so this master names and
 * explains them; it does not own the assignment.
 */
class ProductFlag extends Model
{
    use BelongsToTenant;

    protected $table = 'inventory_product_flags';

    protected $fillable = [
        'client_id', 'branch_id',
        'flag_name', 'purpose',
        'status', 'created_by', 'updated_by',
    ];

    protected $casts = ['status' => 'integer'];

    protected $appends = ['flag_code'];

    public function getFlagCodeAttribute(): string
    {
        return 'PF-' . str_pad((string) $this->id, 3, '0', STR_PAD_LEFT);
    }

    public function client(): BelongsTo    { return $this->belongsTo(Client::class); }
    public function branch(): BelongsTo    { return $this->belongsTo(Branch::class); }
    public function createdBy(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }

    public function isActive(): bool { return (int) $this->status === 1; }
}
