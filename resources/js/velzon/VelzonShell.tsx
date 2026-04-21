import { type ReactNode } from "react";
import "./i18n"; // init i18next (pass-through for now)
import Layout from "./Layouts";

/**
 * VelzonShell — wraps post-login pages with Velzon's actual Layout
 * (Header + Sidebar + RightSidebar customizer + Footer).
 *
 * Login / Forgot / OTP / Reset do NOT use this shell — they stay Tailwind.
 */
export default function VelzonShell({ children }: { children: ReactNode }) {
  return (
    <Layout>
      <div className="page-content">
        <div className="container-fluid">{children}</div>
      </div>
    </Layout>
  );
}
