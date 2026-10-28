import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Col, Row } from 'reactstrap';
import RegularizationApprovals from './RegularizationApprovals';
import '../../../css/recruitment.css';

/**
 * Regularization Requests, on a page of its own.
 *
 * It used to hang off the bottom of HR Attendance, below the day's timeline and
 * the Logs & Requests card — three stacked tables on one screen, and the
 * approval queue was the one you had to scroll past everything else to reach.
 * Attendance now links here instead.
 *
 * The table itself is unchanged: RegularizationApprovals already renders its
 * own .att-logs-card with the teal header strip, and none of that styling is
 * scoped to the attendance page, so it arrives here looking exactly as it did.
 * This file is the page chrome around it and nothing more.
 */
export default function HrRegularizationRequests() {
  /* The component refetches when this changes. Nothing on this page writes
     attendance, so it only ever moves when the list asks it to — kept so the
     prop contract matches the embedded use and the two cannot drift. */
  const [version, setVersion] = useState(0);
  const navigate = useNavigate();

  return (
    <div className="rec-page att-page reg-page">
      <Row>
        <Col xs={12}>
          <div className="frm-cstrip hr-cstrip hr-cstrip--teal mb-3">
            <span className="frm-cstrip-accent" />
            <div className="frm-cstrip-left">
              <div className="frm-cstrip-icon"><i className="ri-file-edit-line" /></div>
              <div className="min-w-0">
                <div className="frm-cstrip-title">Regularization Requests</div>
                <div className="frm-cstrip-sub">
                  Approve or reject attendance correction requests
                </div>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2 flex-wrap flex-shrink-0">
              <button
                type="button"
                className="frm-cstrip-back flex-shrink-0"
                onClick={() => navigate('/hr/attendance')}
              >
                <i className="ri-arrow-left-line" />
                Back to Attendance
              </button>
            </div>
          </div>

          <RegularizationApprovals
            refreshKey={version}
            onActed={() => setVersion(v => v + 1)}
          />
        </Col>
      </Row>
    </div>
  );
}
