import { useNavigateContext } from './App';

/**
 * Full-screen "Access Denied" block shown by the global route guard when a user
 * navigates (typically by pasting a URL) to a page their permissions don't
 * cover. Renders inside the VelzonShell content area so the header/sidebar stay
 * available and the user can jump back to an allowed page.
 *
 * See utils/routeAccess.canAccessPath for the decision logic.
 */
export default function AccessDenied() {
  const { navigate } = useNavigateContext();

  return (
    <div
      className="d-flex align-items-center justify-content-center text-center"
      style={{ minHeight: 'calc(100vh - 180px)' }}
    >
      <div style={{ maxWidth: 520, padding: '0 16px' }}>
        <div
          className="mx-auto mb-4 d-flex align-items-center justify-content-center rounded-circle bg-danger-subtle text-danger"
          style={{ width: 104, height: 104 }}
        >
          <i className="ri-lock-2-line" style={{ fontSize: 48 }} />
        </div>
        <h2 className="fw-bold mb-2" style={{ fontSize: 26 }}>Access Denied</h2>
        <p className="text-muted mb-4" style={{ fontSize: 15 }}>
          You don&rsquo;t have permission to view this page. If you believe this is a
          mistake, please contact your administrator to request access.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => navigate('dashboard')}
        >
          <i className="ri-arrow-left-line me-1" />
          Back to Dashboard
        </button>
      </div>
    </div>
  );
}
