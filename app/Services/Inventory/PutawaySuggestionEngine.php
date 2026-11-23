<?php

namespace App\Services\Inventory;

class PutawaySuggestionEngine
{
    public const W_FIT         = 45;
    public const W_CONSOLIDATE = 20;
    public const W_ERGONOMICS  = 20;
    public const W_GROUPING    = 15;
    public const W_PROXIMITY   = 0;

    public const HEAVY_KG = 25;

    public const REASONS = [
        'inactive'         => 'Inactive',
        'in_use'           => 'In use',
        'no_cold_chain'    => 'Not cold chain',
        'no_hazardous'     => 'Not for hazardous',
        'cold_only'        => 'Cold-chain only — box is not cold',
        'hazardous_only'   => 'Hazardous only — box is not hazardous',
        'no_temp_control'  => 'No temperature control',
        'temp_out_of_range' => 'Outside temperature range',
        'too_tall'         => 'Box too tall',
        'full'             => 'Full',
        'over_weight'      => 'Not enough free load',
        'over_capacity'    => 'Not enough free space',
    ];

    public function label(?string $code): ?string
    {
        return $code === null ? null : (self::REASONS[$code] ?? $code);
    }

    public const CAPACITY_REASONS = ['full', 'over_weight', 'over_capacity'];

    public const STATES = [
        'available' => 'Available',
        'blocked'   => 'Has space · not valid for this box',
        'full'      => 'No space left',
    ];

    public function state(?string $reason): string
    {
        if ($reason === null) return 'available';
        return in_array($reason, self::CAPACITY_REASONS, true) ? 'full' : 'blocked';
    }

    public function stateLabel(?string $reason): string
    {
        return self::STATES[$this->state($reason)];
    }

    public function refuseShelf(array $need, object $shelf, object $zone, float $freeWeightKg, ?array $lock, ?int $userId): ?string
    {
        if ((int) $shelf->status !== 1) return 'inactive';

        if ($lock && (int) $lock['held_by'] !== (int) $userId) return 'in_use';

        if ($need['cold_chain'] && !((int) $shelf->cold_chain || (int) $zone->cold_chain)) return 'no_cold_chain';

        if ($need['hazardous'] && !((int) $shelf->hazardous || (int) $zone->hazardous)) return 'no_hazardous';

        if (!$need['cold_chain'] && ((int) $shelf->cold_chain || (int) $zone->cold_chain)) return 'cold_only';
        if (!$need['hazardous'] && ((int) $shelf->hazardous || (int) $zone->hazardous)) return 'hazardous_only';

        if ($t = $this->refuseTemperature($need, $zone)) return $t;

        if ($need['height_cm'] > 0 && (float) ($shelf->height_cm ?: 0) > 0
            && $need['height_cm'] > (float) $shelf->height_cm) {
            return 'too_tall';
        }

        if ((float) ($shelf->max_weight_kg ?: 0) > 0 && $need['weight_kg'] > $freeWeightKg) {
            return $freeWeightKg <= 0 ? 'full' : 'over_weight';
        }

        return null;
    }

    public function checkShelf(array $need, object $shelf, object $zone, float $freeWeightKg): array
    {
        $out = [];

        $boxM3   = $need['volume_cm3'] / 1_000_000;
        $shelfM3 = $this->shelfVolumeM3($shelf);
        $tall    = $need['height_cm'] > 0 && (float) ($shelf->height_cm ?: 0) > 0
            && $need['height_cm'] > (float) $shelf->height_cm;
        $out[] = [
            'key'    => 'dimensions',
            'pass'   => !$tall && ($shelfM3 <= 0 || $boxM3 <= $shelfM3),
            'label'  => 'Dimensions fit',
            'detail' => $tall
                ? sprintf('Box %.0f cm tall exceeds shelf clearance %.0f cm', $need['height_cm'], (float) $shelf->height_cm)
                : ($shelfM3 > 0
                    ? sprintf('Box %s m³ ≤ Shelf %s m³ available', $this->num($boxM3, 3), $this->num($shelfM3, 2))
                    : sprintf('Box %s m³ · shelf volume not recorded', $this->num($boxM3, 3))),
        ];

        $cap = (float) ($shelf->max_weight_kg ?: 0);
        $out[] = [
            'key'    => 'weight',
            'pass'   => $cap <= 0 || $need['weight_kg'] <= $freeWeightKg,
            'label'  => 'Weight within limit',
            'detail' => $cap > 0
                ? sprintf('Box %s kg ≤ Shelf %s kg free of %s kg', $this->num($need['weight_kg'], 2), $this->num($freeWeightKg, 2), $this->num($cap, 2))
                : sprintf('Box %s kg · shelf limit not recorded', $this->num($need['weight_kg'], 2)),
        ];

        $out[] = [
            'key'    => 'stackable',
            'pass'   => true,
            'label'  => 'Stackable',
            'detail' => $need['is_stackable'] ? 'Yes · can be stacked' : 'No · must stay on top',
        ];

        $locCold = (int) $shelf->cold_chain || (int) $zone->cold_chain;
        $locHaz  = (int) $shelf->hazardous  || (int) $zone->hazardous;
        $cold = $need['cold_chain'] === (bool) $locCold;
        $haz  = $need['hazardous']  === (bool) $locHaz;
        $temp = $this->refuseTemperature($need, $zone) === null;
        $out[] = [
            'key'    => 'condition',
            'pass'   => $cold && $haz && $temp,
            'label'  => 'Storage condition',
            'detail' => sprintf(
                'Cold chain: %s · Hazardous: %s%s',
                $need['cold_chain'] ? ($locCold ? 'required, available' : 'required, NOT available') : ($locCold ? 'not needed, cold location' : 'No'),
                $need['hazardous']  ? ($locHaz  ? 'required, allowed'   : 'required, NOT allowed')   : ($locHaz ? 'not needed, hazardous location' : 'No'),
                $need['temp_min_c'] === null && $need['temp_max_c'] === null
                    ? ''
                    : sprintf(' · Temp %s…%s °C %s', $need['temp_min_c'] ?? '–', $need['temp_max_c'] ?? '–', $temp ? 'covered' : 'NOT covered'),
            ),
        ];

        return $out;
    }

    public function shelfVolumeM3(object $shelf): float
    {
        if ((float) ($shelf->volume ?? 0) > 0) {
            return round((float) $shelf->volume / 1_000_000, 3);
        }

        $l = (float) ($shelf->length ?? 0);
        $w = (float) ($shelf->width ?? 0);
        $h = (float) ($shelf->height ?? 0);

        return $l > 0 && $w > 0 && $h > 0 ? round($l * $w * $h / 1_000_000, 3) : 0.0;
    }

    private function num(float $v, int $dp): string
    {
        return rtrim(rtrim(number_format($v, $dp, '.', ''), '0'), '.') ?: '0';
    }

    public function refuseZone(array $need, object $zone, float $freeM3, ?array $lock, ?int $userId): ?string
    {
        if ((int) $zone->status !== 1) return 'inactive';
        if ($lock && (int) $lock['held_by'] !== (int) $userId) return 'in_use';
        if ($need['cold_chain'] && !(int) $zone->cold_chain) return 'no_cold_chain';
        if ($need['hazardous'] && !(int) $zone->hazardous) return 'no_hazardous';
        if (!$need['cold_chain'] && (int) $zone->cold_chain) return 'cold_only';
        if (!$need['hazardous'] && (int) $zone->hazardous) return 'hazardous_only';
        if ($t = $this->refuseTemperature($need, $zone)) return $t;

        $boxM3 = $need['volume_cm3'] / 1_000_000;
        if ($freeM3 > 0 && $boxM3 > $freeM3) return 'over_capacity';

        return null;
    }

    public function refuseTemperature(array $need, object $zone): ?string
    {
        if ($need['temp_min_c'] === null && $need['temp_max_c'] === null) return null;

        $zMin = $zone->temp_min_c === null ? null : (float) $zone->temp_min_c;
        $zMax = $zone->temp_max_c === null ? null : (float) $zone->temp_max_c;

        if ($zMin === null && $zMax === null) return 'no_temp_control';

        if ($need['temp_min_c'] !== null && $zMin !== null && $zMin > $need['temp_min_c']) return 'temp_out_of_range';
        if ($need['temp_max_c'] !== null && $zMax !== null && $zMax < $need['temp_max_c']) return 'temp_out_of_range';

        return null;
    }

    public function scoreShelf(array $need, float $capacityKg, array $load, int $levelNo, bool $hasInvoiceMates): array
    {
        $parts = [
            'fit'         => self::W_FIT * $this->fit($need['weight_kg'], $capacityKg, (float) $load['weight_kg']),
            'consolidate' => self::W_CONSOLIDATE * ((int) $load['boxes'] > 0 ? 1 : 0),
            'ergonomics'  => self::W_ERGONOMICS * $this->ergonomics($need['weight_kg'], $levelNo),
            'grouping'    => self::W_GROUPING * ($hasInvoiceMates ? 1 : 0),
            'proximity'   => self::W_PROXIMITY * 0,
        ];

        return [
            'score' => round(array_sum($parts), 1),
            'parts' => array_map(fn ($v) => round($v, 1), $parts),
        ];
    }

    public function scoreZone(array $need, float $capacityM3, float $usedM3): array
    {
        $fit   = $this->fit($need['volume_cm3'] / 1_000_000, $capacityM3, $usedM3);
        $parts = ['fit' => (self::W_FIT + self::W_ERGONOMICS) * $fit];

        return ['score' => round(array_sum($parts), 1), 'parts' => array_map(fn ($v) => round($v, 1), $parts)];
    }

    private function fit(float $need, float $capacity, float $used): float
    {
        if ($capacity <= 0 || $need <= 0) return 0.0;

        $free = max($capacity - $used, 0.0001);

        return min(1, $need / $free);
    }

    private function ergonomics(float $weightKg, int $levelNo): float
    {
        $step = max(0, $levelNo - 1) * 0.25;

        return $weightKg >= self::HEAVY_KG ? max(0, 1 - $step) : min(1, $step);
    }
}
