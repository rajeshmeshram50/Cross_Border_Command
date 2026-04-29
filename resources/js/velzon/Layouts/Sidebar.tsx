import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import SimpleBar from "simplebar-react";
//import logo
import logoSm from "../assets/images/chotu-logo.png";
import logoDark from "../assets/images/logo-dark.png";
import logoLight from "../assets/images/igc-logo.png";

//Import Components
import VerticalLayout from "./VerticalLayouts";
import TwoColumnLayout from "./TwoColumnLayout";
import { Container } from "reactstrap";
import HorizontalLayout from "./HorizontalLayout";
import { useAuth } from "../../contexts/AuthContext";

const Sidebar = ({ layoutType } : any) => {
  // Logo fallback chain — branch logo wins for branch users, then client logo
  // (used by client_admin and as fallback for branch_user without their own
  // logo), then the system IGC default for super admin or any client without
  // an uploaded logo.
  const { user } = useAuth();
  const tenantLogo = user?.branch_logo || user?.client_logo || null;
  const smallLogo = tenantLogo || logoSm;
  const largeLogoDark = tenantLogo || logoDark;
  const largeLogoLight = tenantLogo || logoLight;

  useEffect(() => {
    var verticalOverlay = document.getElementsByClassName("vertical-overlay");
    if (verticalOverlay) {
      verticalOverlay[0].addEventListener("click", function () {
        document.body.classList.remove("vertical-sidebar-enable");
      });
    }
  });

  const addEventListenerOnSmHoverMenu = () => {
    // add listener Sidebar Hover icon on change layout from setting
    if (document.documentElement.getAttribute('data-sidebar-size') === 'sm-hover') {
      document.documentElement.setAttribute('data-sidebar-size', 'sm-hover-active');
    } else if (document.documentElement.getAttribute('data-sidebar-size') === 'sm-hover-active') {
      document.documentElement.setAttribute('data-sidebar-size', 'sm-hover');
    } else {
      document.documentElement.setAttribute('data-sidebar-size', 'sm-hover');
    }
  };

  return (
    <React.Fragment>
      <div className="app-menu navbar-menu">
        <div className="navbar-brand-box">
          <Link to="/" className="logo logo-dark">
            <span className="logo-sm mb-2">
              <img src={smallLogo} alt="" style={{ height: '35px', width: 'auto', objectFit: 'contain' }} />
            </span>
            <span className="logo-lg">
              <img src={largeLogoDark} alt="" style={{ height: '30px', width: 'auto', objectFit: 'contain' }} />
            </span>
          </Link>

          <Link to="/" className="logo logo-light">
            <span className="logo-sm ">
              <img src={smallLogo} alt="" style={{ height: '53px', width: 'auto', objectFit: 'contain' }} />
            </span>
            <span className="logo-lg">
              <img src={largeLogoLight} alt="" style={{ height: '55px', width: 'auto', objectFit: 'contain' }} />
            </span>
          </Link>
          <button
            onClick={addEventListenerOnSmHoverMenu}
            type="button"
            className="btn btn-sm p-0 fs-20 header-item float-end btn-vertical-sm-hover"
            id="vertical-hover"
          >
            <i className="ri-record-circle-line"></i>
          </button>
        </div>
        {layoutType === "horizontal" ? (
          <div id="scrollbar">
            <Container fluid>
              <div id="two-column-menu"></div>
              <ul className="navbar-nav" id="navbar-nav">
                <HorizontalLayout />
              </ul>
            </Container>
          </div>
        ) : layoutType === 'twocolumn' ? (
          <React.Fragment>
            <TwoColumnLayout layoutType={layoutType} />
            <div className="sidebar-background"></div>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <SimpleBar id="scrollbar" className="h-100">
              <Container fluid>
                <div id="two-column-menu"></div>
                <ul className="navbar-nav" id="navbar-nav">
                  <VerticalLayout layoutType={layoutType} />
                </ul>
              </Container>
            </SimpleBar>
            <div className="sidebar-background"></div>
          </React.Fragment>
        )}
      </div>
      <div className="vertical-overlay"></div>
    </React.Fragment>
  );
};

export default Sidebar;
