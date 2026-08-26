import { NavLink } from 'react-router-dom';

/* Sub-navigation shared by the three Inventory scan screens. */
export default function InventoryTabs() {
  const cls = ({ isActive }: { isActive: boolean }) => `inv-tab${isActive ? ' active' : ''}`;
  return (
    <nav className="inv-tabs" aria-label="Inventory sections">
      <NavLink to="/inventory" end className={cls}>
        <i className="ri-qr-scan-2-line" /> Put-Away Scan
      </NavLink>
      <NavLink to="/inventory/stickers" className={cls}>
        <i className="ri-price-tag-3-line" /> Sticker Sheet
      </NavLink>
      <NavLink to="/inventory/devices" className={cls}>
        <i className="ri-tablet-line" /> Scan Devices
      </NavLink>
      <NavLink to="/inventory/scan-log" className={cls}>
        <i className="ri-file-list-3-line" /> Scan Log
      </NavLink>
    </nav>
  );
}
