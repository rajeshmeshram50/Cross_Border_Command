# Inventory Masters — DB & API

Five masters behind **Inventory Management**: Warehouse, Zone, Rack, Shelf and Product Flags.
Ported from the `Inventory_Management Masters.html` prototype.

> **Not migrated yet.** The five tables are written but unrun — every call 500s until
> `php artisan migrate` has been run.

---

## 1. The shape of it

Four of the five nest, and each level fits inside the one above:

```
Warehouse  (own | 3PL)
└── Zone            rack_mode = rack | norack
    └── Rack        only inside a RACKED zone
        └── Shelf   one level; the thing an SPI box is scanned onto

Product Flags       standalone — handling labels, no parent
```

| Level | Fits inside | Measured in |
|---|---|---|
| Zone | the warehouse's `area_sqft` | square feet |
| Rack | the zone's `area_sqft` | square feet |
| Shelf | the rack's height | centimetres |

Each of those three is a **server-side** check, because only the server can see the siblings.
The screen cannot know what the other zones in a warehouse have already claimed.

### `rack_mode` is the fork that shapes everything

| | Racked zone | Unracked zone |
|---|---|---|
| Holds | racks → shelves | nothing; stock sits on the floor or in a fridge |
| Capacity lives on | its shelves | the zone row itself |
| Capacity columns | all null | `capacity_litres` **or** the dimensions |

Sending the wrong half is **rejected**, not ignored — a fridge saved with floor dimensions
would show capacity it does not have. On save the server also nulls the half the mode does
not use, so a zone switched from floor to racked cannot keep its old figures.

---

## 2. Conventions

**Codes are derived, never stored.** `WH-014` is `'WH-'` plus the zero-padded id; `ZN-003`,
`RK-001` and `PF-004` likewise, and `RK-001-SH-01` is the rack code plus the level. They come
back on every row as `wh_code` / `zone_code` / `rack_code` / `shelf_code` / `flag_code`, and no
endpoint accepts one.

> Because the code comes from the id, it is **global, not per-client** — client A gets `WH-001`
> and client B's first warehouse is `WH-002`. The prototype numbers per client. Say so if that
> matters and the column goes back in.

**`status` is `0` or `1`**, not a word. `1` = active.

**Nothing is hard-deleted once it has children.** `DELETE` returns `409` and names the count;
the status toggle is how a location is retired. Deactivating **cascades downwards** — a rack
under a dead warehouse must not stay on the put-away picker. Re-activating is refused while
the parent is inactive.

**Every list returns the same envelope:**

```json
{
  "status": true,
  "data": [ … ],
  "tabs": { "all": 24, "active": 21, "inactive": 3 },
  "meta": { "page": 1, "per_page": 10, "total": 24, "last_page": 3 }
}
```

The tab counts are taken **before** the search narrows anything, so typing in the box never
makes "All 24" fall to 3. Every list takes `?tab=all|active|inactive&q=&page=&per_page=`;
`per_page` defaults to 10 and is capped at 100.

**Geography is stored by master id.** `country_id` -> `master_countries`, `state_id` -> `master_states`. `state_name` sits beside `state_id` for the one case an id cannot cover: the form offers the States master only for India, and every other country takes a typed province. Exactly one of the two is filled, and `state` in the response is whichever it was.

**The frontend computes, the server stores.** `floor_area`, `volume`, `usable_volume`, the
shelf's `area` and `volume` — all taken as sent. Two exceptions, both because the server uses
the number to decide something:

| Field | Why the server owns it |
|---|---|
| `inventory_racks.area_sqft` | it is the number the zone-capacity guard sums, so a client-supplied value would let the client decide whether the rack fits |
| `inventory_shelves.height_cm` | every shelf-against-rack comparison is in centimetres, and the two forms can be on different units |

**The temperature range lives on the zone only.** A rack and a shelf each carry a `cold_chain`
flag saying whether they may use it; the range itself joins up through
shelf → rack → zone. A rack cannot be cold-chain in a zone that is not, and a shelf cannot be
cold-chain in a rack that is not.

---

## 3. Endpoints

34 routes under `/api/inventory`, all behind `auth:sanctum` + `user.active` + `tenant`.

### Warehouse — `/inventory/warehouses`

| Method | Path | Notes |
|---|---|---|
| GET | `/warehouses` | + `wh_type`, `city`, `state_id`, `country_id`. Rows carry `zones_count`, `racks_count` |
| GET | `/warehouses/options` | active only; `wh_type`, `area_sqft`, `location` for the AUTO fields |
| POST | `/warehouses` | **multipart** — the business card |
| GET | `/warehouses/{id}` | adds `free_area_sqft` |
| POST | `/warehouses/{id}` | POST, not PUT: PHP does not populate `$_FILES` on a PUT |
| PUT | `/warehouses/{id}/status` | cascades to zones **and** racks |
| DELETE | `/warehouses/{id}` | 409 once it holds zones |

### Zone — `/inventory/zones`

| Method | Path | Notes |
|---|---|---|
| GET | `/zones` | + `warehouse_id`, `rack_mode`, `cold_chain`, `hazardous` |
| GET | `/zones/options` | `warehouse_id` required; pass `rack_mode=rack` for the Rack form |
| POST | `/zones` | |
| GET | `/zones/{id}` | adds `free_area_sqft` |
| PUT | `/zones/{id}` | 409 if switched to `norack` while it has racks |
| PUT | `/zones/{id}/status` | cascades to racks |
| DELETE | `/zones/{id}` | 409 once it holds racks |

### Rack — `/inventory/racks`

| Method | Path | Notes |
|---|---|---|
| GET | `/racks` | + `warehouse_id`, `zone_id`, `cold_chain`, `hazardous`. Rows carry `shelves_count`, `capacity_kg`, `used_kg`, `load_pct` |
| GET | `/racks/options` | `warehouse_id` or `zone_id`; returns `height_cm` converted |
| POST | `/racks` | `warehouse_id` is **not** sent — taken from the zone |
| GET | `/racks/{id}` | adds `free_height_cm`, `next_level_no` |
| PUT | `/racks/{id}` | refuses a height below what its shelves already use |
| PUT | `/racks/{id}/status` | cascades to shelves |
| DELETE | `/racks/{id}` | 409 once it holds shelves |

### Shelf — nested under its rack

| Method | Path | Notes |
|---|---|---|
| GET | `/racks/{rack}/shelves` | levels + KPI strip + the rack's limits, in one call. Not paginated — a rack has levels, not pages |
| POST | `/racks/{rack}/shelves` | |
| GET | `/shelves/{id}` | |
| PUT | `/shelves/{id}` | `max_weight_kg` cannot drop below what is stored |
| PUT | `/shelves/{id}/status` | 409 while boxes are on it |
| DELETE | `/shelves/{id}` | 409 while boxes are on it |

`used_weight_kg` and `boxes_count` are **not writable** — they belong to the SPI put-away. A
master form that could set them would let someone mark a shelf empty while boxes are still on
it. `occupancy` (`empty` / `partial` / `full` / `inactive`) and `load_pct` are derived from
used vs max, so they cannot contradict the stored weight.

### Product Flags — `/inventory/product-flags`

Standard seven. Delete is allowed outright — a flag has no children to orphan. The name is
unique per client, because two flags called "Fragile" would be indistinguishable on the box form.

---

## 4. Files

| | |
|---|---|
| Migrations | `database/migrations/2026_10_10_000001…000005_*` |
| Models | `app/Models/Inventory/{Warehouse,Zone,Rack,Shelf,ProductFlag}.php` |
| Controllers | `app/Http/Controllers/Api/Inventory/` + `BaseInventoryController` |
| Service | `app/Services/Inventory/InventoryMasterService.php` — the capacity arithmetic the four levels share |
| Routes | `routes/api.php`, the `inventory` prefix group |
| Postman | `docs/inventory/Inventory_Masters.postman_collection.json` |

---

## 5. Open

**The SPI put-away still reads the OLD `master_*` tables** — 8 call sites in
`app/Http/Controllers/Api/P2p/SpiPutawayController.php` (lines 64, 103, 271, 281, 292, 304–307)
plus `SupplierInvoiceController.php:880`. Repointing them needs three changes, not one:

1. table names → `inventory_*`
2. `wh_type` is now `own` / `tpl`, not the string `'Own Warehouse'` — both own-warehouse
   checks compare against that literal
3. the scan matches `rackName` / `shelf_name`; with derived codes it should resolve
   `RK-001` → id and match on that

**Shelf occupancy has no writer yet.** `used_weight_kg` and `boxes_count` are stored but
nothing increments them — the put-away confirm step has to, once it points at these tables.
