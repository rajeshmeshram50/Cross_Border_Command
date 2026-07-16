<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ShipmentOrder extends Model
{
    /* Export-only vs domestic-only columns are deliberately separate — see the
     * add_domestic_fields_to_shipment_orders_table migration. A row populates
     * one set or the other, never both, according to its PI's doc_type. */
    protected $fillable = [
        'client_id', 'branch_id', 'shipment_code', 'lead_id', 'proforma_invoice_id',
        'shipping_liability', 'cold_chain', 'shipping_mode',
        'attachments', 'remarks', 'created_by',
        // International only
        'zip_code', 'freight_cost', 'inco_term',
        'port_of_loading', 'port_of_unloading',
        'final_destination', 'origin_country',
        // Domestic only
        'pin_code', 'shipping_cost', 'place_of_dispatch', 'place_of_delivery',
    ];

    protected $casts = [
        'cold_chain'    => 'boolean',
        'freight_cost'  => 'decimal:2',
        'shipping_cost' => 'decimal:2',
        'attachments'   => 'array',
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
