<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PurchaseOrder extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'code',
        'po_type', 'document_type', 'mode_of_transport', 'po_date', 'expected_delivery_date',
        'warehouse_id', 'delivery_location', 'payment_type', 'physical_inspection',
        'currency_id', 'currency_code', 'exchange_rate', 'inco_term',
        'port_of_loading', 'port_of_discharge', 'final_destination', 'country_of_origin',
        'vendor_id', 'supplier_code', 'supplier_name',
        'shipment_order_id', 'shipment_code', 'proforma_invoice_id', 'pi_number',
        'opportunity_id', 'opportunity_code', 'customer_name', 'consignee_name',
        'terms', 'shipping_charges', 'packaging_charges', 'other_charges',
        'total_product_cost', 'total_cgst', 'total_sgst', 'additional_charges', 'grand_total',
        'zoho_status', 'status', 'created_by', 'updated_by',
    ];

    protected $casts = [
        'po_date' => 'date',
        'expected_delivery_date' => 'date',
        'physical_inspection' => 'boolean',
        'exchange_rate' => 'decimal:4',
        'shipping_charges' => 'decimal:2',
        'packaging_charges' => 'decimal:2',
        'other_charges' => 'decimal:2',
        'total_product_cost' => 'decimal:2',
        'total_cgst' => 'decimal:2',
        'total_sgst' => 'decimal:2',
        'additional_charges' => 'decimal:2',
        'grand_total' => 'decimal:2',
    ];

    public function client(): BelongsTo { return $this->belongsTo(Client::class); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
    public function vendor(): BelongsTo { return $this->belongsTo(Vendor::class); }
    public function shipmentOrder(): BelongsTo { return $this->belongsTo(ShipmentOrder::class); }
    public function items(): HasMany { return $this->hasMany(PurchaseOrderItem::class)->orderBy('line_no')->orderBy('id'); }
}
