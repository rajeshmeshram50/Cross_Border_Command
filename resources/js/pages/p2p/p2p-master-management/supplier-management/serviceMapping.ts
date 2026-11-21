/* Map Product / Service for SERVICE-provider suppliers — the one place both the supplier form
   (AddVendorModal) and the Supplier list (Vendors) read, so they can never disagree.

   A small module on purpose: the list imports it without pulling in the form's chunk. */

/** The Service Management bucket a supplier serves, as [service_type, classification]. */
export type ServiceBucket = {
  serviceType: 'soft_digital' | 'self_consumable' | 'other_operational';
  classification: string | null;
};

/** A type name with spacing and case ignored: "Material / Goods" and "Material/ Goods" are one type. */
const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** Supplier Type → its bucket. Mirrors ServiceController::VENDOR_TYPE_BY_NAME on the server. */
const BUCKET_BY_TYPE: Record<string, ServiceBucket> = {
  [squash('Soft Service Provider')]: { serviceType: 'soft_digital',      classification: null },
  [squash('Trackable Services')]:    { serviceType: 'self_consumable',   classification: 'trackable' },
  [squash('Consumable Services')]:   { serviceType: 'self_consumable',   classification: 'consumable' },
  [squash('Professional Services')]: { serviceType: 'other_operational', classification: 'professional' },
  [squash('Utility Services')]:      { serviceType: 'other_operational', classification: 'utility' },
  [squash('Facility Services')]:     { serviceType: 'other_operational', classification: 'facility' },
  [squash('Maintenance Services')]:  { serviceType: 'other_operational', classification: 'maintenance' },
  [squash('Outsourcing Services')]:  { serviceType: 'other_operational', classification: 'outsourcing' },
};

/** The service bucket a Supplier Type name serves, or null (Material/ Goods, FFD/ Transporter, none). */
export const serviceBucketOf = (typeName: string | null | undefined): ServiceBucket | null =>
  BUCKET_BY_TYPE[squash(typeName ?? '')] ?? null;
