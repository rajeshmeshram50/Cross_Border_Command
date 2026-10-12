import axios from 'axios';
import api from '../../../api';
import type { ServerPageMeta } from '../../../hooks/useServerList';

export type WarehouseType = 'own' | 'tpl';

export interface Warehouse {
  apiId?: number;
  countryId?: number | null;
  stateId?: number | null;
  dial?: string;
  cardName?: string;
  cardUrl?: string;
  zones?: number;
  racks?: number;
  id: string;
  date: string;
  type: WarehouseType;
  name: string;
  area: number;
  address: string;
  country: string;
  state: string;
  city: string;
  pin: string;
  map: string;
  contact: string;
  mobile: string;
  email: string;
  status: 'active' | 'inactive';
}

export type WarehouseTab = 'all' | WarehouseType;
export type WarehouseCounts = Record<WarehouseTab, number>;

export interface LookupOption { id: number; name: string }

export interface WarehousePayload {
  wh_name: string;
  wh_type: WarehouseType;
  area_sqft: number;
  address: string;
  country_id: number;
  state_id: number | null;
  state_name: string | null;
  city: string;
  pincode: string;
  map_url: string | null;
  contact_person: string;
  contact_dial: string | null;
  contact_mobile: string;
  contact_email: string;
  card?: File | null;
}

type WarehouseRow = {
  id: number;
  wh_code: string | null;
  wh_name: string | null;
  wh_type: WarehouseType;
  area_sqft: number | null;
  address: string | null;
  country_id: number | null;
  country: string | null;
  state_id: number | null;
  state: string | null;
  city: string | null;
  pincode: string | null;
  map_url: string | null;
  contact_person: string | null;
  contact_dial: string | null;
  contact_mobile: string | null;
  contact_email: string | null;
  card_name: string | null;
  card_url: string | null;
  zones_count: number | null;
  racks_count: number | null;
  status: number;
  created_at: string | null;
};

export class WarehouseApiError extends Error {
  constructor(message: string, public status: number | null, public fieldErrors: Record<string, string[]> = {}) {
    super(message);
    this.name = 'WarehouseApiError';
  }
}

async function call<T>(run: () => Promise<{ data: unknown }>, pick: (body: unknown) => T): Promise<T> {
  try {
    return pick((await run()).data);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const body = err.response?.data as { message?: string; errors?: Record<string, string[]> } | undefined;
      throw new WarehouseApiError(body?.message || err.message || 'Request failed', err.response?.status ?? null, body?.errors ?? {});
    }
    throw err;
  }
}

const toWarehouse = (r: WarehouseRow): Warehouse => ({
  apiId: r.id,
  countryId: r.country_id,
  stateId: r.state_id,
  dial: r.contact_dial ?? '',
  cardName: r.card_name ?? '',
  cardUrl: r.card_url ?? '',
  zones: Number(r.zones_count ?? 0),
  racks: Number(r.racks_count ?? 0),
  id: r.wh_code || `WH-${String(r.id).padStart(3, '0')}`,
  date: r.created_at ?? '',
  type: r.wh_type === 'tpl' ? 'tpl' : 'own',
  name: r.wh_name ?? '',
  area: Number(r.area_sqft ?? 0),
  address: r.address ?? '',
  country: r.country ?? '',
  state: r.state ?? '',
  city: r.city ?? '',
  pin: r.pincode ?? '',
  map: r.map_url ?? '',
  contact: r.contact_person ?? '',
  mobile: r.contact_mobile ?? '',
  email: r.contact_email ?? '',
  status: Number(r.status) === 1 ? 'active' : 'inactive',
});

const one = (b: unknown) => toWarehouse((b as { data: WarehouseRow }).data);

const toForm = (p: WarehousePayload) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(p)) {
    if (k === 'card') continue;
    fd.append(k, v == null ? '' : String(v));
  }
  if (p.card) fd.append('card', p.card);
  return fd;
};

const lookupRows = (b: unknown): LookupOption[] => {
  const raw = Array.isArray(b) ? b : Array.isArray((b as { data?: unknown })?.data) ? (b as { data: unknown[] }).data : [];
  return (raw as Array<{ id: number; name: string }>)
    .filter(r => r && r.id && r.name)
    .map(r => ({ id: Number(r.id), name: String(r.name) }))
    .sort((a, b2) => a.name.localeCompare(b2.name));
};

const multipart = { headers: { 'Content-Type': 'multipart/form-data' } };

export const warehouseApi = {
  list: (q: { tab?: WarehouseTab; search?: string; page?: number; per_page?: number }) =>
    call(() => api.get('/inventory/warehouses', {
      params: {
        wh_type: q.tab && q.tab !== 'all' ? q.tab : undefined,
        q: q.search || undefined, page: q.page, per_page: q.per_page,
      },
    }), (b) => {
      const body = b as { data?: WarehouseRow[]; meta?: ServerPageMeta } | null;
      return { rows: (body?.data ?? []).map(toWarehouse), meta: body?.meta ?? null };
    }),

  counts: async (): Promise<WarehouseCounts> => {
    const total = (t: WarehouseType) => call(
      () => api.get('/inventory/warehouses', { params: { wh_type: t, per_page: 1 } }),
      (b) => Number((b as { meta?: ServerPageMeta } | null)?.meta?.total ?? 0),
    );
    const [own, tpl] = await Promise.all([total('own'), total('tpl')]);
    return { all: own + tpl, own, tpl };
  },

  countries: () => call(() => api.get('/master/countries', { params: { fields: 'id,name' } }), lookupRows),

  states: (countryId: number) =>
    call(() => api.get('/master/states', { params: { country_id: countryId, fields: 'id,name' } }), lookupRows),

  create: (data: WarehousePayload) => call(() => api.post('/inventory/warehouses', toForm(data), multipart), one),

  update: (apiId: number, data: WarehousePayload) =>
    call(() => api.post(`/inventory/warehouses/${apiId}`, toForm(data), multipart), one),

  setStatus: (apiId: number, active: boolean) =>
    call(() => api.put(`/inventory/warehouses/${apiId}/status`, { status: active ? 1 : 0 }), one),

  nextCode: () => call(
    () => api.get('/inventory/warehouses/next-code'),
    (b) => String((b as { data?: { next_code?: string } } | null)?.data?.next_code ?? ''),
  ),
};

export const WAREHOUSES: Warehouse[] = [
  {
    id: 'WH-001',
    date: '2025-04-12',
    type: 'own',
    name: 'Mumbai Central Warehouse',
    area: 42000,
    address: 'Plot 14, MIDC Industrial Area, Andheri East',
    country: 'India',
    state: 'Maharashtra',
    city: 'Mumbai',
    pin: '400093',
    map: 'https://maps.google.com/?q=MIDC+Andheri+East+Mumbai',
    contact: 'Sandeep Patil',
    mobile: '+91 9820011223',
    email: 'sandeep.patil@inorbvict.com',
    status: 'active',
  },
  {
    id: 'WH-002',
    date: '2025-06-03',
    type: 'own',
    name: 'Pune Phase 2 Warehouse',
    area: 28500,
    address: 'Survey No. 45, Hinjewadi Phase 2, Maan Road',
    country: 'India',
    state: 'Maharashtra',
    city: 'Pune',
    pin: '411057',
    map: 'https://maps.google.com/?q=Hinjewadi+Phase+2+Pune',
    contact: 'Priya Kulkarni',
    mobile: '+91 9890045678',
    email: 'priya.kulkarni@inorbvict.com',
    status: 'active',
  },
  {
    id: 'WH-003',
    date: '2025-09-18',
    type: 'own',
    name: 'Delhi North Warehouse',
    area: 18000,
    address: 'B-62, Okhla Industrial Area Phase 1',
    country: 'India',
    state: 'Delhi',
    city: 'New Delhi',
    pin: '110020',
    map: 'https://maps.google.com/?q=Okhla+Industrial+Area+Phase+1+Delhi',
    contact: 'Amit Sharma',
    mobile: '+91 9811023344',
    email: 'amit.sharma@inorbvict.com',
    status: 'active',
  },
  {
    id: 'WH-004',
    date: '2026-01-22',
    type: 'tpl',
    name: 'Third Party Warehouse (3PL)',
    area: 60000,
    address: 'Gala No. 7, Rajlaxmi Logistics Park, Vadape, Bhiwandi',
    country: 'India',
    state: 'Maharashtra',
    city: 'Thane',
    pin: '421302',
    map: '',
    contact: 'Rakesh Jain',
    mobile: '+91 9769034455',
    email: 'ops@rajlaxmilogistics.in',
    status: 'active',
  },
  {
    id: 'WH-005',
    date: '2025-08-07',
    type: 'tpl',
    name: '3PL Warehouse – Bhiwandi Hub B',
    area: 48000,
    address: 'Building C-4, Vashere Logistics Park, Bhiwandi',
    country: 'India',
    state: 'Maharashtra',
    city: 'Thane',
    pin: '421302',
    map: 'https://maps.google.com/?q=Bhiwandi+Logistics+Park',
    contact: 'Manoj Gupta',
    mobile: '+91 9769011122',
    email: 'ops@vasherelogistics.in',
    status: 'active',
  },
  {
    id: 'WH-006',
    date: '2025-10-21',
    type: 'tpl',
    name: '3PL Warehouse – Chakan',
    area: 35000,
    address: 'Gat No. 312, Chakan MIDC Phase 2, Khed',
    country: 'India',
    state: 'Maharashtra',
    city: 'Pune',
    pin: '410501',
    map: 'https://maps.google.com/?q=Chakan+MIDC+Pune',
    contact: 'Sachin Pawar',
    mobile: '+91 9890122233',
    email: 'warehouse@chakanstore.in',
    status: 'active',
  },
  {
    id: 'WH-007',
    date: '2025-12-09',
    type: 'tpl',
    name: '3PL Warehouse – Kundli',
    area: 40000,
    address: 'Plot 77, HSIIDC Industrial Estate, Kundli',
    country: 'India',
    state: 'Haryana',
    city: 'Sonipat',
    pin: '131028',
    map: 'https://maps.google.com/?q=Kundli+Sonipat',
    contact: 'Deepak Malik',
    mobile: '+91 9812233344',
    email: 'kundli@northlinkwh.in',
    status: 'active',
  },
  {
    id: 'WH-008',
    date: '2026-01-13',
    type: 'tpl',
    name: '3PL Warehouse – Hoskote',
    area: 38500,
    address: 'Sy. No. 45, Hoskote Industrial Area, Old Madras Road',
    country: 'India',
    state: 'Karnataka',
    city: 'Bengaluru',
    pin: '562114',
    map: '',
    contact: 'Prakash Gowda',
    mobile: '+91 9845344455',
    email: 'hoskote@southcorewh.in',
    status: 'active',
  },
  {
    id: 'WH-009',
    date: '2026-02-03',
    type: 'tpl',
    name: '3PL Warehouse – Oragadam',
    area: 36500,
    address: 'Plot 12, Oragadam Industrial Corridor, Sriperumbudur',
    country: 'India',
    state: 'Tamil Nadu',
    city: 'Chennai',
    pin: '602105',
    map: 'https://maps.google.com/?q=Oragadam+Chennai',
    contact: 'Karthik Subramanian',
    mobile: '+91 9840455566',
    email: 'oragadam@baylinewh.in',
    status: 'active',
  },
  {
    id: 'WH-010',
    date: '2026-02-05',
    type: 'own',
    name: 'Bengaluru Hosur Road Warehouse',
    area: 36000,
    address: 'No. 88, Electronic City Phase 1, Hosur Road',
    country: 'India',
    state: 'Karnataka',
    city: 'Bengaluru',
    pin: '560100',
    map: 'https://maps.google.com/?q=Electronic+City+Bengaluru',
    contact: 'Kiran Rao',
    mobile: '+91 9845012345',
    email: 'kiran.rao@inorbvict.com',
    status: 'active',
  },
  {
    id: 'WH-011',
    date: '2026-02-19',
    type: 'own',
    name: 'Chennai SIPCOT Warehouse',
    area: 30500,
    address: 'Plot B-17, SIPCOT Industrial Park, Sriperumbudur',
    country: 'India',
    state: 'Tamil Nadu',
    city: 'Chennai',
    pin: '602105',
    map: 'https://maps.google.com/?q=SIPCOT+Sriperumbudur',
    contact: 'Lakshmi Narayanan',
    mobile: '+91 9840023456',
    email: 'lakshmi.n@inorbvict.com',
    status: 'active',
  },
  {
    id: 'WH-012',
    date: '2026-02-24',
    type: 'tpl',
    name: '3PL Warehouse – Medchal',
    area: 27500,
    address: 'Sy. No. 98, Medchal Industrial Area',
    country: 'India',
    state: 'Telangana',
    city: 'Hyderabad',
    pin: '501401',
    map: 'https://maps.google.com/?q=Medchal+Hyderabad',
    contact: 'Ravi Teja',
    mobile: '+91 9849566677',
    email: 'medchal@deccanstore.in',
    status: 'inactive',
  },
  {
    id: 'WH-013',
    date: '2026-03-02',
    type: 'own',
    name: 'Hyderabad Shamshabad Warehouse',
    area: 27000,
    address: 'Sy. No. 210, Shamshabad Industrial Area',
    country: 'India',
    state: 'Telangana',
    city: 'Hyderabad',
    pin: '501218',
    map: 'https://maps.google.com/?q=Shamshabad+Hyderabad',
    contact: 'Srinivas Reddy',
    mobile: '+91 9849034567',
    email: 'srinivas.reddy@inorbvict.com',
    status: 'active',
  },
  {
    id: 'WH-014',
    date: '2026-03-11',
    type: 'tpl',
    name: '3PL Warehouse – Sanand',
    area: 31000,
    address: 'Plot 4B, Sanand GIDC Phase 2',
    country: 'India',
    state: 'Gujarat',
    city: 'Ahmedabad',
    pin: '382110',
    map: 'https://maps.google.com/?q=Sanand+GIDC',
    contact: 'Jignesh Patel',
    mobile: '+91 9825677788',
    email: 'sanand@westgatewh.in',
    status: 'active',
  },
  {
    id: 'WH-015',
    date: '2026-03-16',
    type: 'own',
    name: 'Ahmedabad Changodar Warehouse',
    area: 24000,
    address: 'Shed No. 5, Changodar Industrial Estate, Sarkhej-Bavla Road',
    country: 'India',
    state: 'Gujarat',
    city: 'Ahmedabad',
    pin: '382213',
    map: 'https://maps.google.com/?q=Changodar+Ahmedabad',
    contact: 'Hetal Shah',
    mobile: '+91 9825045678',
    email: 'hetal.shah@inorbvict.com',
    status: 'active',
  },
  {
    id: 'WH-016',
    date: '2026-04-01',
    type: 'own',
    name: 'Kolkata Dankuni Warehouse',
    area: 21500,
    address: 'Plot 9, Dankuni Industrial Complex, Durgapur Expressway',
    country: 'India',
    state: 'West Bengal',
    city: 'Kolkata',
    pin: '712311',
    map: 'https://maps.google.com/?q=Dankuni+Kolkata',
    contact: 'Arindam Ghosh',
    mobile: '+91 9830056789',
    email: 'arindam.ghosh@inorbvict.com',
    status: 'inactive',
  },
  {
    id: 'WH-017',
    date: '2026-04-07',
    type: 'tpl',
    name: '3PL Warehouse – Uluberia',
    area: 22000,
    address: 'NH-16, Uluberia Industrial Growth Centre',
    country: 'India',
    state: 'West Bengal',
    city: 'Howrah',
    pin: '711316',
    map: '',
    contact: 'Subhajit Das',
    mobile: '+91 9830788899',
    email: 'uluberia@eastportwh.in',
    status: 'active',
  },
  {
    id: 'WH-018',
    date: '2026-04-14',
    type: 'own',
    name: 'Gurugram Manesar Warehouse',
    area: 33000,
    address: 'Plot 41, Sector 8, IMT Manesar',
    country: 'India',
    state: 'Haryana',
    city: 'Gurugram',
    pin: '122051',
    map: 'https://maps.google.com/?q=IMT+Manesar+Gurugram',
    contact: 'Vikram Yadav',
    mobile: '+91 9810067890',
    email: 'vikram.yadav@inorbvict.com',
    status: 'active',
  },
  {
    id: 'WH-019',
    date: '2026-04-29',
    type: 'tpl',
    name: '3PL Warehouse – Taloja',
    area: 29000,
    address: 'Plot T-31, Taloja MIDC',
    country: 'India',
    state: 'Maharashtra',
    city: 'Navi Mumbai',
    pin: '410208',
    map: 'https://maps.google.com/?q=Taloja+MIDC',
    contact: 'Ajay Kadam',
    mobile: '+91 9820899900',
    email: 'taloja@harbourwh.in',
    status: 'active',
  },
  {
    id: 'WH-020',
    date: '2026-05-06',
    type: 'own',
    name: 'Nagpur MIHAN Warehouse',
    area: 19500,
    address: 'Unit 3, MIHAN SEZ, Wardha Road',
    country: 'India',
    state: 'Maharashtra',
    city: 'Nagpur',
    pin: '441108',
    map: 'https://maps.google.com/?q=MIHAN+Nagpur',
    contact: 'Rohit Deshmukh',
    mobile: '+91 9822078901',
    email: 'rohit.deshmukh@inorbvict.com',
    status: 'active',
  },
  {
    id: 'WH-021',
    date: '2026-05-20',
    type: 'tpl',
    name: '3PL Warehouse – Rewari',
    area: 26000,
    address: 'Khasra 210, Dharuhera Industrial Belt, Rewari',
    country: 'India',
    state: 'Haryana',
    city: 'Rewari',
    pin: '123401',
    map: 'https://maps.google.com/?q=Dharuhera+Rewari',
    contact: 'Sunil Yadav',
    mobile: '+91 9812900011',
    email: 'rewari@nh48store.in',
    status: 'inactive',
  },
  {
    id: 'WH-022',
    date: '2026-05-27',
    type: 'own',
    name: 'Jaipur Sitapura Warehouse',
    area: 16000,
    address: 'G-112, Sitapura Industrial Area, Tonk Road',
    country: 'India',
    state: 'Rajasthan',
    city: 'Jaipur',
    pin: '302022',
    map: 'https://maps.google.com/?q=Sitapura+Jaipur',
    contact: 'Neha Agarwal',
    mobile: '+91 9829089012',
    email: 'neha.agarwal@inorbvict.com',
    status: 'active',
  },
  {
    id: 'WH-023',
    date: '2026-06-10',
    type: 'tpl',
    name: '3PL Warehouse – Kalamboli',
    area: 25500,
    address: 'Warehouse 6, Kalamboli Steel Market, Panvel',
    country: 'India',
    state: 'Maharashtra',
    city: 'Navi Mumbai',
    pin: '410218',
    map: 'https://maps.google.com/?q=Kalamboli+Navi+Mumbai',
    contact: 'Ganesh Shinde',
    mobile: '+91 9820011234',
    email: 'kalamboli@steelyardwh.in',
    status: 'active',
  },
  {
    id: 'WH-024',
    date: '2026-06-18',
    type: 'own',
    name: 'Lucknow Chinhat Warehouse',
    area: 14500,
    address: 'Plot 26, Chinhat Industrial Area, Faizabad Road',
    country: 'India',
    state: 'Uttar Pradesh',
    city: 'Lucknow',
    pin: '226019',
    map: 'https://maps.google.com/?q=Chinhat+Lucknow',
    contact: 'Saurabh Mishra',
    mobile: '+91 9839090123',
    email: 'saurabh.mishra@inorbvict.com',
    status: 'inactive',
  },
];
