<?php

namespace App\Support\Concerns;

use App\Support\EmailGuard;
use Illuminate\Validation\ValidationException;

/**
 * Model-level enforcement — the part that makes this hard to bypass.
 *
 * A model opts in with two lines:
 *
 *     use EnforcesUniqueEmail;
 *     protected static string $emailScope   = 'employee';
 *     protected static array  $emailColumns = ['email', 'official_email'];
 *
 * and every write path is covered: controllers, the Excel importers, seeders,
 * console commands, anything. That is the point of doing it here rather than
 * in each controller — there are ~20 places that create these records, and a
 * rule added to 19 of them is not a rule.
 *
 * Only DIRTY columns are checked, so re-saving a record for an unrelated
 * reason costs nothing, and an existing row whose address predates this rule
 * keeps saving until someone actually edits the address. That last part is
 * deliberate: the data already contains duplicates (see the audit in
 * config/email_uniqueness.php), and a rule that blocks editing a phone number
 * because of a legacy email clash would be unusable.
 */
trait EnforcesUniqueEmail
{
    public static function bootEnforcesUniqueEmail(): void
    {
        static::saving(function ($model) {
            $scope   = static::$emailScope   ?? null;
            $columns = static::$emailColumns ?? [];
            if (!$scope || !$columns) return;

            foreach ($columns as $col) {
                // Untouched column → nothing new to validate.
                if (!$model->isDirty($col)) continue;

                $value = $model->{$col};
                if (EmailGuard::normalise($value) === '') continue;

                $conflict = EmailGuard::conflict(
                    $scope,
                    $value,
                    $model->client_id ?? null,
                    // exists() so a CREATE has no id to exclude and an UPDATE does.
                    $model->exists ? ['table' => $model->getTable(), 'id' => $model->getKey()] : [],
                );

                if ($conflict) {
                    /* ValidationException, not a plain exception: it surfaces as
                       a 422 keyed on the field, which is the shape every form in
                       the SPA already knows how to render. A 500 here would show
                       the user nothing useful. */
                    throw ValidationException::withMessages([
                        $col => [EmailGuard::message($conflict)],
                    ]);
                }
            }
        });
    }
}
