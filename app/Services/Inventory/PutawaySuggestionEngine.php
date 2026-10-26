<?php

namespace App\Services\Inventory;

/**
 * Inventory · every rule that decides where a box may go, and which place is best.
 *
 * ONE FILE, on purpose. These rules are read by three screens and will be
 * argued about by people who do not read PHP — the warehouse manager who wants
 * heavy goods off the top levels, the compliance officer who wants a cold box
 * refused rather than warned. Scattered across a tree-builder and a controller
 * they cannot be reviewed; here they can.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE TWO HALVES, AND WHY THEY MUST NOT MIX
 * ══════════════════════════════════════════════════════════════════════════
 *
 * HARD CONDITIONS answer *may* this box go here: pass or fail, and a failure
 * always names itself so the tile can say why it is greyed out. They are
 * absolute — no weighting, no score, no "mostly fits".
 *
 * SOFT SCORING answers *which of the places that passed* is best. It only ever
 * reorders; it can never remove. The moment a preference starts excluding
 * locations, the screen shows a shelf that is missing with no reason on it, and
 * nobody can work out why from the outside.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * STILL OPEN — these change the numbers, not the structure
 * ══════════════════════════════════════════════════════════════════════════
 *
 *  1. CONSOLIDATE OR SPREAD? Filling part-used shelves first packs the
 *     warehouse densely; spreading keeps every box reachable. W_CONSOLIDATE is
 *     positive today — change its sign to spread.
 *  2. DISTANCE IS MISSING. "Nearest the inbound dock" is the strongest signal
 *     in a real WMS and cannot be computed at all: zones and racks carry no
 *     coordinate and no pick-path sequence. One sequence_no per zone and rack
 *     would turn it on, and W_PROXIMITY is reserved for it.
 *  3. NON-HAZ ON A HAZ SHELF is allowed here. Hazardous storage is usually
 *     restricted space and wasting it on ordinary goods may deserve a penalty,
 *     or a refusal.
 *  4. SEGREGATION. Nothing says tobacco may not sit beside food grade. That is
 *     a rules master, not a weight.
 */
class PutawaySuggestionEngine
{
    /* ═══════════════════ SCORING WEIGHTS — sum to 100 ═══════════════════ */

    /** Tightest fit: how little capacity is stranded after this box. */
    public const W_FIT         = 45;
    /** Prefer a shelf already partly used over breaking into an empty one. */
    public const W_CONSOLIDATE = 20;
    /** Heavy low, light high — a heavy carton on level 5 is a handling injury. */
    public const W_ERGONOMICS  = 20;
    /** Keep one invoice's boxes together; they are picked together at GRN. */
    public const W_GROUPING    = 15;
    /** Reserved for distance from the dock. Zero until a layout exists. */
    public const W_PROXIMITY   = 0;

    /** At or above this, a box is "heavy" and belongs at working height. */
    public const HEAVY_KG = 25;

    /* ═══════════════════ REFUSALS, IN PRIORITY ORDER ═══════════════════ */

    /**
     * A location can fail several of these at once and the tile shows one chip,
     * so the order is the order of usefulness to the person reading it:
     * what nobody can change, then what someone else is doing, then what this
     * particular box cannot have, then what simply does not fit.
     */
    public const REASONS = [
        'inactive'         => 'Inactive',
        'in_use'           => 'In use',
        'no_cold_chain'    => 'Not cold chain',
        'no_hazardous'     => 'Not for hazardous',
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

    /**
     * The refusals that mean SPACE, as opposed to the ones that mean this
     * box. Everything else — inactive, held, cold chain, hazardous,
     * temperature, height — leaves the location as empty as it found it.
     */
    public const CAPACITY_REASONS = ['full', 'over_weight', 'over_capacity'];

    public const STATES = [
        'available' => 'Available',
        'blocked'   => 'Has space · not valid for this box',
        'full'      => 'No space left',
    ];

    /**
     * available · blocked · full.
     *
     * `eligible: false` answered "can this box go here" and nothing else, so
     * a cold-chain mismatch and a full shelf were the same answer. They are
     * not: one is this box in the wrong place, the other is a shelf with
     * nothing left to give, and only the second should count against free
     * capacity.
     */
    public function state(?string $reason): string
    {
        if ($reason === null) return 'available';
        return in_array($reason, self::CAPACITY_REASONS, true) ? 'full' : 'blocked';
    }

    public function stateLabel(?string $reason): string
    {
        return self::STATES[$this->state($reason)];
    }

    /* ═══════════════════ HARD CONDITIONS · SHELF ═══════════════════ */

    /**
     * Why this shelf cannot take this box, or null when it can.
     *
     * @param array $need  from LocationFinderService::requirements()
     * @param ?array $lock ['held_by' => int] when somebody holds this shelf
     */
    public function refuseShelf(array $need, object $shelf, object $zone, float $freeWeightKg, ?array $lock, ?int $userId): ?string
    {
        // 1 · Retired locations are not storage.
        if ((int) $shelf->status !== 1) return 'inactive';

        /* 2 · Somebody else is working here. Their own lock is not an
               obstacle to them — a refresh must not lock a user out of the
               shelf they just took. */
        if ($lock && (int) $lock['held_by'] !== (int) $userId) return 'in_use';

        /* 3 · Cold chain. The shelf may carry the flag itself, or inherit it
               from a cold zone — a cold room's shelves are all cold whether
               anyone ticked them or not. */
        if ($need['cold_chain'] && !((int) $shelf->cold_chain || (int) $zone->cold_chain)) return 'no_cold_chain';

        // 4 · Hazardous goods belong only where hazardous goods are allowed.
        if ($need['hazardous'] && !((int) $shelf->hazardous || (int) $zone->hazardous)) return 'no_hazardous';

        // 5 · Temperature, the check nothing in the system made until now.
        if ($t = $this->refuseTemperature($need, $zone)) return $t;

        // 6 · Height. A box that does not fit under the next level does not fit.
        if ($need['height_cm'] > 0 && (float) ($shelf->height_cm ?: 0) > 0
            && $need['height_cm'] > (float) $shelf->height_cm) {
            return 'too_tall';
        }

        /* 7 · Load. A shelf with no stated maximum is UNMEASURED, not
               unlimited — but an unmeasured shelf cannot refuse anything, so it
               passes and the operator carries the judgement. */
        if ((float) ($shelf->max_weight_kg ?: 0) > 0 && $need['weight_kg'] > $freeWeightKg) {
            return $freeWeightKg <= 0 ? 'full' : 'over_weight';
        }

        return null;
    }

    /**
     * Every check that was run, pass or fail — what the recommendation panel
     * lists under "Parameter Checks".
     *
     * refuseShelf() answers a different question. It short-circuits on the
     * first failure, which is right for greying out a tile: one chip, the most
     * useful reason. But the panel is explaining a choice rather than refusing
     * one, and "weight within limit · 48 kg ≤ 2,000 kg" is the part that makes
     * an operator trust it. Same rules, read the other way round.
     *
     * @return array<int, array{key:string,pass:bool,label:string,detail:string}>
     */
    public function checkShelf(array $need, object $shelf, object $zone, float $freeWeightKg): array
    {
        $out = [];

        /* Dimensions. Volume is the honest comparison for a carton going onto
           a shelf that already holds things — a footprint check would pass a
           box that fits the floor and not the height. */
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

        // Weight. An unmeasured shelf passes — unmeasured is not unlimited,
        // but it cannot refuse, so it must not claim to have checked.
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

        // Cold chain, hazardous and the temperature band, as one answer.
        $cold = !$need['cold_chain'] || (int) $shelf->cold_chain || (int) $zone->cold_chain;
        $haz  = !$need['hazardous']  || (int) $shelf->hazardous  || (int) $zone->hazardous;
        $temp = $this->refuseTemperature($need, $zone) === null;
        $out[] = [
            'key'    => 'condition',
            'pass'   => $cold && $haz && $temp,
            'label'  => 'Storage condition',
            'detail' => sprintf(
                'Cold chain: %s · Hazardous: %s%s',
                $need['cold_chain'] ? ($cold ? 'required, available' : 'required, NOT available') : 'No',
                $need['hazardous']  ? ($haz  ? 'required, allowed'   : 'required, NOT allowed')   : 'No',
                $need['temp_min_c'] === null && $need['temp_max_c'] === null
                    ? ''
                    : sprintf(' · Temp %s…%s °C %s', $need['temp_min_c'] ?? '–', $need['temp_max_c'] ?? '–', $temp ? 'covered' : 'NOT covered'),
            ),
        ];

        return $out;
    }

    /** A shelf's own volume in m³, from whichever columns it carries. */
    public function shelfVolumeM3(object $shelf): float
    {
        if ((float) ($shelf->volume ?? 0) > 0) return (float) $shelf->volume;

        $l = (float) ($shelf->length ?? 0);
        $w = (float) ($shelf->width ?? 0);
        $h = (float) ($shelf->height ?? 0);

        // Stored in cm on these masters, like every other dimension here.
        return $l > 0 && $w > 0 && $h > 0 ? round($l * $w * $h / 1_000_000, 3) : 0.0;
    }

    /** Trim the trailing zeros a warehouse figure does not need. */
    private function num(float $v, int $dp): string
    {
        return rtrim(rtrim(number_format($v, $dp, '.', ''), '0'), '.') ?: '0';
    }
    /* ═══════════════════ HARD CONDITIONS · ZONE ═══════════════════ */

    /** The same questions where the zone itself is the location — no rack, no shelf. */
    public function refuseZone(array $need, object $zone, float $freeM3, ?array $lock, ?int $userId): ?string
    {
        if ((int) $zone->status !== 1) return 'inactive';
        if ($lock && (int) $lock['held_by'] !== (int) $userId) return 'in_use';
        if ($need['cold_chain'] && !(int) $zone->cold_chain) return 'no_cold_chain';
        if ($need['hazardous'] && !(int) $zone->hazardous) return 'no_hazardous';
        if ($t = $this->refuseTemperature($need, $zone)) return $t;

        $boxM3 = $need['volume_cm3'] / 1_000_000;
        // Same rule as an unmeasured shelf: no stated capacity cannot refuse.
        if ($freeM3 > 0 && $boxM3 > $freeM3) return 'over_capacity';

        return null;
    }

    /**
     * The costliest gap this engine closes.
     *
     * A box carries temp_min_c / temp_max_c and a zone carries its own; nothing
     * compared them, so a −20 °C carton could be confirmed onto an ambient
     * shelf and the system said nothing. A cold-chain breach is discovered when
     * the goods are opened, which is far too late to do anything about.
     *
     * The zone's range must COVER the box's: a freezer at −25 to −18 may hold a
     * −20 box, an ambient zone with no range at all may not hold it at all.
     */
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

    /* ═══════════════════ SOFT SCORING ═══════════════════ */

    /**
     * 0–100, higher is better. Applied ONLY to locations that already passed.
     *
     * Returned with its parts, not just the total: the panel says "95% MATCH"
     * and somebody will ask why, and a number with no breakdown cannot be
     * argued with or corrected.
     *
     * @return array{score:float,parts:array<string,float>}
     */
    public function scoreShelf(array $need, float $capacityKg, array $load, int $levelNo, bool $hasInvoiceMates): array
    {
        $parts = [
            'fit'         => self::W_FIT * $this->fit($need['weight_kg'], $capacityKg, (float) $load['weight_kg']),
            'consolidate' => self::W_CONSOLIDATE * ((int) $load['boxes'] > 0 ? 1 : 0),
            'ergonomics'  => self::W_ERGONOMICS * $this->ergonomics($need['weight_kg'], $levelNo),
            'grouping'    => self::W_GROUPING * ($hasInvoiceMates ? 1 : 0),
            // Zero until zones and racks carry a layout sequence. See note 2.
            'proximity'   => self::W_PROXIMITY * 0,
        ];

        return [
            'score' => round(array_sum($parts), 1),
            'parts' => array_map(fn ($v) => round($v, 1), $parts),
        ];
    }

    /** A no-rack zone has no levels and no neighbours — fit is all there is. */
    public function scoreZone(array $need, float $capacityM3, float $usedM3): array
    {
        $fit   = $this->fit($need['volume_cm3'] / 1_000_000, $capacityM3, $usedM3);
        $parts = ['fit' => (self::W_FIT + self::W_ERGONOMICS) * $fit];

        return ['score' => round(array_sum($parts), 1), 'parts' => array_map(fn ($v) => round($v, 1), $parts)];
    }

    /**
     * 0–1, approaching 1 as the box uses up what is left.
     *
     * Tightest fit, not emptiest shelf: putting a 48 kg carton on a 2,000 kg
     * shelf leaves 1,952 kg that nothing else can reach easily, while the same
     * carton on a shelf with 50 kg free finishes that shelf cleanly. Flip this
     * to `1 - ratio` and the engine spreads instead of packing — see note 1.
     */
    private function fit(float $need, float $capacity, float $used): float
    {
        if ($capacity <= 0 || $need <= 0) return 0.0;

        $free = max($capacity - $used, 0.0001);

        return min(1, $need / $free);
    }

    /**
     * 0–1 for putting THIS weight at THIS level.
     *
     * Heavy goes low: level 1 is ideal for a heavy carton and poor for a light
     * one, because floor levels are the easiest to reach and should not be
     * spent on boxes anyone can lift overhead.
     */
    private function ergonomics(float $weightKg, int $levelNo): float
    {
        $step = max(0, $levelNo - 1) * 0.25;

        return $weightKg >= self::HEAVY_KG ? max(0, 1 - $step) : min(1, $step);
    }
}
