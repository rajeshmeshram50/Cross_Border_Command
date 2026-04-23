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

  return (
    <React.Fragment>
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
        <DropdownMenu className="dropdown-menu-end">
          <div
            className="px-3 py-3 mb-1 text-white position-relative overflow-hidden"
            style={{ backgroundImage: 'linear-gradient(135deg,#405189 0%,#6691e7 50%,#0ab39c 100%)' }}
          >
            <div
              className="position-absolute"
              style={{
                inset: 0,
                opacity: 0.2,
                backgroundImage: 'radial-gradient(circle at 80% 20%, rgba(255,255,255,0.5), transparent 50%)',
                pointerEvents: 'none',
              }}
            />
            <div className="position-relative d-flex align-items-center gap-2">
              <span className="d-inline-flex rounded-circle" style={{ padding: 2, background: 'rgba(255,255,255,0.3)' }}>
                <img src={avatar1} alt="" className="rounded-circle" style={{ width: 32, height: 32, display: 'block' }} />
              </span>
              <div className="flex-grow-1 min-w-0">
                <div className="fw-bold text-white text-truncate" style={{ fontSize: 13, lineHeight: 1.2 }}>{user.name}</div>
                <div className="text-white-50 text-uppercase fw-semibold text-capitalize" style={{ fontSize: 10.5, letterSpacing: '0.05em', lineHeight: 1.2, marginTop: 2 }}>{roleLabel}</div>
              </div>
            </div>
          </div>
          <DropdownItem className='p-0'>
            <Link to="/profile" className="dropdown-item">
              <i className="mdi mdi-account-circle text-muted fs-16 align-middle me-1"></i>
              <span className="align-middle">Profile</span>
            </Link>
          </DropdownItem>
          <DropdownItem className='p-0'>
            <Link to="/my-plan" className="dropdown-item">
              <i className="mdi mdi-wallet text-muted fs-16 align-middle me-1"></i>
              <span className="align-middle">My Plan</span>
            </Link>
          </DropdownItem>
          <DropdownItem className='p-0'>
            <Link to="/settings" className="dropdown-item">
              <i className="mdi mdi-cog-outline text-muted fs-16 align-middle me-1"></i>
              <span className="align-middle">Settings</span>
            </Link>
          </DropdownItem>
          <div className="dropdown-divider"></div>
          <DropdownItem onClick={handleLogout}>
            <i className="mdi mdi-logout text-muted fs-16 align-middle me-1"></i>
            <span className="align-middle">Logout</span>
          </DropdownItem>
        </DropdownMenu>
      </Dropdown>
    </React.Fragment>
  );
};

export default ProfileDropdown;
