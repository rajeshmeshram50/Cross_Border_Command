import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Dropdown, DropdownItem, DropdownMenu, DropdownToggle } from 'reactstrap';

// Use CBC's AuthContext instead of Velzon's Profile slice (which we stripped)
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { resolveFileUrl } from '../../../utils/resolveFileUrl';
import avatar1 from "../../assets/images/users/image.png";

const ProfileDropdown = () => {
  const { user, logout } = useAuth();
  const toast = useToast();

  const [isProfileDropdown, setIsProfileDropdown] = useState(false);
  const toggleProfileDropdown = () => setIsProfileDropdown(!isProfileDropdown);

  if (!user) return null;

  // Profile photo priority: employee passport photo (most personal) >
  // tenant row (branch > client) > user-row photo (super_admin / employees
  // who self-uploaded) > bundled generic avatar. Backend returns
  // `/storage/...` relative paths — resolveFileUrl prefixes the API origin
  // so the <img> can actually load.
  const rawProfilePhoto = user.employee_profile_photo
    || user.branch_profile_photo
    || user.client_profile_photo
    || user.user_profile_photo
    || null;
  const profilePhoto = rawProfilePhoto ? resolveFileUrl(rawProfilePhoto) : avatar1;

  const roleLabel = user.user_type.replace(/_/g, ' ');

  const handleLogout = () => {
    toast.info('Logged Out', 'You have been signed out');
    logout();
  };

  // My Team — every user that manages people (computed server-side in /me).
  const canSeeMyTeam = !!user.is_reporting_manager;
  // Platform Settings (branding, support email, privacy) is admin-only.
  const canSeeSettings = user.user_type !== 'employee';
  // Branch / company line shown in the dropdown header (mirrors horizontal).
  const branchName = user.branch_name || user.client_name || '';

  // Menu mirrors the horizontal header's profile dropdown: Profile, My Team,
  // Settings, Logout. Inbox / Gmail now live as top-bar icons, not here.
  const menuItems: { to: string; icon: string; label: string; grad: string }[] = [
    { to: '/profile',  icon: 'ri-user-3-line',     label: 'Profile',  grad: 'linear-gradient(135deg,#A78BFA,#7C3AED)' },
    ...(canSeeMyTeam
      ? [{ to: '/my-team',  icon: 'ri-team-line',      label: 'My Team',  grad: 'linear-gradient(135deg,#34D399,#059669)' }]
      : []),
    ...(canSeeSettings
      ? [{ to: '/settings', icon: 'ri-settings-3-line', label: 'Settings', grad: 'linear-gradient(135deg,#94A3B8,#64748B)' }]
      : []),
  ];

  return (
    <React.Fragment>
      <style>{`
        .cbc-profile-menu.dropdown-menu,
        div.cbc-profile-menu.dropdown-menu {
          min-width: 290px !important;
          max-width: 290px !important;
          padding: 0 !important;
          border: 1px solid var(--vz-border-color) !important;
          border-radius: 14px !important;
          overflow: hidden;
          margin-top: 6px !important;
          background-color: #ffffff !important;
          background-image: none !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
          opacity: 1 !important;
          filter: none !important;
          box-shadow: 0 14px 32px rgba(18,38,63,0.16), 0 2px 8px rgba(18,38,63,0.08) !important;
          z-index: 2000 !important;
        }
        html[data-bs-theme="dark"] .cbc-profile-menu.dropdown-menu,
        html[data-layout-mode="dark"] .cbc-profile-menu.dropdown-menu,
        [data-bs-theme="dark"] div.cbc-profile-menu.dropdown-menu,
        [data-layout-mode="dark"] div.cbc-profile-menu.dropdown-menu {
          background-color: #2a2f34 !important;
          border-color: rgba(255,255,255,0.08) !important;
        }
        .cbc-profile-menu .dropdown-item {
          padding: 0 !important;
          background: transparent !important;
          color: inherit !important;
          border-radius: 10px !important;
        }
        .cbc-profile-menu .dropdown-item:hover,
        .cbc-profile-menu .dropdown-item:focus,
        .cbc-profile-menu .dropdown-item:active {
          background: transparent !important;
          color: inherit !important;
        }
        .cbc-profile-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 9px 10px;
          border-radius: 12px;
          color: var(--vz-body-color);
          text-decoration: none;
          transition: background .18s ease, transform .18s ease;
        }
        .cbc-profile-menu .dropdown-item:hover .cbc-profile-row,
        .cbc-profile-menu .dropdown-item:focus .cbc-profile-row {
          background: var(--vz-secondary-bg);
          color: var(--vz-heading-color, var(--vz-body-color));
          transform: translateX(2px);
        }
        .cbc-profile-menu .dropdown-item:hover .cbc-profile-row .cbc-profile-chev,
        .cbc-profile-menu .dropdown-item:focus .cbc-profile-row .cbc-profile-chev {
          transform: translateX(2px);
          color: #6366f1;
        }
        .cbc-profile-menu .dropdown-item:hover .cbc-profile-row.logout .cbc-profile-chev,
        .cbc-profile-menu .dropdown-item:focus .cbc-profile-row.logout .cbc-profile-chev {
          color: #f06548;
        }
        .cbc-profile-chev {
          color: var(--vz-secondary-color);
          font-size: 14px;
          transition: transform .18s ease, color .18s ease;
        }
        /* Dark-mode legibility for the topbar profile chip. The name
           gradient (navy → teal) and the role sub-label both rendered
           too dim against the dark header in dark mode, so the user
           had to squint to read "ABC / Branch User". Brighten both:
           - Name gradient swapped for a lighter violet → mint pair
             that pops against the dark topbar.
           - Role text bumped from var(--vz-secondary-color) (a low
             contrast grey) to a translucent slate that reads clearly. */
        [data-bs-theme="dark"] .cbc-profile-chip .user-name-text {
          background-image: linear-gradient(135deg, #a5b4fc, #34d399) !important;
          -webkit-background-clip: text !important;
          background-clip: text !important;
          -webkit-text-fill-color: transparent !important;
        }
        [data-bs-theme="dark"] .cbc-profile-chip .user-name-sub-text {
          color: rgba(226,232,240,0.78) !important;
        }
      `}</style>
      <Dropdown
        isOpen={isProfileDropdown}
        toggle={toggleProfileDropdown}
        className="header-item cbc-profile-chip"
        style={{ background: 'transparent' }}
      >
        <DropdownToggle
          tag="button"
          type="button"
          caret={false}
          className="btn p-0 border-0 shadow-none"
          style={{ background: 'transparent' }}
        >
          <span className="d-flex align-items-center">
            {/* Gradient-ringed avatar with an "online" dot */}
            <span
              className="position-relative d-inline-flex rounded-circle flex-shrink-0"
              style={{
                padding: 2,
                backgroundImage: 'linear-gradient(135deg,#94A3B8,#8B5CF6 55%,#7C3AED)',
              }}
            >
              <span className="rounded-circle d-inline-flex" style={{ padding: 1, background: 'var(--vz-card-bg, #fff)' }}>
                <img
                  className="rounded-circle header-profile-user"
                  src={profilePhoto}
                  alt="Header Avatar"
                  style={{ display: 'block', objectFit: 'cover', width: 36, height: 36 }}
                />
              </span>
              <span
                className="position-absolute rounded-circle"
                style={{
                  width: 10,
                  height: 10,
                  right: 2,
                  bottom: 2,
                  background: 'radial-gradient(circle at 35% 30%,#4ADE80,#16A34A)',
                  border: '2.5px solid var(--vz-card-bg, #fff)',
                }}
              />
            </span>

            {/* Name, role, and dropdown chevron hidden to match the horizontal
                header, which shows the avatar only. */}
          </span>
        </DropdownToggle>

        <DropdownMenu className="dropdown-menu-end cbc-profile-menu">
          {/* Header — purple gradient + avatar + name + role badge + branch
              line, mirroring the horizontal header's profile dropdown. */}
          <div
            className="d-flex align-items-center gap-2"
            style={{
              padding: '18px 18px 16px 18px',
              backgroundImage: 'linear-gradient(135deg, #1E1B4B 0%, #4338CA 55%, #6D28D9 100%)',
            }}
          >
            <span className="position-relative d-inline-flex flex-shrink-0">
              <img
                src={profilePhoto}
                alt=""
                className="rounded-circle"
                style={{ width: 48, height: 48, display: 'block', objectFit: 'cover', border: '2.5px solid rgba(255,255,255,0.7)' }}
              />
              <span
                className="position-absolute rounded-circle"
                style={{ width: 11, height: 11, right: 1, bottom: 1, background: 'radial-gradient(circle at 35% 30%,#4ADE80,#16A34A)', border: '2.5px solid #312E81' }}
              />
            </span>
            <div className="flex-grow-1 min-w-0">
              <div
                className="fw-bold text-white text-truncate"
                style={{ fontSize: 15, lineHeight: 1.2, marginBottom: 6 }}
                title={user.name}
              >
                {user.name}
              </div>
              <div
                className="d-inline-flex align-items-center gap-1 rounded-pill fw-semibold text-capitalize"
                style={{
                  fontSize: 10,
                  padding: '3px 9px 3px 7px',
                  color: '#E9D5FF',
                  background: 'rgba(255,255,255,0.16)',
                  border: '1px solid rgba(255,255,255,0.25)',
                }}
              >
                <i className="ri-shield-keyhole-line" style={{ fontSize: 11 }}></i>
                {roleLabel}
              </div>
              {branchName && (
                <div
                  className="d-flex align-items-center gap-1 mt-2"
                  style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', maxWidth: 165 }}
                >
                  <i className="ri-building-line" style={{ fontSize: 12, flexShrink: 0, opacity: 0.85 }}></i>
                  <span className="text-truncate">{branchName}</span>
                </div>
              )}
            </div>
          </div>

          {/* Menu items */}
          <div style={{ padding: 8 }}>
            {menuItems.map(item => (
              <DropdownItem key={item.to} tag="div">
                <Link to={item.to} className="cbc-profile-row">
                  <span
                    className="d-inline-flex align-items-center justify-content-center flex-shrink-0"
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      background: item.grad,
                      boxShadow: '0 2px 6px rgba(15,23,42,0.18)',
                    }}
                  >
                    <i className={item.icon} style={{ color: '#fff', fontSize: 15 }}></i>
                  </span>
                  <span className="fw-semibold flex-grow-1" style={{ fontSize: 13.5 }}>{item.label}</span>
                  <i className="ri-arrow-right-s-line cbc-profile-chev" />
                </Link>
              </DropdownItem>
            ))}

            <div
              style={{
                height: 1,
                background: 'var(--vz-border-color)',
                margin: '6px 8px',
              }}
            />

            <DropdownItem tag="div" onClick={handleLogout}>
              <div className="cbc-profile-row logout" style={{ cursor: 'pointer' }}>
                <span
                  className="d-inline-flex align-items-center justify-content-center flex-shrink-0"
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    background: 'linear-gradient(135deg,#FB7185,#E11D48)',
                    boxShadow: '0 2px 6px rgba(225,29,72,0.28)',
                  }}
                >
                  <i className="ri-logout-box-r-line" style={{ color: '#fff', fontSize: 15 }}></i>
                </span>
                <span
                  className="fw-semibold flex-grow-1"
                  style={{ fontSize: 13.5, color: '#E11D48' }}
                >
                  Logout
                </span>
                <i className="ri-arrow-right-s-line cbc-profile-chev" />
              </div>
            </DropdownItem>
          </div>
        </DropdownMenu>
      </Dropdown>
    </React.Fragment>
  );
};

export default ProfileDropdown;
