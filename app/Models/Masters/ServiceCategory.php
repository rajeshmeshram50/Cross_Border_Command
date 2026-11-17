<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ServiceCategory extends Model
{
    public const TYPES = ['soft_digital', 'other_operational'];
    public const OTHER_CLASSIFICATIONS = ['professional', 'utility', 'facility', 'maintenance', 'outsourcing'];

    public function usageCount(): int
    {
        return \App\Models\P2p\Service::withTrashed()->where('category_id', $this->id)->count();
    }

    protected $table = 'master_service_categories';

    protected $fillable = [
        'client_id',
        'branch_id',
        'service_type',
        'classification',
        'name',
        'status',
        'created_by',
    ];

    protected $casts = [
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
