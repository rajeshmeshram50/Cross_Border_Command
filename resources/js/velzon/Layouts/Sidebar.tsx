import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import SimpleBar from "simplebar-react";
//import logo
import logoSm from "../assets/images/chotu-logo.png";
// Single bundled fallback for the expanded-sidebar brand — used when the
// tenant hasn't uploaded a logo. Previously we shipped two different
// images (logo-dark.png = velzon mark, igc-logo.png = IGC mark) and
// rendered them in the .logo-dark vs .logo-light slots, which made the
// sidebar logo silently change every time the user flipped Sidebar Color
// between Light / Dark / Gradient. One file = one brand on every theme.
import brandFallback from "../assets/images/igc-logo.png";

//Import Components
import VerticalLayout from "./VerticalLayouts";
import TwoColumnLayout from "./TwoColumnLayout";
import { Container } from "reactstrap";
import HorizontalLayout from "./HorizontalLayout";
import { useAuth } from "../../contexts/AuthContext";
import { resolveFileUrl } from "../../utils/resolveFileUrl";

const Sidebar = ({ layoutType } : any) => {
  // Logo fallback chain — branch logo wins for branch users, then client logo
  // (used by client_admin and as fallback for branch_user without their own
  // logo), then the system IGC default for super admin or any client without
  // an uploaded logo. The backend returns `/storage/...` relative paths;
  // resolveFileUrl prefixes the API origin so the <img> can actually load.
  const { user } = useAuth();
  const rawTenantLogo = user?.branch_logo || user?.client_logo || null;
  const tenantLogo = rawTenantLogo ? resolveFileUrl(rawTenantLogo) : null;
  const smallLogo = tenantLogo || logoSm;
  // Both sidebar-color variants now resolve to the SAME image so the
  // brand stays consistent whether the sidebar is Light, Dark, or
  // Gradient. When the tenant has uploaded a logo it wins on both;
  // otherwise the single bundled fallback shows on both.
  const largeLogoDark = tenantLogo || brandFallback;
  const largeLogoLight = tenantLogo || brandFallback;

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
          {/* Two link blocks — Velzon shows .logo-dark on light sidebars
              and .logo-light on dark / gradient sidebars. Heights MUST
              match between the pair so the brand renders at the same
              visual size regardless of sidebar color (the previous
              30/35 vs 55/53 split made the same tenant logo look like a
              completely different image when you flipped the colour). */}
          <Link to="/" className="logo logo-dark">
            <span className="logo-sm">
              <img src={smallLogo} alt="" style={{ height: '50px', maxWidth: '100%', width: 'auto', objectFit: 'contain' }} />
            </span>
            <span className="logo-lg">
              <img src={largeLogoDark} alt="" style={{ height: '50px', maxWidth: '100%', width: 'auto', objectFit: 'contain' }} />
            </span>
          </Link>

          <Link to="/" className="logo logo-light">
            <span className="logo-sm">
              <img src={smallLogo} alt="" style={{ height: '50px', maxWidth: '100%', width: 'auto', objectFit: 'contain' }} />
            </span>
            <span className="logo-lg">
              <img src={largeLogoLight} alt="" style={{ height: '50px', maxWidth: '100%', width: 'auto', objectFit: 'contain' }} />
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
