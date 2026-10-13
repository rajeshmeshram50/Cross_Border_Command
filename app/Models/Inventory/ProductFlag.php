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
        'client_id', 'branch_id', 'code',
        'flag_name', 'purpose',
        'status', 'created_by', 'updated_by',
    ];

    /**
     * A new row is ACTIVE until somebody says otherwise.
     *
     * The column already defaults to 1 in the database, but Eloquent does not
     * read a default back after an insert — so the model the create endpoint
     * serialised still held null, `(int) null` made it 0, and the response said
     * the row was inactive while the stored row was active. Invisible on screen
     * only because every save reloads the list.
     */
    protected $attributes = ['status' => 1];

    protected $casts = ['status' => 'integer'];

    protected $appends = ['flag_code'];

    /**
     * The stored, per-branch code — the same rule the other four masters follow.
     *
     * It was 'PF-' . pad($this->id), and that id comes from one platform-wide
     * sequence: a branch's first flag of its own could read PF-007, and a
     * rolled-back save burned the number for good. The column is written by
     * InventoryCodeAllocator instead. The id fallback covers a row saved
     * outside the allocator; nothing in the app does that today.
     */
    public function getFlagCodeAttribute(): string
    {
        return $this->code ?: 'PF-' . str_pad((string) $this->id, 3, '0', STR_PAD_LEFT);
    }

    public function client(): BelongsTo    { return $this->belongsTo(Client::class); }
    public function branch(): BelongsTo    { return $this->belongsTo(Branch::class); }
    public function createdBy(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }

    public function isActive(): bool { return (int) $this->status === 1; }
}
