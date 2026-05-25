<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ShipmentOrder extends Model
{
    protected $fillable = [
        'client_id', 'lead_id', 'proforma_invoice_id',
        'shipping_liability', 'cold_chain', 'zip_code',
        'freight_cost', 'shipping_mode', 'inco_term',
        'port_of_loading', 'port_of_unloading',
        'final_destination', 'origin_country',
        'attachments', 'remarks', 'created_by',
    ];

    protected $casts = [
        'cold_chain'   => 'boolean',
        'freight_cost' => 'decimal:2',
        'attachments'  => 'array',
    ];

    public function lead(): BelongsTo
    {
        return $this->belongsTo(Lead::class);
    }

    public function proformaInvoice(): BelongsTo
    {
        return $this->belongsTo(ProformaInvoice::class, 'proforma_invoice_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
