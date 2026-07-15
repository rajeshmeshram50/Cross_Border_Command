import { bustCustomerMasterBundle } from '../pages/sales/core-masters/customer/customerBundleCache';
import { bustProductMasterBundle } from '../pages/p2p/p2p-master-management/product-management/productBundleCache';
import { bustVendorMasterBundle } from '../pages/p2p/p2p-master-management/supplier-management/vendorBundleCache';
import { bustClientFormBundle } from '../pages/client/clientFormBundleCache';
import { bustBranchFormBundle } from '../pages/branch/branchFormBundleCache';

/**
 * Master rows (risk levels, segments, customer types, designations …) feed the
 * cached "*-bundle" dropdown payloads used by the Customer, Consignee, Product,
 * Vendor, Client and Branch forms. Those bundles live in sessionStorage with a
 * 5-minute TTL, so a master created/updated elsewhere wouldn't appear in those
 * dropdowns until the TTL expired (QA #23 — "newly added/updated Segment is not
 * reflected in dropdown without page refresh"). Clearing every bundle on any
 * master create/update/delete makes the change show on the next form open.
 *
 * Call this from ANY screen that mutates a master that a bundle exposes — not
 * just the generic MasterPage. Segments in particular are also edited from the
 * CLM Segment page, the CLM DCP page (its rules gate which segments the bundle
 * returns at all) and the inline quick-add in the Add Product modal.
 */
export function bustAllMasterBundles(): void {
  bustCustomerMasterBundle();
  bustProductMasterBundle();
  bustVendorMasterBundle();
  bustClientFormBundle();
  bustBranchFormBundle();
}
