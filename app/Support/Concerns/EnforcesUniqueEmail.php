<?php

namespace App\Support\Concerns;

use App\Support\EmailGuard;
use Illuminate\Validation\ValidationException;

trait EnforcesUniqueEmail
{
    public static function bootEnforcesUniqueEmail(): void
    {
        static::saving(function ($model) {
            $scope   = static::$emailScope   ?? null;
            $columns = static::$emailColumns ?? [];
            if (!$scope || !$columns) return;

            $isRestoring = $model->isDirty('deleted_at')
                && $model->deleted_at === null
                && $model->getOriginal('deleted_at') !== null;

            foreach ($columns as $col) {
                if (!$isRestoring && !$model->isDirty($col)) continue;

                $value = $model->{$col};
                if (EmailGuard::normalise($value) === '') continue;

                $ignore = $model->exists ? [['table' => $model->getTable(), 'id' => $model->getKey()]] : [];
                if (method_exists($model, 'sameEmailOwnerRows')) {
                    $ignore = array_merge($ignore, $model->sameEmailOwnerRows());
                }

                $conflict = EmailGuard::conflict(
                    $scope,
                    $value,
                    $model->client_id ?? null,
                    $ignore,
                );

                if ($conflict) {
                    throw ValidationException::withMessages([
                        $col => [EmailGuard::message($conflict)],
                    ]);
                }
            }
        });
    }
}
