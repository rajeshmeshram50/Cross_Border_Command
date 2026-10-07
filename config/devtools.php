<?php

return [

    /*
     | The password that unlocks Dev Tools, shared with the developer group.
     |
     | It lives HERE, in code, rather than in .env: a .env value has to be set
     | again on every machine and every server, and one of them is always
     | missed. Changing it here changes it everywhere the next deploy lands.
     |
     | The trade-off is that it sits in git history, so treat it as a
     | "keep the curious out" password, not a secret. Anyone with repo access
     | can read it. If that is not good enough, fill `password_hash` below, or
     | drop a file on the server — both override this.
     */
    'password' => 'Kryptone@Dev2026',

    /*
     | A bcrypt hash of the real password, which keeps the plaintext out of git
     | while still shipping with the code. When set, it wins over `password`.
     | Generate one with:
     |
     |   php artisan tinker --execute="echo bcrypt('your-password');"
     */
    'password_hash' => '',

    /*
     | A plain-text file on the server, read at check time. When it exists and
     | is non-empty it wins over both of the above, so a single server can carry
     | its own password without a code change. Not in git; create it by hand:
     |
     |   echo "the-password" > storage/app/devtools-password.txt
     */
    'password_file' => 'devtools-password.txt',

    /*
     | Minutes of inactivity before the password is asked for again. The window
     | SLIDES: every Dev Tools request pushes it out again, so it only runs down
     | once you stop using the module. Leave it for longer than this — another
     | module, another tab, lunch — and you come back to the prompt.
     |
     | It applies to everyone, developers included. There is no role that skips
     | the password, so there is no role that skips this either.
     */
    'idle_minutes' => 3,

    // Wrong passwords allowed before the lockout, and how long it lasts.
    'max_attempts'    => 3,
    'lockout_minutes' => 30,

];
