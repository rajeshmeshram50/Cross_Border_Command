import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Dropdown, DropdownItem, DropdownMenu, DropdownToggle } from 'reactstrap';

// Use CBC's AuthContext instead of Velzon's Profile slice (which we stripped)
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import avatar1 from "../../assets/images/users/avatar-1.jpg";

const ProfileDropdown = () => {
  const { user, logout } = useAuth();
  const toast = useToast();

  const [isProfileDropdown, setIsProfileDropdown] = useState(false);
  const toggleProfileDropdown = () => setIsProfileDropdown(!isProfileDropdown);

  if (!user) return null;

  const roleLabel = user.user_type.replace(/_/g, ' ');
  // Super admin's display name often equals the role ("Super Admin") — hide the
  // duplicate role sub-line on the chip when they match (still shown inside the menu header).
  const nameMatchesRole = user.name.trim().toLowerCase() === roleLabel.toLowerCase();

  const handleLogout = () => {
    toast.info('Logged Out', 'You have been signed out');
    logout();
  };

  const menuItems: { to: string; icon: string; label: string; grad: string }[] = [
    { to: '/profile',  icon: 'ri-user-3-line',     label: 'Profile',  grad: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' },
    { to: '/my-plan',  icon: 'ri-bank-card-line',  label: 'My Plan',  grad: 'linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)' },
    { to: '/settings', icon: 'ri-settings-3-line', label: 'Settings', grad: 'linear-gradient(135deg, #f59e0b 0%, #f7b84b 100%)' },
  ];

  return (
    <React.Fragment>
      <style>{`
        .cbc-profile-menu.dropdown-menu,
        div.cbc-profile-menu.dropdown-menu {
          min-width: 232px !important;
          max-width: 232px !important;
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
          gap: 9px;
          padding: 7px 8px;
          border-radius: 9px;
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
      `}</style>
      <Dropdown
        isOpen={isProfileDropdown}
        toggle={toggleProfileDropdown}
        className="ms-sm-3 header-item cbc-profile-chip"
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
                backgroundImage: 'linear-gradient(135deg,#405189,#0ab39c)',
              }}
            >
              <span className="rounded-circle d-inline-flex" style={{ padding: 1.5, background: 'var(--vz-card-bg, #fff)' }}>
                <img
                  className="rounded-circle header-profile-user"
                  src={avatar1}
                  alt="Header Avatar"
                  style={{ display: 'block' }}
                />
              </span>
              <span
                className="position-absolute rounded-circle"
                style={{
                  width: 9,
                  height: 9,
                  right: 1,
                  bottom: 1,
                  background: '#10b981',
                  boxShadow: '0 0 0 1.5px var(--vz-card-bg, #fff)',
                }}
              />
            </span>

            <span className="text-start ms-xl-2">
              <span
                className="d-none d-xl-inline-block ms-1 fw-bold user-name-text"
                style={{
                  backgroundImage: 'linear-gradient(135deg,#405189,#0ab39c)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  fontSize: 13,
                  lineHeight: 1.15,
                }}
              >
                {user.name}
              </span>
              {!nameMatchesRole && (
                <span
                  className="d-none d-xl-block ms-1 fs-12 user-name-sub-text text-capitalize"
                  style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.03em', fontSize: 11, lineHeight: 1.25, marginTop: 1 }}
                >
                  {roleLabel}
                </span>
              )}
            </span>

            {/* Teal dropdown chevron — rotates 180° when the menu is open */}
            <svg
              className="ms-2 flex-shrink-0"
              width={12}
              height={12}
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              style={{
                color: '#0ab39c',
                transform: isProfileDropdown ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform .2s ease',
              }}
            >
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </DropdownToggle>

        <DropdownMenu className="dropdown-menu-end cbc-profile-menu">
          {/* Gradient header — avatar, name, role pill */}
          <div
            className="position-relative overflow-hidden"
            style={{
              padding: '14px 14px 12px 14px',
              backgroundImage: 'linear-gradient(135deg, rgb(64, 81, 137), rgb(10, 179, 156))',
            }}
          >
            <div
              className="position-absolute top-0 start-0 w-100 h-100"
              style={{
                backgroundImage:
                  'radial-gradient(circle at 85% 15%, rgba(255,255,255,0.28), transparent 55%),' +
                  'radial-gradient(circle at 10% 100%, rgba(255,255,255,0.12), transparent 50%)',
                pointerEvents: 'none',
              }}
            />
            <div className="position-relative d-flex align-items-center gap-2">
              <span
                className="d-inline-flex rounded-circle flex-shrink-0"
                style={{
                  padding: 2,
                  background: 'rgba(255,255,255,0.35)',
                  boxShadow: '0 5px 14px rgba(0,0,0,0.18)',
                }}
              >
                <img
                  src={avatar1}
                  alt=""
                  className="rounded-circle"
                  style={{ width: 38, height: 38, display: 'block' }}
                />
              </span>
              <div className="flex-grow-1 min-w-0">
                <div
                  className="fw-bold text-white text-truncate"
                  style={{ fontSize: 13, lineHeight: 1.2 }}
                  title={user.name}
                >
                  {user.name}
                </div>
                <div
                  className="d-inline-flex align-items-center gap-1 mt-1 px-2 py-0 rounded-pill fw-semibold text-capitalize"
                  style={{
                    fontSize: 9.5,
                    letterSpacing: '0.07em',
                    textTransform: 'uppercase',
                    color: '#fff',
                    background: 'rgba(255,255,255,0.22)',
                    border: '1px solid rgba(255,255,255,0.28)',
                    backdropFilter: 'blur(6px)',
                  }}
                >
                  <i className="ri-shield-keyhole-line" style={{ fontSize: 10 }}></i>
                  {roleLabel}
                </div>
              </div>
            </div>
          </div>

          {/* Menu items */}
          <div style={{ padding: 6 }}>
            {menuItems.map(item => (
              <DropdownItem key={item.to} tag="div">
                <Link to={item.to} className="cbc-profile-row">
                  <span
                    className="d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0"
                    style={{
                      width: 28,
                      height: 28,
                      background: item.grad,
                      boxShadow: '0 3px 8px rgba(18,38,63,0.12)',
                    }}
                  >
                    <i className={item.icon} style={{ color: '#fff', fontSize: 14 }}></i>
                  </span>
                  <span className="fw-semibold flex-grow-1" style={{ fontSize: 12.5 }}>{item.label}</span>
                  <i className="ri-arrow-right-s-line cbc-profile-chev" />
                </Link>
              </DropdownItem>
            ))}

            <div
              style={{
                height: 1,
                background: 'var(--vz-border-color)',
                margin: '4px 2px',
              }}
            />

            <DropdownItem tag="div" onClick={handleLogout}>
              <div className="cbc-profile-row logout" style={{ cursor: 'pointer' }}>
                <span
                  className="d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0"
                  style={{
                    width: 28,
                    height: 28,
                    background: 'linear-gradient(135deg, #f06548 0%, #ff9e7c 100%)',
                    boxShadow: '0 3px 8px rgba(240,101,72,0.28)',
                  }}
                >
                  <i className="ri-logout-box-r-line" style={{ color: '#fff', fontSize: 14 }}></i>
                </span>
                <span
                  className="fw-semibold flex-grow-1"
                  style={{ fontSize: 12.5, color: '#f06548' }}
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
