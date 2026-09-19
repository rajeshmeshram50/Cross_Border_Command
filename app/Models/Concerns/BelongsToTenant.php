<?php

namespace App\Models\Concerns;

use App\Support\TenantContext;
use Illuminate\Database\Eloquent\Builder;

/**
 * Automatic tenant filter for branch-owned masters: globals + the client's shared rows
 * + the context branch. Controllers keep their own filters as a backup.
 */
trait BelongsToTenant
{
    public static function bootBelongsToTenant(): void
    {
        static::addGlobalScope('tenant', function (Builder $q) {
            if (!TenantContext::active()) return;
            $table    = $q->getModel()->getTable();
            $clientId = TenantContext::clientId();
            $branchId = TenantContext::branchId();
            $q->where(function ($w) use ($table, $clientId, $branchId) {
                $w->whereNull("$table.client_id")
                  ->orWhere(function ($ww) use ($table, $clientId, $branchId) {
                      $ww->where("$table.client_id", $clientId);
                      if ($branchId !== null) {
                          $ww->where(fn ($wb) => $wb->whereNull("$table.branch_id")->orWhere("$table.branch_id", $branchId));
                      }
                  });
            });
        });

        // Fill only what the controller left empty — an explicit value always wins.
        static::creating(function ($row) {
            if (!TenantContext::active()) return;
            if (empty($row->client_id)) $row->client_id = TenantContext::clientId();
            if (!$row->isDirty('branch_id') && TenantContext::branchId() !== null) $row->branch_id = TenantContext::branchId();
        });
    }
}
