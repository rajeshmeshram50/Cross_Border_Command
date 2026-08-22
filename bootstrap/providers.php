<?php

use App\Providers\AppServiceProvider;
use App\Providers\AzureStorageServiceProvider;

return [
    AppServiceProvider::class,
    AzureStorageServiceProvider::class,
    /* Telescope is deliberately ABSENT here. This file is committed and
       deployed, but Telescope is a --dev package that does not exist on the
       server, so naming its provider here would fatal the whole app on boot.
       It is registered conditionally in AppServiceProvider::register()
       instead — local environment only, and only when the package is
       actually installed. */
];
