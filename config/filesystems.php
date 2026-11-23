<?php

return [
    'default' => env('FILESYSTEM_DISK', 'local'),

    'documents' => env('DOCUMENT_DISK') ?: 'public',

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

            'url' => env('FILESYSTEM_DISK') === 'azure'
                ? env('AZURE_STORAGE_URL')
                : '/storage',

            'visibility' => 'public',
            'throw' => false,
            'report' => false,

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

    'links' => [
        public_path('storage') => storage_path('app/public'),
    ],
];
