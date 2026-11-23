<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ShipmentOrder extends Model
{
    protected $fillable = [
        'client_id', 'branch_id', 'shipment_code', 'lead_id', 'proforma_invoice_id',
        'shipping_liability', 'cold_chain', 'shipping_mode',
        'attachments', 'remarks', 'created_by',
        'zip_code', 'freight_cost', 'inco_term', 'inco_term_id',
        'port_of_loading', 'port_of_unloading',
        'final_destination', 'origin_country',
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

    public function incoterm(): BelongsTo
    {
        return $this->belongsTo(\App\Models\Masters\Incoterms::class, 'inco_term_id');
    }

    public function incoTermLabel(): ?string
    {
        $m = $this->relationLoaded('incoterm') ? $this->incoterm : null;
        if ($m) {
            $code = trim((string) $m->code);
            $name = trim((string) $m->full_name);
            return $code && $name ? "$code – $name" : ($name ?: ($code ?: null));
        }
        return $this->inco_term ?: null;
    }
}
