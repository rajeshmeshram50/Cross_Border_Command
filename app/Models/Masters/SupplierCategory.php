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
        'status' => 'boolean',
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
