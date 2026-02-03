import { fetchDashboardData, ResourceStatus, DashboardData } from '@/lib/api';

// Revalidate every 60 seconds
export const revalidate = 60;

function formatDate(dateString: string | undefined): string {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'Invalid date';
  }
}

function formatNumber(num: number | null): string {
  if (num === null) return 'N/A';
  return num.toLocaleString();
}

function ResourceCard({ resource }: { resource: ResourceStatus }) {
  return (
    <div className={`resource-card ${resource.status === 'error' ? 'error' : ''}`}>
      <div className="resource-header">
        <div>
          <h3 className="resource-title">{resource.name}</h3>
          <p className="resource-description">{resource.description}</p>
          <code className="resource-endpoint">{resource.endpoint}</code>
        </div>
        <span className={`status-badge ${resource.status}`}>
          <span className="status-dot"></span>
          {resource.status}
        </span>
      </div>

      {resource.status === 'error' && resource.errorMessage && (
        <div className="error-message">
          {resource.errorMessage}
        </div>
      )}

      {resource.status !== 'error' && (
        <>
          <div className="stats-grid">
            <div className="stat-item">
              <div className="stat-label">Total Records</div>
              <div className={`stat-value ${resource.totalRecords === null ? 'na' : ''}`}>
                {formatNumber(resource.totalRecords)}
              </div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Available Fields</div>
              <div className="stat-value">
                {resource.availableFields.length}
              </div>
            </div>
          </div>

          {resource.lastRecord && (
            <div className="last-record">
              <div className="last-record-title">Last Record</div>
              <div className="last-record-preview">{resource.lastRecord.preview}</div>
              <div className="last-record-date">
                Created: {formatDate(resource.lastRecord.createdAt)}
                {resource.lastRecord.updatedAt && resource.lastRecord.updatedAt !== resource.lastRecord.createdAt && (
                  <> | Updated: {formatDate(resource.lastRecord.updatedAt)}</>
                )}
              </div>
            </div>
          )}

          <div className="features">
            <span className={`feature-badge ${resource.supportsPagination ? 'active' : ''}`}>
              {resource.supportsPagination ? '✓' : '✗'} Pagination
            </span>
            <span className={`feature-badge ${resource.supportsSearch ? 'active' : ''}`}>
              {resource.supportsSearch ? '✓' : '✗'} Search
            </span>
            <span className={`feature-badge ${resource.availableFilters.length > 0 ? 'active' : ''}`}>
              {resource.availableFilters.length} Filters
            </span>
          </div>

          {resource.availableFields.length > 0 && (
            <div className="fields-section">
              <div className="fields-title">Available Fields</div>
              <div className="fields-list">
                {resource.availableFields.slice(0, 10).map((field) => (
                  <span key={field} className="field-tag">{field}</span>
                ))}
                {resource.availableFields.length > 10 && (
                  <span className="field-tag">+{resource.availableFields.length - 10} more</span>
                )}
              </div>
            </div>
          )}

          {resource.availableFilters.length > 0 && (
            <div className="fields-section">
              <div className="fields-title">Available Filters</div>
              <div className="fields-list">
                {resource.availableFilters.map((filter) => (
                  <span key={filter} className="field-tag">{filter}</span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default async function Dashboard() {
  let data: DashboardData;

  try {
    data = await fetchDashboardData();
  } catch (error) {
    return (
      <div className="dashboard">
        <div className="header">
          <h1>Abeto API Dashboard</h1>
          <p>Failed to fetch dashboard data</p>
        </div>
        <div className="error-message">
          {error instanceof Error ? error.message : 'Unknown error occurred'}
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="header">
        <h1>Abeto API Dashboard</h1>
        <p>Real-time status of API resources for lead management and installer coordination</p>
      </div>

      {/* API Health Banner */}
      <div className={`api-health-banner ${data.apiHealth.status === 'ok' ? 'healthy' : 'error'}`}>
        <div className="api-health-status">
          <div className="api-health-icon">
            {data.apiHealth.status === 'ok' ? '✓' : '✗'}
          </div>
          <span className="api-health-text">
            API {data.apiHealth.status === 'ok' ? 'Healthy' : 'Unavailable'}
          </span>
        </div>
        <span className="last-updated">
          Last checked: {formatDate(data.apiHealth.checkedAt)}
        </span>
      </div>

      {/* Summary Cards */}
      <div className="summary-grid">
        <div className="summary-card">
          <div className="label">Total Resources</div>
          <div className="value total">{data.summary.totalResources}</div>
        </div>
        <div className="summary-card">
          <div className="label">Healthy Resources</div>
          <div className="value healthy">{data.summary.healthyResources}</div>
        </div>
        <div className="summary-card">
          <div className="label">Total Records</div>
          <div className="value total">{formatNumber(data.summary.totalRecords)}</div>
        </div>
        <div className="summary-card">
          <div className="label">Last Updated</div>
          <div className="value" style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>
            {formatDate(data.summary.lastUpdated)}
          </div>
        </div>
      </div>

      {/* Resources Grid */}
      <div className="resources-grid">
        {data.resources.map((resource) => (
          <ResourceCard key={resource.name} resource={resource} />
        ))}
      </div>

      {/* Footer */}
      <div className="footer">
        <p>
          Abeto API Dashboard | Data refreshes every 60 seconds |{' '}
          <a href="https://abeto-backend.vercel.app/api/docs" target="_blank" rel="noopener noreferrer">
            API Documentation
          </a>
        </p>
      </div>
    </div>
  );
}
