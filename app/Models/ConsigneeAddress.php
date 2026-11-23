<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ConsigneeAddress extends Model
{
    protected $fillable = [
        'consignee_id',
        'type', 'address_line', 'country', 'state', 'city', 'pin',
        'cp_name', 'cp_designation', 'cp_contact', 'cp_email', 'cp_whatsapp',
        'is_primary',
    ];

    protected $casts = [
        'is_primary' => 'boolean',
    ];

    public function consignee(): BelongsTo
    {
        return $this->belongsTo(Consignee::class);
    }
}
