import { useState, useEffect } from 'react';

interface DummyItem {
    id: number;
    name: string;
    description: string | null;
    created_at: string;
}

export default function App() {
    const [items, setItems] = useState<DummyItem[]>([]);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [status, setStatus] = useState('Loading...');

    const fetchItems = async () => {
        try {
            const res = await fetch('/api/dummy-items');
            const data = await res.json();
            setItems(data);
            setStatus(`API OK - ${data.length} items`);
        } catch (err) {
            setStatus('API Error: ' + String(err));
        }
    };

    useEffect(() => { fetchItems(); }, []);

    const addItem = async (e: React.FormEvent) => {
        e.preventDefault();
        const res = await fetch('/api/dummy-items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ name, description }),
        });
        if (res.ok) {
            setName('');
            setDescription('');
            fetchItems();
        }
    };

    const deleteItem = async (id: number) => {
        await fetch(`/api/dummy-items/${id}`, { method: 'DELETE' });
        fetchItems();
    };

    return (
        <div className="min-h-screen bg-gray-100 p-8">
            <div className="max-w-2xl mx-auto">
                <h1 className="text-4xl font-bold text-gray-900 mb-2">Cross Border Command</h1>
                <p className="text-sm text-gray-500 mb-6">Laravel + React + TypeScript + PostgreSQL</p>

                <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-2 rounded mb-6">
                    Status: {status}
                </div>

                <div className="bg-white rounded-lg shadow p-6 mb-6">
                    <h2 className="text-xl font-semibold mb-4">Add Dummy Item</h2>
                    <form onSubmit={addItem} className="flex gap-2">
                        <input
                            type="text"
                            placeholder="Name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            className="border rounded px-3 py-2 flex-1"
                        />
                        <input
                            type="text"
                            placeholder="Description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="border rounded px-3 py-2 flex-1"
                        />
                        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
                            Add
                        </button>
                    </form>
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                    <h2 className="text-xl font-semibold mb-4">Items ({items.length})</h2>
                    {items.length === 0 ? (
                        <p className="text-gray-500">No items yet. Add one above!</p>
                    ) : (
                        <ul className="space-y-2">
                            {items.map((item) => (
                                <li key={item.id} className="flex justify-between items-center border-b pb-2">
                                    <div>
                                        <span className="font-medium">{item.name}</span>
                                        {item.description && (
                                            <span className="text-gray-500 ml-2">- {item.description}</span>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => deleteItem(item.id)}
                                        className="text-red-500 hover:text-red-700 text-sm"
                                    >
                                        Delete
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}
