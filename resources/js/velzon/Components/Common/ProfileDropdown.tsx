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

  const roleLabel = user.user_type.replace('_', ' ');

  const handleLogout = () => {
    toast.info('Logged Out', 'You have been signed out');
    logout();
  };

  return (
    <React.Fragment>
      <Dropdown isOpen={isProfileDropdown} toggle={toggleProfileDropdown} className="ms-sm-3 header-item topbar-user">
        <DropdownToggle tag="button" type="button" className="btn">
          <span className="d-flex align-items-center">
            <img className="rounded-circle header-profile-user" src={avatar1} alt="Header Avatar" />
            <span className="text-start ms-xl-2">
              <span className="d-none d-xl-inline-block ms-1 fw-medium user-name-text">{user.name}</span>
              <span className="d-none d-xl-block ms-1 fs-12 text-muted user-name-sub-text text-capitalize">{roleLabel}</span>
            </span>
          </span>
        </DropdownToggle>
        <DropdownMenu className="dropdown-menu-end">
          <h6 className="dropdown-header">Welcome {user.name}!</h6>
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
