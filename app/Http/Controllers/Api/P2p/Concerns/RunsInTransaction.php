<?php

namespace App\Http\Controllers\Api\P2p\Concerns;

use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/**
 * Every write in the P2P PO controllers goes through here: all-or-nothing in one
 * transaction, and an unexpected failure becomes a logged, clean 500 instead of a stack trace.
 */
trait RunsInTransaction
{
    /**
     * @param string   $action  What was attempted, for the log and the message ("create the PO").
     * @param string[] $cleanup Files stored before the write; removed if it fails.
     */
    protected function inTransaction(string $action, callable $work, array $cleanup = []): mixed
    {
        try {
            return DB::transaction($work);
        } catch (ValidationException|HttpResponseException|ModelNotFoundException|HttpExceptionInterface $e) {
            // 422 / 404 / 403 are answers, not failures — they pass through as they are.
            $this->removeFiles($cleanup);
            throw $e;
        } catch (\Throwable $e) {
            $this->removeFiles($cleanup);
            Log::error("P2P PO: could not {$action}", [
                'user_id' => auth()->id(),
                'error'   => $e->getMessage(),
                'at'      => $e->getFile() . ':' . $e->getLine(),
            ]);
            throw new HttpResponseException(response()->json([
                'status'  => false,
                'message' => "Could not {$action}. Nothing was saved — please try again.",
            ], 500));
        }
    }

    private function removeFiles(array $paths): void
    {
        foreach (array_filter($paths) as $path) {
            try { Storage::disk('public')->delete($path); } catch (\Throwable) { /* best effort */ }
        }
    }
}
