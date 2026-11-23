<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class LeadTaskManager extends Model
{
    protected $fillable = [
        'client_id', 'lead_id',
        'order_value', 'buying_plan',
        'name', 'mobile_no', 'email',
        'attachment', 'attachment_original',
        'updated_by',
    ];

    protected $casts = [
        'buying_plan' => 'date:Y-m-d',
        'order_value' => 'decimal:2',
    ];

    public function lead()
    {
        return $this->belongsTo(Lead::class);
    }
}
