'use client';

import { useState, useEffect, useCallback } from 'react';
import type {
  ResourceStatus,
  DashboardData,
  HealthStatus,
  HealthIndicator,
  ProjectProposal
} from '@/lib/api';

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
  } catch (e) {
    return 'Invalid date';
  }
}

function formatNumber(num: number | null): string {
  if (num === null) return 'N/A';
  return num.toLocaleString();
}

function getStatusColor(status: HealthStatus): string {
  switch (status) {
    case 'healthy': return 'var(--accent-green)';
    case 'warning': return 'var(--accent-yellow)';
    case 'degraded': return 'var(--accent-orange)';
    case 'critical': return 'var(--accent-red)';
    case 'error': return 'var(--accent-red)';
    default: return 'var(--text-muted)';
  }
}

function HealthIndicatorBadge({ indicator }: { indicator: HealthIndicator }) {
  return (
    <div className="health-indicator" style={{ borderLeftColor: getStatusColor(indicator.status) }}>
      <span className="indicator-name">{indicator.name}</span>
      <span className="indicator-message" style={{ color: getStatusColor(indicator.status) }}>
        {indicator.message}
      </span>
    </div>
  );
}

function HealthScoreRing({ score, size = 60 }: { score: number; size?: number }) {
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (score / 100) * circumference;

  let color = 'var(--accent-green)';
  if (score < 90) color = 'var(--accent-yellow)';
  if (score < 70) color = 'var(--accent-orange)';
  if (score < 40) color = 'var(--accent-red)';

  return (
    <div className="health-score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle
          className="ring-bg"
          strokeWidth={strokeWidth}
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
        <circle
          className="ring-progress"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: offset,
            stroke: color,
          }}
        />
      </svg>
      <span className="ring-value" style={{ color }}>{score}</span>
    </div>
  );
}

function ResourceCard({ resource }: { resource: ResourceStatus }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`resource-card status-${resource.status}`}>
      <div className="resource-header" onClick={() => setExpanded(!expanded)}>
        <div className="resource-header-left">
          <HealthScoreRing score={resource.healthScore} size={50} />
          <div className="resource-info">
            <h3 className="resource-title">{resource.name}</h3>
            <p className="resource-description">{resource.description}</p>
          </div>
        </div>
        <div className="resource-header-right">
          <span className={`status-badge ${resource.status}`}>
            <span className="status-dot"></span>
            {resource.status}
          </span>
          <span className="expand-icon">{expanded ? '▼' : '▶'}</span>
        </div>
      </div>

      {resource.errorMessage && (
        <div className="error-message">
          {resource.errorMessage}
        </div>
      )}

      <div className="resource-quick-stats">
        <div className="quick-stat">
          <span className="quick-stat-value">{formatNumber(resource.totalRecords)}</span>
          <span className="quick-stat-label">Records</span>
        </div>
        <div className="quick-stat">
          <span className="quick-stat-value">{resource.responseTimeMs || 'N/A'}ms</span>
          <span className="quick-stat-label">Response</span>
        </div>
        <div className="quick-stat">
          <span className="quick-stat-value">{resource.availableFields.length}</span>
          <span className="quick-stat-label">Fields</span>
        </div>
        <div className="quick-stat">
          <span className="quick-stat-value">{resource.availableFilters.length}</span>
          <span className="quick-stat-label">Filters</span>
        </div>
      </div>

      {/* Health Indicators */}
      <div className="health-indicators">
        {resource.healthIndicators.map((indicator, idx) => (
          <HealthIndicatorBadge key={idx} indicator={indicator} />
        ))}
      </div>

      {expanded && (
        <div className="resource-expanded">
          <code className="resource-endpoint">{resource.endpoint}</code>

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
          </div>

          {resource.availableFields.length > 0 && (
            <div className="fields-section">
              <div className="fields-title">Available Fields</div>
              <div className="fields-list">
                {resource.availableFields.map((field) => (
                  <span key={field} className="field-tag">{field}</span>
                ))}
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
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectProposal }) {
  const [expanded, setExpanded] = useState(false);

  const difficultyColor = {
    Easy: 'var(--accent-green)',
    Medium: 'var(--accent-yellow)',
    Hard: 'var(--accent-orange)',
  }[project.difficulty];

  const categoryIcon = {
    Analytics: '📊',
    Automation: '⚙️',
    Integration: '🔗',
    Reporting: '📄',
    'AI/ML': '🤖',
    Operations: '🛠️',
  }[project.category];

  return (
    <div className="project-card" onClick={() => setExpanded(!expanded)}>
      <div className="project-header">
        <div className="project-category-icon">{categoryIcon}</div>
        <div className="project-info">
          <h3 className="project-title">{project.title}</h3>
          <div className="project-meta">
            <span className="project-category">{project.category}</span>
            <span className="project-difficulty" style={{ color: difficultyColor }}>
              {project.difficulty}
            </span>
            <span className="project-hours">{project.estimatedHours}</span>
          </div>
        </div>
        <span className="expand-icon">{expanded ? '▼' : '▶'}</span>
      </div>

      <p className="project-description">{project.description}</p>

      <div className="project-resources">
        {project.resourcesUsed.map((resource) => (
          <span key={resource} className="resource-tag">{resource}</span>
        ))}
      </div>

      {expanded && (
        <div className="project-expanded">
          <div className="project-section">
            <h4>Benefits</h4>
            <ul>
              {project.benefits.map((benefit, idx) => (
                <li key={idx}>{benefit}</li>
              ))}
            </ul>
          </div>

          <div className="project-section">
            <h4>Prerequisites</h4>
            <div className="prereq-list">
              {project.prerequisites.map((prereq, idx) => (
                <span key={idx} className="prereq-tag">{prereq}</span>
              ))}
            </div>
          </div>

          <div className="project-section">
            <h4>API Endpoints Used</h4>
            <div className="endpoints-list">
              {project.apiEndpoints.map((endpoint, idx) => (
                <code key={idx} className="endpoint-tag">{endpoint}</code>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [projects, setProjects] = useState<ProjectProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'status' | 'projects'>('status');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const loadData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    setError(null);

    try {
      const response = await fetch('/api/dashboard');
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch dashboard data');
      }

      setData(result.data);
      setProjects(result.projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = () => {
    loadData(true);
  };

  if (loading) {
    return (
      <div className="dashboard">
        <div className="loading">
          <div className="loading-spinner"></div>
          Loading dashboard data...
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="dashboard">
        <div className="header">
          <h1>Abeto API Dashboard</h1>
          <p>Failed to load dashboard data</p>
        </div>
        <div className="error-message">{error}</div>
        <button className="refresh-button" onClick={handleRefresh}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const filteredProjects = categoryFilter === 'all'
    ? projects
    : projects.filter(p => p.category === categoryFilter);

  const categories = ['all', ...Array.from(new Set(projects.map(p => p.category)))];

  return (
    <div className="dashboard">
      <div className="header">
        <div className="header-top">
          <div>
            <h1>Abeto API Dashboard</h1>
            <p>Real-time status of API resources for lead management and installer coordination</p>
          </div>
          <div className="header-actions">
            <button
              className="refresh-button"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? '↻ Refreshing...' : '↻ Refresh Now'}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'status' ? 'active' : ''}`}
          onClick={() => setActiveTab('status')}
        >
          📊 Resource Status
        </button>
        <button
          className={`tab ${activeTab === 'projects' ? 'active' : ''}`}
          onClick={() => setActiveTab('projects')}
        >
          💡 Project Ideas ({projects.length})
        </button>
      </div>

      {activeTab === 'status' && (
        <>
          {/* API Health Banner */}
          <div className={`api-health-banner ${data.apiHealth.status === 'ok' ? 'healthy' : 'error'}`}>
            <div className="api-health-status">
              <div className="api-health-icon">
                {data.apiHealth.status === 'ok' ? '✓' : '✗'}
              </div>
              <span className="api-health-text">
                API {data.apiHealth.status === 'ok' ? 'Healthy' : 'Unavailable'}
              </span>
              {data.apiHealth.responseTimeMs && (
                <span className="api-response-time">({data.apiHealth.responseTimeMs}ms)</span>
              )}
            </div>
            <span className="last-updated">
              Last checked: {formatDate(data.apiHealth.checkedAt)}
            </span>
          </div>

          {/* Summary Cards */}
          <div className="summary-grid">
            <div className="summary-card">
              <div className="label">Health Score</div>
              <div className="value">
                <HealthScoreRing score={data.summary.averageHealthScore} size={70} />
              </div>
            </div>
            <div className="summary-card">
              <div className="label">Healthy</div>
              <div className="value healthy">{data.summary.healthyResources}</div>
            </div>
            <div className="summary-card">
              <div className="label">Warnings</div>
              <div className="value warning">{data.summary.warningResources}</div>
            </div>
            <div className="summary-card">
              <div className="label">Critical</div>
              <div className="value critical">{data.summary.criticalResources}</div>
            </div>
            <div className="summary-card">
              <div className="label">Total Records</div>
              <div className="value total">{formatNumber(data.summary.totalRecords)}</div>
            </div>
          </div>

          {/* Resources Grid */}
          <div className="resources-grid">
            {data.resources.map((resource) => (
              <ResourceCard key={resource.name} resource={resource} />
            ))}
          </div>
        </>
      )}

      {activeTab === 'projects' && (
        <>
          <div className="projects-intro">
            <h2>Project Ideas</h2>
            <p>
              Based on the available API resources, here are project ideas you can build
              using real-time data from Abeto. Each project includes estimated effort,
              required skills, and which API endpoints to use.
            </p>
          </div>

          {/* Category Filter */}
          <div className="category-filter">
            {categories.map((cat) => (
              <button
                key={cat}
                className={`category-btn ${categoryFilter === cat ? 'active' : ''}`}
                onClick={() => setCategoryFilter(cat)}
              >
                {cat === 'all' ? 'All Categories' : cat}
              </button>
            ))}
          </div>

          {/* Projects Grid */}
          <div className="projects-grid">
            {filteredProjects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </>
      )}

      {/* Footer */}
      <div className="footer">
        <p>
          Abeto API Dashboard v2.0 |{' '}
          <a href="https://abeto-backend.vercel.app/api/docs" target="_blank" rel="noopener noreferrer">
            API Documentation
          </a>
        </p>
      </div>
    </div>
  );
}
