<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Sales Matrix → Lead (My Workplace).
 *
 * Sender info denormalized — no separate `lead_customers` table. When the
 * lead is promoted, `customer_id` / `consignee_id` link to the real
 * masters; until then the sender_* columns are the source of truth.
 */
class Lead extends Model
{
    use HasFactory;
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id',
        'opp_code', 'unique_query_id',
        'platform', 'query_type', 'source_account', 'query_time',

        'sender_name', 'sender_mobile', 'sender_email', 'sender_company',
        'sender_address', 'sender_city', 'sender_state', 'sender_pincode',
        'sender_country_iso', 'sender_country_name',
        'sender_mobile_alt', 'sender_email_alt',

        'query_product_name', 'query_message', 'product_quantity', 'query_mcat_name',

        'lead_stage_id', 'qualified', 'disqualified', 'key_opportunity',

        'has_whatsapp', 'whatsapp_reason', 'whatsapp_screenshot', 'whatsapp_status',

        'salesperson_id', 'customer_id', 'consignee_id', 'lead_ack_reason_id',

        'remark', 'price', 'created_by',
    ];

    protected $casts = [
        'query_time'      => 'datetime',
        'qualified'       => 'boolean',
        'disqualified'    => 'boolean',
        'key_opportunity' => 'boolean',
        'has_whatsapp'    => 'boolean',
        'lead_stage_id'   => 'integer',
    ];

    // ── Relationships ──

    public function client()
    {
        return $this->belongsTo(Client::class);
    }

    public function branch()
    {
        return $this->belongsTo(Branch::class);
    }

    public function salesperson()
    {
        return $this->belongsTo(User::class, 'salesperson_id');
    }

    public function customer()
    {
        return $this->belongsTo(Customer::class);
    }

    public function consignee()
    {
        return $this->belongsTo(Consignee::class);
    }

    public function ackReason()
    {
        return $this->belongsTo(LeadAckReason::class, 'lead_ack_reason_id');
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * Stage 1 (Inquiry Received) → Task Manager row. One-to-one; the
     * controller upserts via POST /sales/leads/{lead}/task-manager.
     */
    public function taskManager()
    {
        return $this->hasOne(LeadTaskManager::class);
    }

    /**
     * Stage 2 (Lead Acknowledgement) → activity log. Append-only;
     * Stage 2 saves one row per picked master reason. Latest row's
     * opportunity_type drives the lead's qualified/disqualified flags.
     */
    public function acknowledgements()
    {
        return $this->hasMany(LeadAcknowledgement::class)->latest('id');
    }
}
