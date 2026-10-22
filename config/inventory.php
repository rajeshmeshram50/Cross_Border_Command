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
    /* No default, deliberately. The old one ('demo-signing-secret') shipped in
       git, so every label it signed could be forged by anyone who read the
       repo. Unset, StickerKey derives the key from APP_KEY instead — random
       per environment, and already secret. */
    'sticker_secret' => env('STICKER_SECRET'),

    /* Honour labels signed by the retired FNV fold.
       Those labels are forgeable, so this is a transition switch, not a
       setting: turn it off once the floor has been reprinted. */
    'sticker_accept_legacy' => (bool) env('STICKER_ACCEPT_LEGACY', true),

    /*
     * How long a HALF-FINISHED scan stays valid, in minutes.
     *
     * A box scanned and then abandoned leaves the screen mid-task. The next
     * person picking the handheld up should start clean rather than inherit
     * someone else's half-walk.
     *
     * Five minutes. Long enough to carry a box from the pack bench to a rack
     * and find the slot; short enough that a handheld left face-up on a
     * trolley is not still holding a put-away when the next shift picks it up.
     *
     * This is a display concern, not a safety one: a stale box scan cannot
     * cause a wrong placement, because the pair still has to match the task.
     */
    'scan_stale_minutes' => env('SCAN_STALE_MINUTES', 5),

];
