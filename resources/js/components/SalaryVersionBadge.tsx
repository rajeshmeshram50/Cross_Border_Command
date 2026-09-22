// Active salary structure version (v1 = first salary; each Revise Salary adds one).
export function SalaryVersionBadge({ version, from }: { version: number; from?: string | null }) {
  const since = from
    ? new Date(`${from}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;
  return (
    <span className="salary-version-badge" title={since ? `Salary version ${version}, effective ${since}` : `Salary version ${version}`}>
      <i className="ri-history-line" />
      {version > 1 ? `Revision v${version}` : 'v1'}
      {since && <span className="salary-version-badge-date">· {since}</span>}
    </span>
  );
}
