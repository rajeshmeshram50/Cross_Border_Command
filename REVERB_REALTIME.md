# Real-time with Laravel Reverb — Cross_Border_Command

> How real-time (WebSocket) updates work in this app, how to run Reverb locally
> and in production, and a copy-paste recipe for adding a **new** real-time
> feature or channel.

Reverb is Laravel's first-party WebSocket server (Pusher protocol). We use it so
list/detail screens update **live** — no manual refresh — and for a live
**"is typing…"** indicator in the CLM clarification chat.

---

## 1. The moving parts (what lives where)

| Layer | File | Role |
|---|---|---|
| **Event** | [app/Events/CtcApprovalUpdated.php](app/Events/CtcApprovalUpdated.php) | The broadcast message — defines the channel, event name, and payload. |
| **Channel auth** | [routes/channels.php](routes/channels.php) | Decides *which user* may listen on a private channel. |
| **Registration** | [bootstrap/app.php](bootstrap/app.php) | `->withBroadcasting(...)` wires `channels.php` + the `/broadcasting/auth` route (Sanctum-guarded). |
| **Fire the broadcast** | [app/Http/Controllers/Api/CtcContractController.php](app/Http/Controllers/Api/CtcContractController.php) | Calls `broadcast(new CtcApprovalUpdated($row))` after a state change. |
| **Server config** | [config/reverb.php](config/reverb.php) | Reverb app keys, bind host/port, client-event policy. |
| **Driver select** | `config/broadcasting.php` + `.env` | `BROADCAST_CONNECTION=reverb`. |
| **Frontend client** | [resources/js/echo.ts](resources/js/echo.ts) | Single shared Laravel Echo connection (Sanctum bearer auth). |
| **Subscriptions** | [resources/js/pages/clm/ClmAgreementsToApprovePage.tsx](resources/js/pages/clm/ClmAgreementsToApprovePage.tsx), [ClmAgreementsSentPage.tsx](resources/js/pages/clm/ClmAgreementsSentPage.tsx) | `echo.private(...).listen(...)` → refetch on event. |
| **Typing hook** | [resources/js/hooks/useTyping.ts](resources/js/hooks/useTyping.ts) | "is typing…" via whisper (client-to-client) events. |
| **Typing UI** | [resources/js/components/TypingIndicator.tsx](resources/js/components/TypingIndicator.tsx) | The animated dots pill. |

### Flow (one live update)
```
Controller saves a change
  → broadcast(new CtcApprovalUpdated($row))           [server]
      → Event::broadcastOn() → PrivateChannel("clm.approvals.{clientId}")
          → routes/channels.php authorizes the subscriber
              → Reverb pushes the event over the WebSocket
                  → page's echo.private(...).listen('.approval.updated', cb)  [browser]
                      → cb() refetches the list — no manual refresh
```

---

## 2. Local setup (one time, per developer)

`.env` is **not** committed, so add this block (keys are shared by the team —
Reverb is self-hosted, so the values only need to match between *our* backend and
frontend; they are not an external account):

```env
BROADCAST_CONNECTION=reverb

REVERB_APP_ID=690756
REVERB_APP_KEY=jbs3lwv3zrkwazjwm5hd
REVERB_APP_SECRET=p22l1mpmivr0aveppdae
REVERB_HOST="localhost"
REVERB_PORT=8085
REVERB_SCHEME=http
REVERB_SERVER_HOST=0.0.0.0
REVERB_SERVER_PORT=8085

VITE_REVERB_APP_KEY="${REVERB_APP_KEY}"
VITE_REVERB_HOST="${REVERB_HOST}"
VITE_REVERB_PORT="${REVERB_PORT}"
VITE_REVERB_SCHEME="${REVERB_SCHEME}"
```

> ⚠️ **Two different ports.** `REVERB_SERVER_PORT` is what the server *binds/listens*
> on; `REVERB_PORT` is what the *browser connects* to. Locally keep them the same.
> Do **not** use `8080` — XAMPP Apache uses it. `8000` clashes with `artisan serve`.
> `8085` is safe.
>
> ⚠️ Never expose `REVERB_APP_SECRET` to the frontend — there is intentionally no
> `VITE_REVERB_APP_SECRET`.

### Commands after pulling
```bash
composer install          # installs laravel/reverb (already in composer.json + lock)
npm install               # installs laravel-echo + pusher-js (already in package.json)
# add the .env block above
php artisan config:clear  # REQUIRED after any .env change — config is cached
npm run build             # VITE_REVERB_* values are baked in at build time
php artisan reverb:start --debug   # start the WS server (keep this terminal open)
```

> `php artisan reverb:install` is **not** required after a pull — the config files
> (`config/reverb.php`, `config/broadcasting.php`, `routes/channels.php`) are
> already committed. Only the `.env` block must be added manually.

### Verify it's working
1. Two browsers, **same client**, both on **Agreements to Approve**.
2. The `reverb:start` terminal prints `Connection Established` when each page loads.
3. One user approves/rejects → the other list refreshes by itself.
4. Browser DevTools → Network → **WS** tab shows an open `ws://localhost:8085` (status 101).

If `echo` is `null` (env not set / not built) the app still works — it falls back
to the window-focus / manual refresh, and prints no errors.

---

## 3. Production setup (one time, on the server)

Reverb is a long-running process — run it as a **service** so it auto-starts on
boot and auto-restarts on crash. **You do not start it manually each time.**

### Linux (Supervisor) — recommended
`/etc/supervisor/conf.d/reverb.conf`:
```ini
[program:reverb]
command=/usr/bin/php /var/www/html/artisan reverb:start --host=0.0.0.0 --port=8085
directory=/var/www/html
autostart=true
autorestart=true
user=root
redirect_stderr=true
stdout_logfile=/var/www/html/storage/logs/reverb.log
stopwaitsecs=10
```
```bash
supervisorctl reread
supervisorctl update
supervisorctl start reverb
supervisorctl status reverb     # → RUNNING
```
> Adjust the two paths to match `which php` and the app folder (`pwd`).

### Windows server (NSSM)
```powershell
nssm install Reverb "C:\path\php.exe" "C:\path\artisan reverb:start --host=0.0.0.0 --port=8085"
nssm start Reverb
```

### Production `.env` (client-facing values point to the public domain)
```env
REVERB_HOST="yourdomain.com"
REVERB_PORT=443
REVERB_SCHEME=https
REVERB_SERVER_HOST=0.0.0.0
REVERB_SERVER_PORT=8085
```
Then on the server: `php artisan config:clear` → `npm run build`.

### nginx — expose as secure `wss://`
```nginx
location /app {                      # Reverb's default path
    proxy_pass http://127.0.0.1:8085;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 60s;
}
```

### ⚠️ Restart after every deploy
Reverb caches PHP in memory, so it won't pick up new event/broadcast code until restarted:
```bash
supervisorctl restart reverb     # Linux
nssm restart Reverb              # Windows
```

---

## 4. How to add a NEW real-time feature / channel

Copy this 4-step recipe. Example: live-update a "Tasks" board for a branch.

### Step 1 — Create an Event
`app/Events/TaskUpdated.php`:
```php
<?php
namespace App\Events;

use App\Models\Task;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow; // ...Now = no queue
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class TaskUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public int $clientId;
    public int $branchId;
    public int $taskId;
    public string $status;

    public function __construct(Task $task)
    {
        $this->clientId = (int) $task->client_id;
        $this->branchId = (int) $task->branch_id;
        $this->taskId   = (int) $task->id;
        $this->status   = (string) $task->status;
    }

    // WHICH channel — scope it by tenant (and branch here).
    public function broadcastOn(): array
    {
        return [new PrivateChannel("tasks.{$this->clientId}.{$this->branchId}")];
    }

    // The event name the frontend listens for (note the leading dot in JS).
    public function broadcastAs(): string
    {
        return 'task.updated';
    }

    // The payload delivered to the browser.
    public function broadcastWith(): array
    {
        return ['task_id' => $this->taskId, 'status' => $this->status];
    }
}
```
> Use `ShouldBroadcastNow` for instant delivery. Use `ShouldBroadcast` (no "Now")
> if you want it queued — then a queue worker (`php artisan queue:work`) must run.

### Step 2 — Authorize the channel
Add to [routes/channels.php](routes/channels.php) — return `true` only if the user belongs to that scope:
```php
Broadcast::channel('tasks.{clientId}.{branchId}', function ($user, $clientId, $branchId) {
    return (int) $user->client_id === (int) $clientId
        && (int) $user->branch_id === (int) $branchId;
});
```
> **Tenant safety:** always check `client_id` (and `branch_id` when relevant)
> against the authenticated `$user`. This is what stops cross-tenant listening.

### Step 3 — Fire the broadcast from the controller
After you persist the change:
```php
use App\Events\TaskUpdated;

// ...inside store()/update()/approve() etc, after $task->save():
broadcast(new TaskUpdated($task->fresh()));
```

### Step 4 — Subscribe on the frontend page
```tsx
import { echo } from '../../echo';
import { useAuth } from '../../contexts/AuthContext';

const { user } = useAuth();

useEffect(() => {
  const cid = user?.client_id;
  const bid = user?.branch_id;
  if (!echo || !cid || !bid) return;
  const name = `tasks.${cid}.${bid}`;
  echo.private(name).listen('.task.updated', (e: { task_id: number; status: string }) => {
    load();                 // refetch the list…
    // …or update one row directly from the payload `e`
  });
  return () => { echo.leave(name); };   // leave on unmount
}, [user?.client_id, user?.branch_id]);
```

That's it — saving a task in one browser now updates everyone watching that
branch's board.

### Channel naming convention used here
- Tenant-wide: `clm.approvals.{clientId}`
- Tenant + branch: `tasks.{clientId}.{branchId}`
- Per user: `notifications.{userId}`

Keep the scope in the **channel name**, and authorize that exact pattern in
`channels.php`.

---

## 5. Adding a "typing…" / presence-style signal (whisper events)

For ephemeral, live-only signals (typing, cursor, "viewing now") use **whispers** —
client-to-client events that **don't** hit the backend (no event class, no route,
no DB). They ride an existing private channel. See [resources/js/hooks/useTyping.ts](resources/js/hooks/useTyping.ts).

Send on keystroke:
```ts
echo.private(channelName).whisper('typing', { contractId, userId, name, typing: true });
```
Listen:
```ts
echo.private(channelName).listenForWhisper('typing', (e) => { /* show "{e.name} is typing…" */ });
```
Clean up the listener **without** leaving the channel (it's shared with the page subscription):
```ts
echo.private(channelName).stopListeningForWhisper('typing', cb);   // NOT echo.leave()
```
> Whispers require the channel to be private/presence and the sender to be
> subscribed. In [config/reverb.php](config/reverb.php) this is allowed via
> `accept_client_events_from => 'members'`.

---

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Failed to listen on tcp://0.0.0.0:8080 … forbidden` | Port taken (XAMPP Apache) **or** cached config. Change `REVERB_SERVER_PORT`, then `php artisan config:clear`. |
| Port edits in `.env` ignored | Config is cached → `php artisan config:clear`. Remember `REVERB_SERVER_PORT` (bind) vs `REVERB_PORT` (client). |
| No `Connection Established` in the terminal | Frontend not built with the env → re-run `npm run build`; check DevTools → Network → WS. |
| `/broadcasting/auth` returns **403** | The user's `client_id`/`branch_id` doesn't match the channel (expected cross-tenant; for same-tenant check `channels.php` + that the Sanctum token is sent). |
| Updates work, then stop after a deploy | Restart Reverb — it caches PHP in memory (`supervisorctl restart reverb`). |
| Nothing real-time, but no errors | `echo` is `null` (env missing/not built). App falls back to focus/manual refresh — set env + `npm run build`. |

---

## 7. Golden rules

1. **`php artisan config:clear` after every `.env` change**, and restart `reverb:start`.
2. **`npm run build` after changing any `VITE_REVERB_*`** — Vite bakes them at build time.
3. **Restart Reverb after every production deploy** — it won't see new PHP otherwise.
4. **Always tenant-scope** the channel name *and* authorize it in `channels.php`.
5. **Never** put `REVERB_APP_SECRET` on the frontend.
6. Server bind port = `REVERB_SERVER_PORT`; browser connect port = `REVERB_PORT`.
