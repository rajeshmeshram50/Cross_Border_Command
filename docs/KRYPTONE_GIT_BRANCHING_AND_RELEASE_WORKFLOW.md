# Kryptone Project

## Git Branching Strategy, Development Workflow & Production Release Management

| Field | Value |
|---|---|
| Document Version | 1.0 |
| Date | 23 November 2026 |
| Project | Kryptone |

---

## 1. Purpose

This document defines the Git branching structure, development process, QA validation, production deployment strategy, and bug management workflow followed for the Kryptone project.

The primary objective is to maintain a controlled development and release process that ensures:

- Developers can work independently without affecting production.
- All development changes are integrated into a common development branch.
- Modules are deployed to production only after development completion and QA confirmation.
- Production remains stable while development continues.
- Low-priority bugs can be scheduled for subsequent releases.
- Every production release is traceable and controlled.

---

## 2. Existing Git Branch Structure

The Kryptone repository currently maintains three primary branches.

| Branch | Purpose | Environment |
|---|---|---|
| `main` | Initial project baseline and repository default branch | No active deployment specified |
| `kryptone-dev` | Active development and integration | Development |
| `kryptone-production` | QA-approved, production-ready code | Production |

### 2.1 Main Branch

The `main` branch was created during the initial setup of the Kryptone project. It represents the original project codebase and remains the default branch in the Git repository.

Currently, active development and production deployment are managed through separate branches.

**Current usage:**

- Maintains the initial project baseline.
- Serves as the repository's default branch.
- Is not used for regular development integration.
- Is not the designated production deployment branch.

### 2.2 Kryptone Development Branch

**Branch:** `kryptone-dev`

This is the primary active development branch for the project. All developers work on their respective modules, features, bug fixes, and improvements using their local development branches. Once changes are completed and reviewed, they are integrated into `kryptone-dev`.

The development environment is connected to this branch.

**Responsibilities:**

- Integrate developer changes.
- Support ongoing module development.
- Provide code for internal testing.
- Resolve issues identified during development and QA.
- Maintain the latest integrated development version.

Changes pushed to this branch may be deployed to the development environment through the configured deployment process.

### 2.3 Kryptone Production Branch

**Branch:** `kryptone-production`

This branch maintains the approved code intended for the live production environment.

A module is eligible for production release only after:

1. Development is completed.
2. The module is functionally tested.
3. QA validates the implemented functionality.
4. Identified release-blocking bugs are resolved.
5. QA provides release confirmation.
6. The approved changes are integrated into `kryptone-production`.

The production branch should contain only reviewed and approved changes.

> **Important:** QA approval must apply to the exact release candidate being deployed.

---

## 3. Development and Deployment Workflow

### Step 1: Local Development

Developers create or use their own local working branches based on the appropriate development baseline.

Example:

```
feature/supplier-management
```

Developers implement features, APIs, database changes, bug fixes, and module improvements.

### Step 2: Integration Into Development Branch

After completing their assigned work:

1. Developers commit their changes.
2. Changes are pushed to the remote repository.
3. A pull request is raised against `kryptone-dev`.
4. Code is reviewed and approved.
5. Approved changes are merged into `kryptone-dev`.

### Step 3: Development Environment Testing

The development environment uses the `kryptone-dev` branch. The team verifies:

- Module functionality
- API integrations
- Database operations
- Validation and business rules
- Cross-module compatibility
- Existing feature regression

Any issues found during testing are resolved in development.

### Step 4: Module Freeze

Once a module is functionally complete, it enters the module-freeze stage. During this stage:

- Planned development for the release is completed.
- New features are not added to the frozen release scope.
- Only approved fixes are permitted.
- The module is submitted for final QA validation.

A module freeze does not automatically mean the entire development branch is frozen.

### Step 5: QA Validation and Approval

The QA team verifies the module against its approved requirements. QA must confirm:

- Functional testing is completed.
- Critical and high-priority defects are resolved.
- Relevant regression testing is completed.
- The module is stable.
- Any remaining low-priority defects are documented and accepted.

Once validation is successful, QA provides release approval.

### Step 6: Production Branch Integration

Following QA confirmation, the approved code is integrated from the development release candidate into `kryptone-production`.

> **Release control requirement:** Because other modules may still be under development in `kryptone-dev`, the team must **not** automatically merge the entire development branch into production.

Only the approved release scope should be promoted. The team should use an approved release branch, reviewed pull request, or controlled commit selection to ensure unfinished modules are excluded.

### Step 7: Production Deployment

After successful integration:

1. Production build and deployment checks are completed.
2. Database migrations are reviewed and applied where required.
3. Approved changes are deployed.
4. Smoke testing is performed.
5. The release is verified.
6. The release details are recorded.

---

## 4. Git Workflow Diagram

```
                  main
           Initial Project Branch
                    |
                    v
               kryptone-dev
             Development Branch
                    ^
                    |
          Developer Feature Branches
                    |
                    v
            Code Review & Merge
                    |
                    v
           Development Testing
                    |
                    v
               Module Freeze
                    |
                    v
             QA Verification
                    |
                    v
           QA Release Approval
                    |
                    v
        Approved Release Candidate
                    |
                    v
           kryptone-production
                    |
                    v
            Production Deployment
                    |
                    v
          Production Verification
```

The diagram represents the logical workflow. Actual Git operations must preserve the approved release scope.

---

## 5. Production Bug Management Policy

After a module is deployed to production, issues may be identified through monitoring, internal testing, or user feedback. Each issue must be evaluated based on its severity, business impact, and release risk.

| Priority | Description | Release Decision |
|---|---|---|
| Critical (P0) | System outage, serious security issue, or major data integrity risk | Immediate escalation and emergency response |
| High (P1) | Major functionality failure affecting business operations | Fix before release or prioritize an urgent patch |
| Medium (P2) | Significant issue with an acceptable temporary workaround | Fix according to agreed release priority |
| Low (P3) | Minor issue with limited impact | May be deferred to a subsequent release |

### Low-Priority Production Bug Handling

If a low-priority issue is identified in `kryptone-production`, the team may continue operating the current production version provided that:

- The issue does not significantly affect business operations.
- There is no material security or data integrity risk.
- The issue is recorded in the bug tracker.
- QA and the responsible release owner accept the known issue.
- The issue is assigned to a future development or release cycle.
- The fix can be developed and tested in `kryptone-dev`.

When another module is completed, frozen, and approved for production, the pending low-priority fix may be included in that release.

> A low-priority bug does not automatically block production deployment, but its deferral must be documented and approved.

---

## 6. Release Approval Checklist

Before merging approved code into `kryptone-production`, the following conditions must be verified:

- [ ] Module development completed
- [ ] Code review approved
- [ ] Development testing completed
- [ ] Module freeze confirmed
- [ ] QA functional testing passed
- [ ] Regression testing completed
- [ ] Critical and high-priority bugs resolved
- [ ] Remaining low-priority bugs reviewed and accepted
- [ ] QA release approval received
- [ ] Exact release scope identified
- [ ] Database and configuration changes verified
- [ ] Rollback procedure prepared
- [ ] Production deployment authorized

---

## 7. Team Responsibilities

| Role | Responsibility |
|---|---|
| Developer | Implement features, maintain local branches, resolve bugs, submit pull requests |
| Development Lead | Review code, manage integration, confirm technical readiness |
| QA Team | Validate modules, report defects, approve release candidates |
| DevOps / Deployment Owner | Manage environments, execute releases, monitor deployment |
| Project / Release Manager | Confirm release scope, accept known risks, authorize production release |

---

## 8. Recommended Git Branch Protection Rules

To improve repository stability and reduce accidental deployments, the following controls are recommended.

**For `kryptone-dev`:**

- Require pull requests for shared development changes.
- Require code review.
- Run automated build and test checks.
- Restrict force pushes.

**For `kryptone-production`:**

- Restrict direct commits.
- Require approved pull requests.
- Require successful build and deployment validation.
- Maintain release tags and deployment records.
- Restrict branch deletion and force pushes.
- Require approval from authorized release owners.

**For `main`:**

- Preserve the existing initial baseline.
- Restrict accidental changes.
- Review whether it should remain the default branch, without changing its current role automatically.

---

## 9. Release Version and Deployment Records

Each production release should maintain a release record.

| Field | Example |
|---|---|
| Release ID | KRY-REL-001 |
| Source | Approved development release candidate |
| Target | `kryptone-production` |
| Module | Supplier Management |
| QA Status | Approved |
| Known Issues | Documented low-priority bugs |
| Deployment Status | Pending / Completed |
| Release Date | To be recorded |
| Approved By | QA and release owner |

A release tag should identify the exact deployed commit so the team can trace, compare, or restore a previous release.

---

## 10. Final Branch Management Policy

The Kryptone project follows a **development-first, QA-controlled production release strategy**.

- The `main` branch represents the initial project baseline.
- The `kryptone-dev` branch remains the active integration branch for ongoing development, feature implementation, bug fixing, and development environment testing.
- The `kryptone-production` branch contains code approved for production deployment.
- No unfinished or unapproved module should be promoted to production.

When a module is fully developed, frozen, tested, and approved by QA, its approved release changes are promoted to the production branch.

If a low-priority issue is discovered in production, the existing release may remain live when the risk is formally accepted. The fix may then be included in a subsequent approved release alongside another completed module.

This process allows development to continue while maintaining production stability, quality control, accountability, and traceability.
