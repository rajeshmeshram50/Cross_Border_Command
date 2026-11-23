<?php

namespace App\Support;

use App\Models\Lead;
use App\Models\LeadAssignmentHistory;
use App\Models\User;
use Illuminate\Support\Facades\Log;

class LeadActivity
{
    public const ACTION_GENERATED  = LeadAssignmentHistory::ACTION_GENERATED;
    public const ACTION_ASSIGNED   = LeadAssignmentHistory::ACTION_ASSIGNED;
    public const ACTION_REASSIGNED = LeadAssignmentHistory::ACTION_REASSIGNED;

    public static function log(
        User $actor,
        Lead|int $lead,
        string $action,
        string $description,
        ?array $old = null,
        ?array $new = null,
    ): void {
        $isModel  = $lead instanceof Lead;
        $leadId   = $isModel ? (int) $lead->id : (int) $lead;
        $clientId = $isModel ? $lead->client_id : $actor->client_id;
        $branchId = $isModel ? $lead->branch_id : $actor->branch_id;

        try {
            LeadAssignmentHistory::create([
                'client_id'           => $clientId,
                'branch_id'           => $branchId,
                'lead_id'             => $leadId,
                'opp_code'            => $new['opp_code'] ?? ($isModel ? $lead->opp_code : null),
                'action'              => $action,
                'assignee_user_id'    => isset($new['salesperson_id']) ? (int) $new['salesperson_id'] : null,
                'assignee_name'       => $new['salesperson_name'] ?? null,
                'previous_user_id'    => isset($old['salesperson_id']) ? (int) $old['salesperson_id'] : null,
                'previous_name'       => $old['salesperson_name'] ?? null,
                'assigned_by_user_id' => $actor->id,
                'assigned_by_name'    => $actor->name,
                'platform'            => $isModel ? $lead->platform : null,
                'source'              => $isModel ? $lead->query_type : null,
                'description'         => $description,
                'created_at'          => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('LeadActivity log failed for lead ' . $leadId . ': ' . $e->getMessage());
        }
    }

    public static function feed(int $leadId, int $limit = 200): array
    {
        return LeadAssignmentHistory::query()
            ->where('lead_id', $leadId)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit($limit)
            ->get()
            ->map(fn (LeadAssignmentHistory $r) => [
                'id'          => $r->id,
                'action'      => $r->action,
                'description' => $r->description,
                'actor'       => $r->assigned_by_name,
                'platform'    => $r->platform,
                'source'      => $r->source,
                'old'         => $r->previous_user_id || $r->previous_name
                    ? ['salesperson_id' => $r->previous_user_id, 'salesperson_name' => $r->previous_name]
                    : null,
                'new'         => [
                    'salesperson_id'   => $r->assignee_user_id,
                    'salesperson_name' => $r->assignee_name,
                    'opp_code'         => $r->opp_code,
                ],
                'at'          => optional($r->created_at)->toIso8601String(),
            ])
            ->all();
    }
}
