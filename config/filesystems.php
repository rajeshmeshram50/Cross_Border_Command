<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Default Filesystem Disk
    |--------------------------------------------------------------------------
    |
    | Here you may specify the default filesystem disk that should be used
    | by the framework. The "local" disk, as well as a variety of cloud
    | based disks are available to your application for file storage.
    |
    */

    'default' => env('FILESYSTEM_DISK', 'local'),

    /*
    |--------------------------------------------------------------------------
    | Document Disk
    |--------------------------------------------------------------------------
    |
    | Where business documents are WRITTEN — box photos, invoice and e-way
    | attachments, vault uploads. Read it with config('filesystems.documents')
    | rather than naming a disk at the call site, so one env var moves every
    | upload instead of a hundred edits.
    |
    | It does NOT default to 'default'. That resolves to 'local' when
    | FILESYSTEM_DISK is unset, and 'local' (storage/app) is not served over
    | HTTP — photos written there would store fine and then 404 in the
    | browser. 'public' is the one that is served, and it already switches
    | its own driver to azure-storage-blob when FILESYSTEM_DISK=azure, so the
    | cloud case is covered without changing this value at all.
    |
    | Reads do not depend on it: P2pFileController::diskHolding() probes this
    | disk, then 'public', then 'local', so changing it never strands files
    | already written somewhere else.
    |
    */

    // ?: not the env() default: env() returns '' for a key that is PRESENT
    // but blank, and an empty disk name resolves to no disk at all.
    'documents' => env('DOCUMENT_DISK') ?: 'public',

    /*
    |--------------------------------------------------------------------------
    | Filesystem Disks
    |--------------------------------------------------------------------------
    |
    | Below you may configure as many filesystem disks as necessary, and you
    | may even configure multiple disks for the same driver. Examples for
    | most supported storage drivers are configured here for reference.
    |
    | Supported drivers: "local", "ftp", "sftp", "s3"
    |
    */

    'disks' => [

        'local' => [
            'driver' => 'local',
            'root' => storage_path('app/private'),
            'serve' => true,
            'throw' => false,
            'report' => false,
        ],

        'public' => [

            'driver' => env('FILESYSTEM_DISK') === 'azure'
                ? 'azure-storage-blob'
                : 'local',

            'root' => storage_path('app/public'),

            // Local mode returns a relative URL ("/storage/...") so the browser
            // resolves it against whatever origin is currently serving the SPA
            // (works on any dev port, prod domain, or proxy without depending
            // on APP_URL being set correctly). Azure mode uses the absolute
            // container URL since the blob lives off-domain.
            'url' => env('FILESYSTEM_DISK') === 'azure'
                ? env('AZURE_STORAGE_URL')
                : '/storage',

            'visibility' => 'public',
            'throw' => false,
            'report' => false,

            // Azure configuration (used only when azure driver is active)
            'connection_string' => env('AZURE_STORAGE_CONNECTION_STRING'),
            'container' => env('AZURE_STORAGE_CONTAINER'),
        ],

        's3' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_DEFAULT_REGION'),
            'bucket' => env('AWS_BUCKET'),
            'url' => env('AWS_URL'),
            'endpoint' => env('AWS_ENDPOINT'),
            'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE_ENDPOINT', false),
            'throw' => false,
            'report' => false,
        ],

        'azure' => [
            'driver' => 'azure-storage-blob',
            'connection_string' => env('AZURE_STORAGE_CONNECTION_STRING'),
            'container' => env('AZURE_STORAGE_CONTAINER'),
            'url' => env('AZURE_STORAGE_URL'),
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Symbolic Links
    |--------------------------------------------------------------------------
    |
    | Here you may configure the symbolic links that will be created when the
    | `storage:link` Artisan command is executed. The array keys should be
    | the locations of the links and the values should be their targets.
    |
    */

    'links' => [
        public_path('storage') => storage_path('app/public'),
    ],

];
