<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class VendorDirectory extends Model
{
    protected $table = 'master_vendor_directory';

    protected $fillable = [
        'client_id',
        'branch_id',
        'vendor_company_name',
        'contact_person',
        'mobile_number',
        'email_id',
        'segment_id',
        'address',
        'country',
        'state',
        'city',
        'mapping_mode',
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
