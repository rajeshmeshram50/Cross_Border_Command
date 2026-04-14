<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DummyItem;
use Illuminate\Http\Request;

class DummyItemController extends Controller
{
    public function index()
    {
        return response()->json(DummyItem::all());
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'description' => 'nullable|string',
        ]);

        $item = DummyItem::create($validated);

        return response()->json($item, 201);
    }

    public function show(DummyItem $dummyItem)
    {
        return response()->json($dummyItem);
    }

    public function update(Request $request, DummyItem $dummyItem)
    {
        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'description' => 'nullable|string',
        ]);

        $dummyItem->update($validated);

        return response()->json($dummyItem);
    }

    public function destroy(DummyItem $dummyItem)
    {
        $dummyItem->delete();

        return response()->json(null, 204);
    }
}
