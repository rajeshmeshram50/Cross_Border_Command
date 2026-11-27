<?php

namespace App\Support;

use App\Models\Employee;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;

class OnboardingGuard
{
    public const COMPLETE_STAGE = 6;

    public static function stage(?Employee $employee): int
    {
        return max(0, min(self::COMPLETE_STAGE, (int) ($employee->onboarding_stage_completed ?? 0)));
    }

    public static function isComplete(?Employee $employee): bool
    {
        if (!$employee) return false;
        return (int) ($employee->onboarding_stage_completed ?? 0) >= self::COMPLETE_STAGE;
    }

    public static function assertComplete(?Employee $employee, string $action, bool $isSelf = true): void
    {
        if (self::isComplete($employee)) return;

        $stage = self::stage($employee);
        $progress = "Onboarding is at stage {$stage} of " . self::COMPLETE_STAGE . '.';

        $message = $isSelf
            ? "You cannot {$action} until your onboarding is complete. {$progress} "
                . 'Your HR team finishes the remaining stages.'
            : "This employee cannot {$action} until their onboarding is complete. {$progress}";

        throw new HttpResponseException(response()->json([
            'message' => $message,
            'errors'  => ['onboarding' => ['Onboarding is not complete.']],
        ], 422));
    }

    public static function onboardingSigningStatus(Employee $employee): array
    {
        $templates = HrTemplateMatch::onboardingTemplatesFor($employee);

        $runs = DB::table('hr_document_signatures')
            ->where('employee_id', $employee->id)
            ->select('template_id', 'status')
            ->get();

        $sent   = array_flip($runs->where('status', '!=', 'Cancelled')->pluck('template_id')->filter()->unique()->all());
        $signed = array_flip($runs->where('status', '=', 'Completed')->pluck('template_id')->filter()->unique()->all());

        $lock = DB::table('hr_onboarding_docset_locks')
            ->where('employee_id', $employee->id)->whereNotNull('finalized_at')->first();
        if ($lock) {
            $selected = DB::table('hr_onboarding_doc_selections')
                ->where('employee_id', $employee->id)->pluck('template_id')
                ->map(fn ($x) => (int) $x)->all();
            $activeIds = $templates->pluck('id')->map(fn ($x) => (int) $x)->flip();
            $nameById = $templates->keyBy('id');
            $awaiting = [];
            foreach ($selected as $tid) {
                if (isset($signed[$tid])) continue;
                if (!isset($activeIds[$tid]) && !isset($sent[$tid])) continue;
                $t = $nameById->get($tid);
                $awaiting[] = $t
                    ? (trim((string) $t->code) !== '' ? sprintf('%s (%s)', $t->name, $t->code) : (string) $t->name)
                    : "Document #{$tid}";
            }
            return ['matched' => count($selected), 'sent' => count($selected), 'awaiting' => array_values($awaiting)];
        }

        if ($templates->isEmpty()) return ['matched' => 0, 'sent' => 0, 'awaiting' => []];

        $awaiting = $templates
            ->filter(fn ($t) => isset($sent[$t->id]) && !isset($signed[$t->id]))
            ->map(fn ($t) => trim((string) $t->code) !== ''
                ? sprintf('%s (%s)', $t->name, $t->code)
                : (string) $t->name)
            ->values()
            ->all();

        return [
            'matched'  => $templates->count(),
            'sent'     => $templates->filter(fn ($t) => isset($sent[$t->id]))->count(),
            'awaiting' => $awaiting,
        ];
    }

    public static function assertDocumentsSigned(Employee $employee): void
    {
        ['sent' => $sent, 'awaiting' => $awaiting] = self::onboardingSigningStatus($employee);

        if (empty($awaiting)) return;

        $count = count($awaiting);
        throw new HttpResponseException(response()->json([
            'message' => "Onboarding can't be completed — {$count} of the {$sent} document"
                . ($sent > 1 ? 's' : '') . ' sent for signature '
                . ($count > 1 ? 'have' : 'has') . ' not come back signed: '
                . implode(', ', $awaiting) . '.',
            'errors'  => ['onboarding_stage_completed' => $awaiting],
        ], 422));
    }
}
