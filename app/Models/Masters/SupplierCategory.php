<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SupplierCategory extends Model
{
    protected $table = 'master_supplier_categories';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'supplier_service',
        'supplier_type',
        'status',
        'is_system',
        'created_by',
    ];

    protected $casts = [
        // Forces the API to return 1/0 or true/false instead of "1" or "0"
        'status' => 'boolean',
        'is_system' => 'boolean',
    ];

    /**
     * The client that owns this master row.
     */
    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    /**
     * The branch that owns this master row.
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    /**
     * The user who created this row.
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
