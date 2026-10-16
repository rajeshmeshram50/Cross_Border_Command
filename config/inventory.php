<?php

return [

    /*
     * Printed labels — box stickers, rack / shelf / zone labels.
     *
     * The QR carries a URL, so the host is baked into the carton. Set this to
     * the address the warehouse will actually reach, NOT to APP_URL, which
     * points at the Blade host and is usually not where the SPA is served.
     * Change it and every label printed from now on points somewhere else;
     * labels already on cartons keep the old address.
     */
    'sticker_url' => env('STICKER_URL', env('APP_URL')),

    /*
     * Signs the sticker payload. Must match SECRET in putAwayStore.ts until
     * that simulation is replaced by a server call — a mismatch makes every
     * genuine sticker read as tampered.
     */
    'sticker_secret' => env('STICKER_SECRET', 'demo-signing-secret'),

    /*
     * How long a HALF-FINISHED scan stays valid, in minutes.
     *
     * A box scanned and then abandoned leaves the screen mid-task. The next
     * person picking the handheld up should start clean rather than inherit
     * someone else's half-walk.
     *
     * Not short. Carrying a box from the pack bench to a rack — find the
     * aisle, fetch a ladder, move something out of the way — takes minutes in
     * a real warehouse, and an operator told to start over while doing exactly
     * the right thing learns to distrust the screen.
     *
     * This is a display concern, not a safety one: a stale box scan cannot
     * cause a wrong placement, because the pair still has to match the task.
     */
    'scan_stale_minutes' => env('SCAN_STALE_MINUTES', 30),

];
