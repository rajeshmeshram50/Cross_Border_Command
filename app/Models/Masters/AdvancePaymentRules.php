<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AdvancePaymentRules extends Model
{
    protected $table = 'master_advance_payment_rules';

    protected $fillable = [
        'client_id',
        'branch_id',
        'vendor_type',
        'procurement_cat',
        'max_advance_pct',
        'approval_above',
        'approver_role',
        'attachment_required',
        'status',
        'created_by',
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
