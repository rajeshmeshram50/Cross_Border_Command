<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Rule 9 — one Professional Tax band for a state.
 *
 * Rows seeded with a NULL client_id are the statutory tables every tenant
 * inherits; a tenant that needs to override one adds its own row for the same
 * state and PayrollService prefers it (see resolveProfessionalTaxSlab()).
 */
class PtSlabs extends Model
{
    protected $table = 'master_pt_slabs';

    protected $fillable = [
        'client_id',
        'branch_id',
        'state',
        'gender',
        'min_gross',
        'max_gross',
        'amount',
        'feb_amount',
        'status',
        'created_by',
    ];

    protected $casts = [
        'min_gross'  => 'decimal:2',
        'max_gross'  => 'decimal:2',
        'amount'     => 'decimal:2',
        'feb_amount' => 'decimal:2',
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
