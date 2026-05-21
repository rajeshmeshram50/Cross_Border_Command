<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Sales Matrix → Stage 1 Task Manager row. One-to-one with Lead;
 * upserted via POST /sales/leads/{lead}/task-manager. See the matching
 * migration for column intent.
 */
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
