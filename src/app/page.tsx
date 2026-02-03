'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  ResourceStatus,
  DashboardData,
  HealthStatus,
  HealthIndicator,
  ProjectProposal
} from '@/lib/api';

// Local storage key for custom project order
const CUSTOM_ORDER_KEY = 'abeto-project-custom-order';

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

interface ProjectCardProps {
  project: ProjectProposal;
  index: number;
  isDraggable: boolean;
  onDragStart?: (e: React.DragEvent, index: number) => void;
  onDragOver?: (e: React.DragEvent, index: number) => void;
  onDragEnd?: () => void;
  isDragOver?: boolean;
}

function ProjectCard({ project, index, isDraggable, onDragStart, onDragOver, onDragEnd, isDragOver }: ProjectCardProps) {
  const [expanded, setExpanded] = useState(false);

  const difficultyColor = {
    Easy: 'var(--accent-green)',
    Medium: 'var(--accent-yellow)',
    Hard: 'var(--accent-orange)',
  }[project.difficulty];

  const priorityColor = {
    Critical: 'var(--accent-red)',
    High: 'var(--accent-orange)',
    Medium: 'var(--accent-yellow)',
    Low: 'var(--text-muted)',
  }[project.priority];

  const categoryIcon: Record<string, string> = {
    'Hand-Off': '🤝',
    'Qualification': '✅',
    'Lead Acquisition': '📥',
    'Partner Management': '🤝',
    'AI/ML': '🤖',
    'SDR Portal': '💬',
    'Installers Portal': '🏗️',
    'Reporting': '📊',
    'Platform': '⚡',
    'Marketing': '📣',
    'Partnerships': '🤝',
    'Admin': '⚙️',
  };

  const stageClass = project.stage?.toLowerCase().replace(' ', '-') || 'idea';

  return (
    <div
      className={`project-card stage-card-${stageClass} ${isDragOver ? 'drag-over' : ''} ${isDraggable ? 'draggable' : ''}`}
      draggable={isDraggable}
      onDragStart={isDraggable ? (e) => onDragStart?.(e, index) : undefined}
      onDragOver={isDraggable ? (e) => {
        e.preventDefault();
        onDragOver?.(e, index);
      } : undefined}
      onDragEnd={isDraggable ? onDragEnd : undefined}
      onClick={() => setExpanded(!expanded)}
      {/* Drag Handle & Stage Badge */}
      <div className="project-top-row">
        <div className="project-top-left">
          {isDraggable && (
            <span className="drag-handle" title="Drag to reorder">⋮⋮</span>
          )}
          <span className={`stage-badge stage-${stageClass}`}>{project.stage}</span>
        </div>
        <span className={`data-status-badge data-${project.dataStatus?.toLowerCase()}`}>
          {project.dataStatus === 'Live' && '🟢'}
          {project.dataStatus === 'Partial' && '🟡'}
          {project.dataStatus === 'Static' && '🟠'}
          {project.dataStatus === 'None' && '⚫'}
          {project.dataStatus}
        </span>
      </div>

      <div className="project-header">
        <div className="project-category-icon">{categoryIcon[project.category] || '📋'}</div>
        <div className="project-info">
          <h3 className="project-title">{project.title}</h3>
          <div className="project-meta">
            <span className="project-priority" style={{ color: priorityColor, fontWeight: 600 }}>
              {project.priority}
            </span>
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

      {/* Primary Users */}
      {project.primaryUsers && project.primaryUsers.length > 0 && (
        <div className="project-users">
          <span className="users-label">👥 Users:</span>
          {project.primaryUsers.map((user, idx) => (
            <span key={idx} className="user-tag">{user}</span>
          ))}
        </div>
      )}

      {/* Automation Level */}
      <div className="project-loa">
        <span className="loa-current">{project.currentLOA}</span>
        <span className="loa-arrow">→</span>
        <span className="loa-potential">{project.potentialLOA}</span>
      </div>

      {/* Next Milestone */}
      {project.nextMilestone && (
        <div className="project-milestone">
          <span className="milestone-label">🎯 Next:</span> {project.nextMilestone}
        </div>
      )}

      {/* Action Buttons */}
      <div className="project-actions">
        {project.prototypeUrl && (
          <a
            href={project.prototypeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="action-btn demo-btn"
            onClick={(e) => e.stopPropagation()}
          >
            🚀 Demo
          </a>
        )}
        {project.notionUrl && (
          <a
            href={project.notionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="action-btn docs-btn"
            onClick={(e) => e.stopPropagation()}
          >
            📄 Docs
          </a>
        )}
      </div>

      <div className="project-resources">
        {project.resourcesUsed.map((resource) => (
          <span key={resource} className="resource-tag">{resource}</span>
        ))}
      </div>

      {expanded && (
        <div className="project-expanded">
          {/* Ops Process */}
          <div className="project-section">
            <h4>Ops Process</h4>
            <p className="ops-process-text">{project.opsProcess}</p>
          </div>

          <div className="project-section">
            <h4>Benefits</h4>
            <ul>
              {project.benefits.map((benefit, idx) => (
                <li key={idx}>{benefit}</li>
              ))}
            </ul>
          </div>

          {/* Integrations Needed */}
          {project.integrationsNeeded && project.integrationsNeeded.length > 0 && (
            <div className="project-section">
              <h4>Integrations Needed</h4>
              <div className="integrations-list">
                {project.integrationsNeeded.map((integration, idx) => (
                  <span key={idx} className="integration-tag">{integration}</span>
                ))}
              </div>
            </div>
          )}

          {/* Missing API Data - Critical for implementation */}
          {project.missingApiData && project.missingApiData.length > 0 && (
            <div className="project-section missing-data">
              <h4>⚠️ Missing API Data Required</h4>
              <ul>
                {project.missingApiData.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>
          )}

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
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [sortBy, setSortBy] = useState<'priority' | 'stage' | 'difficulty' | 'custom'>('priority');

  // Drag and drop state
  const [customOrder, setCustomOrder] = useState<string[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const filteredProjectsRef = useRef<ProjectProposal[]>([]);

  // Load custom order from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_ORDER_KEY);
      if (saved) {
        setCustomOrder(JSON.parse(saved));
      }
    } catch (e) {
      console.error('Failed to load custom order:', e);
    }
  }, []);

  // Save custom order to localStorage when it changes
  useEffect(() => {
    if (customOrder.length > 0) {
      try {
        localStorage.setItem(CUSTOM_ORDER_KEY, JSON.stringify(customOrder));
      } catch (e) {
        console.error('Failed to save custom order:', e);
      }
    }
  }, [customOrder]);

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

      // Initialize custom order if empty
      if (customOrder.length === 0 && result.projects.length > 0) {
        setCustomOrder(result.projects.map((p: ProjectProposal) => p.id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [customOrder.length]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = () => {
    loadData(true);
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    // Add a slight delay to show the drag effect
    const target = e.target as HTMLElement;
    setTimeout(() => {
      target.style.opacity = '0.5';
    }, 0);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragEnd = () => {
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      // Get the current filtered projects in their display order
      const currentFilteredIds = [...filteredProjectsRef.current].map(p => p.id);

      // Get the dragged item id and target position
      const draggedId = currentFilteredIds[draggedIndex];
      const targetId = currentFilteredIds[dragOverIndex];

      // Create new order by moving the item in the full custom order
      const newOrder = [...customOrder];
      const draggedCurrentIndex = newOrder.indexOf(draggedId);
      const targetCurrentIndex = newOrder.indexOf(targetId);

      if (draggedCurrentIndex !== -1 && targetCurrentIndex !== -1) {
        newOrder.splice(draggedCurrentIndex, 1);
        newOrder.splice(targetCurrentIndex, 0, draggedId);
        setCustomOrder(newOrder);
      }
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const resetCustomOrder = () => {
    const defaultOrder = projects.map(p => p.id);
    setCustomOrder(defaultOrder);
    localStorage.removeItem(CUSTOM_ORDER_KEY);
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

  // Filter and sort projects
  let filteredProjects = projects;
  if (categoryFilter !== 'all') {
    filteredProjects = filteredProjects.filter(p => p.category === categoryFilter);
  }
  if (stageFilter !== 'all') {
    filteredProjects = filteredProjects.filter(p => p.stage === stageFilter);
  }
  if (priorityFilter !== 'all') {
    filteredProjects = filteredProjects.filter(p => p.priority === priorityFilter);
  }

  // Sort projects
  const priorityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const stageOrder = { Deployed: 0, 'Under Dev': 1, Pilot: 2, Planned: 3, Idea: 4 };
  const difficultyOrder = { Easy: 0, Medium: 1, Hard: 2 };

  filteredProjects = [...filteredProjects].sort((a, b) => {
    if (sortBy === 'custom') {
      const aIndex = customOrder.indexOf(a.id);
      const bIndex = customOrder.indexOf(b.id);
      // If not in custom order, put at the end
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    }
    if (sortBy === 'priority') {
      return (priorityOrder[a.priority] || 99) - (priorityOrder[b.priority] || 99);
    }
    if (sortBy === 'stage') {
      return (stageOrder[a.stage as keyof typeof stageOrder] || 99) - (stageOrder[b.stage as keyof typeof stageOrder] || 99);
    }
    if (sortBy === 'difficulty') {
      return (difficultyOrder[a.difficulty] || 99) - (difficultyOrder[b.difficulty] || 99);
    }
    return 0;
  });

  // Update the ref for drag operations
  filteredProjectsRef.current = filteredProjects;

  const categories = ['all', ...Array.from(new Set(projects.map(p => p.category)))];
  const priorities = ['all', 'Critical', 'High', 'Medium', 'Low'];

  // Count projects by stage for summary
  const stageCounts = {
    Deployed: projects.filter(p => p.stage === 'Deployed').length,
    'Under Dev': projects.filter(p => p.stage === 'Under Dev').length,
    Pilot: projects.filter(p => p.stage === 'Pilot').length,
    Planned: projects.filter(p => p.stage === 'Planned').length,
    Idea: projects.filter(p => p.stage === 'Idea').length,
  };

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
            <h2>Products & Project Ideas</h2>
            <p>
              All Abeto products, prototypes, and planned initiatives. Filter by stage, priority, or category.
              Each item shows development status, required API data, and links to prototypes.
            </p>
          </div>

          {/* Stage Summary Pills */}
          <div className="stage-summary">
            <div className="stage-pill deployed" onClick={() => setStageFilter(stageFilter === 'Deployed' ? 'all' : 'Deployed')}>
              <span className="stage-count">{stageCounts.Deployed}</span>
              <span className="stage-label">Deployed</span>
            </div>
            <div className="stage-pill under-dev" onClick={() => setStageFilter(stageFilter === 'Under Dev' ? 'all' : 'Under Dev')}>
              <span className="stage-count">{stageCounts['Under Dev']}</span>
              <span className="stage-label">Under Dev</span>
            </div>
            <div className="stage-pill pilot" onClick={() => setStageFilter(stageFilter === 'Pilot' ? 'all' : 'Pilot')}>
              <span className="stage-count">{stageCounts.Pilot}</span>
              <span className="stage-label">Pilot</span>
            </div>
            <div className="stage-pill planned" onClick={() => setStageFilter(stageFilter === 'Planned' ? 'all' : 'Planned')}>
              <span className="stage-count">{stageCounts.Planned}</span>
              <span className="stage-label">Planned</span>
            </div>
            <div className="stage-pill idea" onClick={() => setStageFilter(stageFilter === 'Idea' ? 'all' : 'Idea')}>
              <span className="stage-count">{stageCounts.Idea}</span>
              <span className="stage-label">Ideas</span>
            </div>
          </div>

          {/* Filters Row */}
          <div className="filters-row">
            <div className="filter-group">
              <label>Category:</label>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>{cat === 'all' ? 'All Categories' : cat}</option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label>Priority:</label>
              <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
                {priorities.map((p) => (
                  <option key={p} value={p}>{p === 'all' ? 'All Priorities' : p}</option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label>Sort by:</label>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'priority' | 'stage' | 'difficulty' | 'custom')}>
                <option value="priority">Priority</option>
                <option value="stage">Stage</option>
                <option value="difficulty">Difficulty</option>
                <option value="custom">✋ Custom (Drag to reorder)</option>
              </select>
            </div>
            {sortBy === 'custom' && (
              <button className="reset-order-btn" onClick={resetCustomOrder}>
                ↺ Reset Order
              </button>
            )}
            <div className="filter-group view-toggle">
              <button className={viewMode === 'cards' ? 'active' : ''} onClick={() => setViewMode('cards')}>▦ Cards</button>
              <button className={viewMode === 'table' ? 'active' : ''} onClick={() => setViewMode('table')}>☰ Table</button>
            </div>
          </div>

          {sortBy === 'custom' && viewMode === 'cards' && (
            <div className="drag-hint">
              💡 Drag cards to reorder. Your custom order is saved automatically.
            </div>
          )}

          <div className="projects-count">
            Showing {filteredProjects.length} of {projects.length} projects
          </div>

          {/* Projects Grid or Table */}
          {viewMode === 'cards' ? (
            <div className={`projects-grid ${sortBy === 'custom' ? 'drag-enabled' : ''}`}>
              {filteredProjects.map((project, index) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  index={index}
                  isDraggable={sortBy === 'custom'}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragEnd={handleDragEnd}
                  isDragOver={dragOverIndex === index}
                />
              ))}
            </div>
          ) : (
            <div className="projects-table-wrapper">
              <table className="projects-table">
                <thead>
                  <tr>
                    {sortBy === 'custom' && <th style={{ width: '40px' }}>#</th>}
                    <th>Product / Project</th>
                    <th>Stage</th>
                    <th>Priority</th>
                    <th>Category</th>
                    <th>Difficulty</th>
                    <th>Data Status</th>
                    <th>Links</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProjects.map((project, index) => (
                    <tr
                      key={project.id}
                      className={`stage-row-${project.stage?.toLowerCase().replace(' ', '-')} ${dragOverIndex === index ? 'drag-over' : ''} ${sortBy === 'custom' ? 'draggable' : ''}`}
                      draggable={sortBy === 'custom'}
                      onDragStart={sortBy === 'custom' ? (e) => handleDragStart(e, index) : undefined}
                      onDragOver={sortBy === 'custom' ? (e) => {
                        e.preventDefault();
                        handleDragOver(e, index);
                      } : undefined}
                      onDragEnd={sortBy === 'custom' ? handleDragEnd : undefined}
                    >
                      {sortBy === 'custom' && (
                        <td className="drag-cell">
                          <span className="drag-handle-table">⋮⋮</span>
                        </td>
                      )}
                      <td>
                        <div className="table-project-name">{project.title}</div>
                        <div className="table-project-desc">{project.description.substring(0, 100)}...</div>
                      </td>
                      <td><span className={`stage-badge stage-${project.stage?.toLowerCase().replace(' ', '-')}`}>{project.stage}</span></td>
                      <td><span className={`priority-badge priority-${project.priority?.toLowerCase()}`}>{project.priority}</span></td>
                      <td>{project.category}</td>
                      <td><span className={`difficulty-badge difficulty-${project.difficulty?.toLowerCase()}`}>{project.difficulty}</span></td>
                      <td><span className={`data-status data-${project.dataStatus?.toLowerCase()}`}>{project.dataStatus}</span></td>
                      <td>
                        {project.prototypeUrl && (
                          <a href={project.prototypeUrl} target="_blank" rel="noopener noreferrer" className="link-btn">Demo</a>
                        )}
                        {project.notionUrl && (
                          <a href={project.notionUrl} target="_blank" rel="noopener noreferrer" className="link-btn">Docs</a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
