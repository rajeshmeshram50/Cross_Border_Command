<?php

namespace App\Providers;

use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\ServiceProvider;
use League\Flysystem\AzureBlobStorage\AzureBlobStorageAdapter;
use League\Flysystem\Filesystem;
use MicrosoftAzure\Storage\Blob\BlobRestProxy;


class AzureStorageServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Storage::extend('azure-storage-blob', function ($app, array $config) {
            $client = BlobRestProxy::createBlobService($config['connection_string']);
            $adapter = new AzureBlobStorageAdapter(
                $client,
                $config['container'],
                $config['prefix'] ?? ''
            );
            $filesystem = new Filesystem($adapter);

            return new FilesystemAdapter($filesystem, $adapter, $config);
        });
    }
}
