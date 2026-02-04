'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  ResourceStatus,
  DashboardData,
  HealthStatus,
  HealthIndicator,
  ProjectProposal,
  ProjectPillar,
  MissingApiResource,
  DataSourceNeeded,
  SubTask,
  ProjectSubTasks,
  SharedTask,
  AIPotential,
  KnowledgeArea
} from '@/lib/api';
import { getMissingApiResources, getDataSourcesNeeded, getProjectSubTasks, getSharedTasks } from '@/lib/api';

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

// AI Potential color helper
function getAIPotentialColor(potential: AIPotential): string {
  switch (potential) {
    case 'High': return 'var(--accent-green)';
    case 'Medium': return 'var(--accent-yellow)';
    case 'Low': return 'var(--accent-orange)';
    case 'None': return 'var(--text-muted)';
    default: return 'var(--text-muted)';
  }
}

// SubTask display component
function SubTaskCard({ subTask, isShared }: { subTask: SubTask; isShared?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const difficultyColor = {
    Easy: 'var(--accent-green)',
    Medium: 'var(--accent-yellow)',
    Hard: 'var(--accent-orange)',
  }[subTask.difficulty];

  const statusIcon = {
    'Not Started': '⚪',
    'In Progress': '🔵',
    'Blocked': '🔴',
    'Done': '✅',
  }[subTask.status];

  return (
    <div className={`subtask-card ${subTask.status.toLowerCase().replace(' ', '-')} ${expanded ? 'expanded' : ''} ${isShared ? 'shared' : ''}`}>
      <div className="subtask-header" onClick={() => setExpanded(!expanded)}>
        <div className="subtask-header-left">
          <span className="subtask-status-icon">{statusIcon}</span>
          <div className="subtask-info">
            <span className="subtask-title">{subTask.title}</span>
            {isShared && <span className="shared-badge">🔗 Shared</span>}
          </div>
        </div>
        <div className="subtask-header-right">
          <span className="subtask-hours">{subTask.estimatedHours}</span>
          <span className="subtask-difficulty" style={{ color: difficultyColor }}>{subTask.difficulty}</span>
          <span className="subtask-ai-potential" style={{ backgroundColor: getAIPotentialColor(subTask.aiPotential) }}>
            🤖 {subTask.aiPotential}
          </span>
          <span className="expand-icon-small">{expanded ? '▼' : '▶'}</span>
        </div>
      </div>

      {expanded && (
        <div className="subtask-expanded">
          <p className="subtask-description">{subTask.description}</p>

          <div className="subtask-details">
            <div className="subtask-section">
              <span className="subtask-label">🛠️ Tools:</span>
              <div className="subtask-tags">
                {subTask.toolsNeeded.map((tool, idx) => (
                  <span key={idx} className="tool-tag">{tool}</span>
                ))}
              </div>
            </div>

            <div className="subtask-section">
              <span className="subtask-label">📚 Knowledge:</span>
              <div className="subtask-tags">
                {subTask.knowledgeAreas.map((area, idx) => (
                  <span key={idx} className="knowledge-tag">{area}</span>
                ))}
              </div>
            </div>

            <div className="subtask-section ai-assist">
              <span className="subtask-label">🤖 AI Assist:</span>
              <p className="ai-assist-description">{subTask.aiAssistDescription}</p>
            </div>

            {subTask.dependsOnTasks.length > 0 && (
              <div className="subtask-section">
                <span className="subtask-label">⬅️ Depends on:</span>
                <div className="subtask-tags">
                  {subTask.dependsOnTasks.map((dep, idx) => (
                    <span key={idx} className="dep-tag-small">{dep}</span>
                  ))}
                </div>
              </div>
            )}

            {subTask.blockedBy.length > 0 && (
              <div className="subtask-section blocked">
                <span className="subtask-label">🚫 Blocked by:</span>
                <div className="subtask-tags">
                  {subTask.blockedBy.map((blocker, idx) => (
                    <span key={idx} className="blocker-tag">{blocker}</span>
                  ))}
                </div>
              </div>
            )}

            {subTask.sharedWithProjects.length > 0 && (
              <div className="subtask-section shared-projects">
                <span className="subtask-label">🔗 Also enables:</span>
                <div className="subtask-tags">
                  {subTask.sharedWithProjects.map((proj, idx) => (
                    <span key={idx} className="shared-project-tag">{proj}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Shared Task display component
function SharedTaskCard({ task }: { task: SharedTask }) {
  const [expanded, setExpanded] = useState(false);

  const priorityColor = {
    Critical: 'var(--accent-red)',
    High: 'var(--accent-orange)',
    Medium: 'var(--accent-yellow)',
    Low: 'var(--text-muted)',
  }[task.priority];

  const statusIcon = {
    'Not Started': '⚪',
    'In Progress': '🔵',
    'Blocked': '🔴',
    'Done': '✅',
  }[task.status];

  return (
    <div className={`shared-task-card ${task.status.toLowerCase().replace(' ', '-')}`}>
      <div className="shared-task-header" onClick={() => setExpanded(!expanded)}>
        <div className="shared-task-left">
          <span className="shared-task-status">{statusIcon}</span>
          <div className="shared-task-info">
            <span className="shared-task-name">{task.name}</span>
            <span className="shared-task-impact">🔗 Enables {task.sharedAcrossCount} projects</span>
          </div>
        </div>
        <div className="shared-task-right">
          <span className="shared-task-priority" style={{ color: priorityColor }}>{task.priority}</span>
          <span className="shared-task-hours">{task.estimatedHours}</span>
          <span className="expand-icon-small">{expanded ? '▼' : '▶'}</span>
        </div>
      </div>

      {expanded && (
        <div className="shared-task-expanded">
          <p className="shared-task-description">{task.description}</p>
          <div className="shared-task-projects">
            <span className="subtask-label">Projects unlocked:</span>
            <div className="subtask-tags">
              {task.projectIds.map((proj, idx) => (
                <span key={idx} className="shared-project-tag">{proj}</span>
              ))}
            </div>
          </div>
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
  subTasks?: SubTask[];
  showSubTasks?: boolean;
}

function ProjectCard({ project, index, isDraggable, onDragStart, onDragOver, onDragEnd, isDragOver, subTasks, showSubTasks }: ProjectCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [subTasksExpanded, setSubTasksExpanded] = useState(false);

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

  const pillarIcon: Record<string, string> = {
    'Data Foundation': '🏗️',
    'Knowledge Generation': '🧠',
    'Human Empowerment': '👥',
  };

  const categoryIcon: Record<string, string> = {
    'Data Layer': '💾',
    'Lead Generation': '📥',
    'SDR Tools': '💬',
    'Partner Growth': '🤝',
    'Installer Tools': '🔧',
    'Reporting & Intelligence': '📊',
    'Marketing & Campaigns': '📣',
    'Operations': '⚙️',
    'Platform Infrastructure': '🧠',
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
    >
      {/* Drag Handle & Stage Badge */}
      <div className="project-top-row">
        <div className="project-top-left">
          {isDraggable && (
            <span className="drag-handle" title="Drag to reorder">⋮⋮</span>
          )}
          <span className={`stage-badge stage-${stageClass}`}>{project.stage}</span>
          {project.pillar && (
            <span className={`pillar-badge pillar-${project.pillar?.toLowerCase().replace(' ', '-')}`}>
              {pillarIcon[project.pillar]} {project.pillar}
            </span>
          )}
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

      {/* Why It Matters - Key message */}
      {project.whyItMatters && project.whyItMatters !== project.description && (
        <div className="project-why-it-matters">
          <span className="why-label">💡 Why it matters:</span> {project.whyItMatters}
        </div>
      )}

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
          {/* Human Role - THE KEY MESSAGE */}
          {project.humanRole && (
            <div className="project-section human-role-section">
              <h4>👥 Human Role: Before vs. After</h4>
              <div className="human-role-comparison">
                <div className="human-role-before">
                  <span className="role-label">❌ Before</span>
                  <p>{project.humanRole.before}</p>
                </div>
                <div className="human-role-arrow">→</div>
                <div className="human-role-after">
                  <span className="role-label">✅ After</span>
                  <p>{project.humanRole.after}</p>
                </div>
              </div>
              {project.humanRole.whoIsEmpowered && project.humanRole.whoIsEmpowered.length > 0 && (
                <div className="empowered-roles">
                  <span className="empowered-label">Empowers:</span>
                  {project.humanRole.whoIsEmpowered.map((role, idx) => (
                    <span key={idx} className="empowered-tag">{role}</span>
                  ))}
                </div>
              )}
              {project.humanRole.newCapabilities && project.humanRole.newCapabilities.length > 0 && (
                <div className="new-capabilities">
                  <span className="capabilities-label">New capabilities:</span>
                  <ul>
                    {project.humanRole.newCapabilities.slice(0, 4).map((cap, idx) => (
                      <li key={idx}>{cap}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Data Requirements */}
          {project.dataRequirements && (
            <div className="project-section data-requirements-section">
              <h4>📊 Data Flow</h4>
              <div className="data-flow-grid">
                {project.dataRequirements.required && project.dataRequirements.required.length > 0 && (
                  <div className="data-flow-item data-required">
                    <span className="data-label">🔴 Requires</span>
                    <ul>
                      {project.dataRequirements.required.slice(0, 3).map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {project.dataRequirements.generates && project.dataRequirements.generates.length > 0 && (
                  <div className="data-flow-item data-generates">
                    <span className="data-label">🟢 Generates</span>
                    <ul>
                      {project.dataRequirements.generates.slice(0, 3).map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {project.dataRequirements.improves && project.dataRequirements.improves.length > 0 && (
                  <div className="data-flow-item data-improves">
                    <span className="data-label">🔵 Improves</span>
                    <ul>
                      {project.dataRequirements.improves.slice(0, 3).map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Project Dependencies */}
          {((project.dependsOn && project.dependsOn.length > 0) || (project.enables && project.enables.length > 0)) && (
            <div className="project-section dependencies-section">
              <h4>🔗 Dependencies</h4>
              <div className="dependencies-grid">
                {project.dependsOn && project.dependsOn.length > 0 && (
                  <div className="dependency-item">
                    <span className="dep-label">⬅️ Depends on:</span>
                    {project.dependsOn.map((dep, idx) => (
                      <span key={idx} className="dep-tag">{dep}</span>
                    ))}
                  </div>
                )}
                {project.enables && project.enables.length > 0 && (
                  <div className="dependency-item">
                    <span className="dep-label">➡️ Enables:</span>
                    {project.enables.map((dep, idx) => (
                      <span key={idx} className="dep-tag enables-tag">{dep}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

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

          {/* Sub-Tasks Section */}
          {showSubTasks && subTasks && subTasks.length > 0 && (
            <div className="project-section subtasks-section">
              <div className="subtasks-header" onClick={(e) => { e.stopPropagation(); setSubTasksExpanded(!subTasksExpanded); }}>
                <h4>📋 Sub-Tasks ({subTasks.length})</h4>
                <div className="subtasks-summary">
                  <span className="subtask-count-badge done">✅ {subTasks.filter(t => t.status === 'Done').length}</span>
                  <span className="subtask-count-badge in-progress">🔵 {subTasks.filter(t => t.status === 'In Progress').length}</span>
                  <span className="subtask-count-badge not-started">⚪ {subTasks.filter(t => t.status === 'Not Started').length}</span>
                  <span className="subtask-count-badge blocked">🔴 {subTasks.filter(t => t.status === 'Blocked').length}</span>
                </div>
                <span className="expand-icon">{subTasksExpanded ? '▼' : '▶'}</span>
              </div>

              {subTasksExpanded && (
                <div className="subtasks-list">
                  {/* AI Potential summary */}
                  <div className="ai-potential-summary">
                    <span className="ai-summary-label">🤖 AI Assist Potential:</span>
                    <span className="ai-summary-item high">High: {subTasks.filter(t => t.aiPotential === 'High').length}</span>
                    <span className="ai-summary-item medium">Medium: {subTasks.filter(t => t.aiPotential === 'Medium').length}</span>
                    <span className="ai-summary-item low">Low: {subTasks.filter(t => t.aiPotential === 'Low').length}</span>
                  </div>

                  {/* Critical Path */}
                  <div className="critical-path-hint">
                    <span>🎯 Critical Path: {subTasks.map(t => t.id).join(' → ')}</span>
                  </div>

                  {/* Sub-task cards */}
                  {subTasks.map((subTask) => (
                    <SubTaskCard
                      key={subTask.id}
                      subTask={subTask}
                      isShared={subTask.isFoundational || subTask.sharedWithProjects.length > 0}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
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
  const [activeTab, setActiveTab] = useState<'status' | 'projects' | 'missing-api' | 'vision'>('status');
  const missingApiResources = getMissingApiResources();
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [pillarFilter, setPillarFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [sortBy, setSortBy] = useState<'pillar' | 'priority' | 'stage' | 'difficulty' | 'custom'>('pillar');

  // Missing API filters
  const [apiPriorityFilter, setApiPriorityFilter] = useState<string>('all');
  const [apiCategoryFilter, setApiCategoryFilter] = useState<string>('all');
  const [apiDifficultyFilter, setApiDifficultyFilter] = useState<string>('all');
  const [missingViewMode, setMissingViewMode] = useState<'api' | 'data'>('api');
  const dataSourcesNeeded = getDataSourcesNeeded();

  // Sub-tasks data
  const projectSubTasks = getProjectSubTasks();
  const sharedTasks = getSharedTasks();
  const [showSubTasks, setShowSubTasks] = useState(true);
  const [showSharedTasks, setShowSharedTasks] = useState(false);

  // Helper to get sub-tasks for a project
  const getSubTasksForProject = (projectId: string): SubTask[] => {
    const projectData = projectSubTasks.find(p => p.projectId === projectId);
    return projectData?.subTasks || [];
  };

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
          <h1 className="main-title">Abeto<span className="title-accent">:</span> From Data to Opportunity</h1>
          <p className="main-subtitle">Failed to load dashboard data</p>
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
  if (pillarFilter !== 'all') {
    filteredProjects = filteredProjects.filter(p => p.pillar === pillarFilter);
  }

  // Sort projects
  const priorityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const stageOrder = { Deployed: 0, 'Under Dev': 1, Pilot: 2, Planned: 3, Idea: 4 };
  const difficultyOrder = { Easy: 0, Medium: 1, Hard: 2 };
  const pillarOrder: Record<string, number> = { 'Data Foundation': 0, 'Knowledge Generation': 1, 'Human Empowerment': 2 };

  filteredProjects = [...filteredProjects].sort((a, b) => {
    if (sortBy === 'custom') {
      const aIndex = customOrder.indexOf(a.id);
      const bIndex = customOrder.indexOf(b.id);
      // If not in custom order, put at the end
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    }
    if (sortBy === 'pillar') {
      const pillarA = pillarOrder[a.pillar as string] ?? 99;
      const pillarB = pillarOrder[b.pillar as string] ?? 99;
      if (pillarA !== pillarB) return pillarA - pillarB;
      // Within same pillar, sort by pillarOrder then priority
      if ((a.pillarOrder || 99) !== (b.pillarOrder || 99)) {
        return (a.pillarOrder || 99) - (b.pillarOrder || 99);
      }
      return (priorityOrder[a.priority] || 99) - (priorityOrder[b.priority] || 99);
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
            <h1 className="main-title">Abeto<span className="title-accent">:</span> From Data to Opportunity</h1>
            <p className="main-subtitle">Where reliable APIs meet strategic initiatives. Build the foundation, unlock the growth.</p>
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

      {/* Narrative Flow Banner */}
      <div className="narrative-flow">
        <div className="narrative-step" onClick={() => setActiveTab('status')}>
          <span className="narrative-number">1</span>
          <span className="narrative-label">Data Foundation</span>
          <span className="narrative-sublabel">Live API Health</span>
        </div>
        <div className="narrative-arrow">→</div>
        <div className="narrative-step" onClick={() => setActiveTab('missing-api')}>
          <span className="narrative-number">2</span>
          <span className="narrative-label">Build Missing</span>
          <span className="narrative-sublabel">{missingApiResources.length} endpoints needed</span>
        </div>
        <div className="narrative-arrow">→</div>
        <div className="narrative-step" onClick={() => setActiveTab('projects')}>
          <span className="narrative-number">3</span>
          <span className="narrative-label">Knowledge & Growth</span>
          <span className="narrative-sublabel">{projects.length} initiatives</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'status' ? 'active' : ''}`}
          onClick={() => setActiveTab('status')}
        >
          📊 API Status
        </button>
        <button
          className={`tab ${activeTab === 'missing-api' ? 'active' : ''}`}
          onClick={() => setActiveTab('missing-api')}
        >
          🔧 Missing API ({missingApiResources.length})
        </button>
        <button
          className={`tab ${activeTab === 'projects' ? 'active' : ''}`}
          onClick={() => setActiveTab('projects')}
        >
          💡 Projects ({projects.length})
        </button>
        <button
          className={`tab ${activeTab === 'vision' ? 'active' : ''}`}
          onClick={() => setActiveTab('vision')}
        >
          🎯 Vision
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
            <h2>The Three Pillars of Scalable Growth</h2>
            <p className="intro-subtitle">
              A strategic view of Abeto products and initiatives. Each project is designed with a clear purpose and human role.
            </p>

            {/* Three Pillars Overview */}
            <div className="three-pillars">
              <div className="pillar pillar-foundation">
                <div className="pillar-icon">🏗️</div>
                <h3>Data Foundation</h3>
                <p>Without reliable, real-time data, <strong>nothing else works</strong>. This is the bedrock.</p>
              </div>
              <div className="pillar pillar-generation">
                <div className="pillar-icon">🧠</div>
                <h3>Knowledge Generation</h3>
                <p>Data enables <strong>exponential knowledge</strong>. AI-driven tools empower humans to make smarter decisions, faster.</p>
              </div>
              <div className="pillar pillar-empowerment">
                <div className="pillar-icon">👥</div>
                <h3>Human Empowerment</h3>
                <p>AI makes humans <strong>MORE capable</strong>, not obsolete. People are always essential.</p>
              </div>
            </div>
          </div>

          {/* Shared Tasks Panel */}
          <div className="shared-tasks-panel">
            <div className="shared-tasks-toggle" onClick={() => setShowSharedTasks(!showSharedTasks)}>
              <h3>🔗 Foundational Tasks ({sharedTasks.length})</h3>
              <span className="shared-tasks-hint">Build once, unlock multiple projects</span>
              <span className="expand-icon">{showSharedTasks ? '▼' : '▶'}</span>
            </div>

            {showSharedTasks && (
              <div className="shared-tasks-content">
                <div className="shared-tasks-summary">
                  <span className="summary-item">
                    <span className="summary-label">Total Impact:</span>
                    <span className="summary-value">{sharedTasks.reduce((sum, t) => sum + t.sharedAcrossCount, 0)} project dependencies</span>
                  </span>
                  <span className="summary-item">
                    <span className="summary-label">Est. Hours:</span>
                    <span className="summary-value">{sharedTasks.map(t => t.estimatedHours).join(' + ')}</span>
                  </span>
                </div>
                <div className="shared-tasks-grid">
                  {sharedTasks.map((task) => (
                    <SharedTaskCard key={task.id} task={task} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sub-Tasks Toggle */}
          <div className="subtasks-toggle-row">
            <label className="subtasks-toggle-label">
              <input
                type="checkbox"
                checked={showSubTasks}
                onChange={(e) => setShowSubTasks(e.target.checked)}
              />
              <span>📋 Show Sub-Tasks</span>
            </label>
            <span className="subtasks-toggle-hint">
              {showSubTasks ? 'Sub-task breakdowns visible in expanded projects' : 'Enable to see detailed task breakdowns'}
            </span>
          </div>

          {/* Interactive Filter Bar */}
          <div className="interactive-filters">
            {/* Stage Pills */}
            <div className="filter-section">
              <span className="filter-section-label">Stage:</span>
              <div className="filter-pills">
                <button
                  className={`filter-pill ${stageFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setStageFilter('all')}
                >
                  All ({projects.length})
                </button>
                <button
                  className={`filter-pill deployed ${stageFilter === 'Deployed' ? 'active' : ''}`}
                  onClick={() => setStageFilter(stageFilter === 'Deployed' ? 'all' : 'Deployed')}
                >
                  ✓ Deployed ({stageCounts.Deployed})
                </button>
                <button
                  className={`filter-pill under-dev ${stageFilter === 'Under Dev' ? 'active' : ''}`}
                  onClick={() => setStageFilter(stageFilter === 'Under Dev' ? 'all' : 'Under Dev')}
                >
                  🔨 Under Dev ({stageCounts['Under Dev']})
                </button>
                <button
                  className={`filter-pill pilot ${stageFilter === 'Pilot' ? 'active' : ''}`}
                  onClick={() => setStageFilter(stageFilter === 'Pilot' ? 'all' : 'Pilot')}
                >
                  🧪 Pilot ({stageCounts.Pilot})
                </button>
                <button
                  className={`filter-pill planned ${stageFilter === 'Planned' ? 'active' : ''}`}
                  onClick={() => setStageFilter(stageFilter === 'Planned' ? 'all' : 'Planned')}
                >
                  📋 Planned ({stageCounts.Planned})
                </button>
                <button
                  className={`filter-pill idea ${stageFilter === 'Idea' ? 'active' : ''}`}
                  onClick={() => setStageFilter(stageFilter === 'Idea' ? 'all' : 'Idea')}
                >
                  💡 Ideas ({stageCounts.Idea})
                </button>
              </div>
            </div>

            {/* Pillar Pills */}
            <div className="filter-section">
              <span className="filter-section-label">Pillar:</span>
              <div className="filter-pills">
                <button
                  className={`filter-pill ${pillarFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setPillarFilter('all')}
                >
                  All Pillars
                </button>
                <button
                  className={`filter-pill pillar-foundation ${pillarFilter === 'Data Foundation' ? 'active' : ''}`}
                  onClick={() => setPillarFilter(pillarFilter === 'Data Foundation' ? 'all' : 'Data Foundation')}
                >
                  🏗️ Data Foundation
                </button>
                <button
                  className={`filter-pill pillar-generation ${pillarFilter === 'Knowledge Generation' ? 'active' : ''}`}
                  onClick={() => setPillarFilter(pillarFilter === 'Knowledge Generation' ? 'all' : 'Knowledge Generation')}
                >
                  🧠 Knowledge Generation
                </button>
                <button
                  className={`filter-pill pillar-empowerment ${pillarFilter === 'Human Empowerment' ? 'active' : ''}`}
                  onClick={() => setPillarFilter(pillarFilter === 'Human Empowerment' ? 'all' : 'Human Empowerment')}
                >
                  👥 Human Empowerment
                </button>
              </div>
            </div>

            {/* Priority Pills */}
            <div className="filter-section">
              <span className="filter-section-label">Priority:</span>
              <div className="filter-pills">
                <button
                  className={`filter-pill ${priorityFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setPriorityFilter('all')}
                >
                  All
                </button>
                <button
                  className={`filter-pill priority-critical ${priorityFilter === 'Critical' ? 'active' : ''}`}
                  onClick={() => setPriorityFilter(priorityFilter === 'Critical' ? 'all' : 'Critical')}
                >
                  🔴 Critical
                </button>
                <button
                  className={`filter-pill priority-high ${priorityFilter === 'High' ? 'active' : ''}`}
                  onClick={() => setPriorityFilter(priorityFilter === 'High' ? 'all' : 'High')}
                >
                  🟠 High
                </button>
                <button
                  className={`filter-pill priority-medium ${priorityFilter === 'Medium' ? 'active' : ''}`}
                  onClick={() => setPriorityFilter(priorityFilter === 'Medium' ? 'all' : 'Medium')}
                >
                  🟡 Medium
                </button>
                <button
                  className={`filter-pill priority-low ${priorityFilter === 'Low' ? 'active' : ''}`}
                  onClick={() => setPriorityFilter(priorityFilter === 'Low' ? 'all' : 'Low')}
                >
                  ⚪ Low
                </button>
              </div>
            </div>
          </div>

          {/* Compact Sort & View Controls */}
          <div className="sort-view-row">
            <div className="sort-controls">
              <span className="sort-label">Sort:</span>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'pillar' | 'priority' | 'stage' | 'difficulty' | 'custom')}>
                <option value="pillar">🏛️ Pillar</option>
                <option value="priority">Priority (Ops Focus)</option>
                <option value="stage">Stage</option>
                <option value="difficulty">Difficulty</option>
                <option value="custom">✋ Custom Order</option>
              </select>
              {sortBy === 'custom' && (
                <button className="reset-order-btn" onClick={resetCustomOrder}>
                  ↺ Reset
                </button>
              )}
            </div>
            <div className="view-controls">
              <button className={`view-btn ${viewMode === 'cards' ? 'active' : ''}`} onClick={() => setViewMode('cards')}>▦ Cards</button>
              <button className={`view-btn ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')}>☰ Table</button>
            </div>
            <div className="category-select">
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="all">All Categories</option>
                {categories.filter(c => c !== 'all').map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
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
                  subTasks={getSubTasksForProject(project.id)}
                  showSubTasks={showSubTasks}
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

      {activeTab === 'missing-api' && (() => {
        // Filter missing API resources
        let filteredApiResources = missingApiResources;
        if (apiPriorityFilter !== 'all') {
          filteredApiResources = filteredApiResources.filter(r => r.priority === apiPriorityFilter);
        }
        if (apiCategoryFilter !== 'all') {
          filteredApiResources = filteredApiResources.filter(r => r.category === apiCategoryFilter);
        }
        if (apiDifficultyFilter !== 'all') {
          filteredApiResources = filteredApiResources.filter(r => r.difficulty === apiDifficultyFilter);
        }

        // Sort by priority
        const apiPriorityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
        filteredApiResources = [...filteredApiResources].sort((a, b) =>
          (apiPriorityOrder[a.priority] || 99) - (apiPriorityOrder[b.priority] || 99)
        );

        // Count by category for API
        const categoryCounts = {
          'Core Data': missingApiResources.filter(r => r.category === 'Core Data').length,
          'Analytics': missingApiResources.filter(r => r.category === 'Analytics').length,
          'External Integration': missingApiResources.filter(r => r.category === 'External Integration').length,
          'Compliance': missingApiResources.filter(r => r.category === 'Compliance').length,
          'Financial': missingApiResources.filter(r => r.category === 'Financial').length,
        };

        // Count data sources by type
        const dataSourceTypeCounts = {
          'Internal Database': dataSourcesNeeded.filter(d => d.type === 'Internal Database').length,
          'CRM Field': dataSourcesNeeded.filter(d => d.type === 'CRM Field').length,
          'External API': dataSourcesNeeded.filter(d => d.type === 'External API').length,
          'Configuration': dataSourcesNeeded.filter(d => d.type === 'Configuration').length,
          'Calculated/Aggregated': dataSourcesNeeded.filter(d => d.type === 'Calculated/Aggregated').length,
        };

        // Sort data sources by priority
        const sortedDataSources = [...dataSourcesNeeded].sort((a, b) =>
          (apiPriorityOrder[a.priority] || 99) - (apiPriorityOrder[b.priority] || 99)
        );

        return (
        <>
          <div className="projects-intro">
            <h2>🔧 What&apos;s Missing to Build</h2>
            <p className="intro-subtitle">
              APIs, databases, and data sources needed to enable all projects. Build these to unlock the full platform.
            </p>
          </div>

          {/* View Toggle */}
          <div className="missing-view-toggle">
            <button
              className={`toggle-btn ${missingViewMode === 'api' ? 'active' : ''}`}
              onClick={() => setMissingViewMode('api')}
            >
              🔌 API Endpoints ({missingApiResources.length})
            </button>
            <button
              className={`toggle-btn ${missingViewMode === 'data' ? 'active' : ''}`}
              onClick={() => setMissingViewMode('data')}
            >
              🗄️ Data Sources ({dataSourcesNeeded.length})
            </button>
          </div>

          {/* Summary Stats Row */}
          <div className="api-stats-row">
            {missingViewMode === 'api' ? (
              <>
                <div className="api-stat-item">
                  <span className="api-stat-value">{missingApiResources.length}</span>
                  <span className="api-stat-label">API Endpoints</span>
                </div>
                <div className="api-stat-item critical">
                  <span className="api-stat-value">{missingApiResources.filter(r => r.priority === 'Critical').length}</span>
                  <span className="api-stat-label">Critical</span>
                </div>
                <div className="api-stat-item high">
                  <span className="api-stat-value">{missingApiResources.filter(r => r.priority === 'High').length}</span>
                  <span className="api-stat-label">High Priority</span>
                </div>
                <div className="api-stat-item">
                  <span className="api-stat-value">{missingApiResources.reduce((sum, r) => sum + parseInt(r.estimatedHours.split('-')[0]), 0)}+</span>
                  <span className="api-stat-label">Est. Hours</span>
                </div>
              </>
            ) : (
              <>
                <div className="api-stat-item">
                  <span className="api-stat-value">{dataSourcesNeeded.length}</span>
                  <span className="api-stat-label">Data Sources</span>
                </div>
                <div className="api-stat-item critical">
                  <span className="api-stat-value">{dataSourcesNeeded.filter(d => d.priority === 'Critical').length}</span>
                  <span className="api-stat-label">Critical</span>
                </div>
                <div className="api-stat-item high">
                  <span className="api-stat-value">{dataSourcesNeeded.filter(d => d.priority === 'High').length}</span>
                  <span className="api-stat-label">High Priority</span>
                </div>
                <div className="api-stat-item">
                  <span className="api-stat-value">{dataSourcesNeeded.filter(d => d.status === 'Not Started').length}</span>
                  <span className="api-stat-label">Not Started</span>
                </div>
              </>
            )}
          </div>

          {/* API Endpoints View */}
          {missingViewMode === 'api' && (
            <>
              {/* Interactive Filters */}
              <div className="interactive-filters api-filters">
                {/* Priority Pills */}
                <div className="filter-section">
                  <span className="filter-section-label">Priority:</span>
                  <div className="filter-pills">
                    <button
                      className={`filter-pill ${apiPriorityFilter === 'all' ? 'active' : ''}`}
                      onClick={() => setApiPriorityFilter('all')}
                    >
                      All ({missingApiResources.length})
                    </button>
                    <button
                      className={`filter-pill priority-critical ${apiPriorityFilter === 'Critical' ? 'active' : ''}`}
                      onClick={() => setApiPriorityFilter(apiPriorityFilter === 'Critical' ? 'all' : 'Critical')}
                    >
                      🔴 Critical ({missingApiResources.filter(r => r.priority === 'Critical').length})
                    </button>
                    <button
                      className={`filter-pill priority-high ${apiPriorityFilter === 'High' ? 'active' : ''}`}
                      onClick={() => setApiPriorityFilter(apiPriorityFilter === 'High' ? 'all' : 'High')}
                    >
                      🟠 High ({missingApiResources.filter(r => r.priority === 'High').length})
                    </button>
                    <button
                      className={`filter-pill priority-medium ${apiPriorityFilter === 'Medium' ? 'active' : ''}`}
                      onClick={() => setApiPriorityFilter(apiPriorityFilter === 'Medium' ? 'all' : 'Medium')}
                    >
                      🟡 Medium ({missingApiResources.filter(r => r.priority === 'Medium').length})
                    </button>
                  </div>
                </div>

                {/* Category Pills */}
                <div className="filter-section">
                  <span className="filter-section-label">Category:</span>
                  <div className="filter-pills">
                    <button
                      className={`filter-pill ${apiCategoryFilter === 'all' ? 'active' : ''}`}
                      onClick={() => setApiCategoryFilter('all')}
                    >
                      All Categories
                    </button>
                    <button
                      className={`filter-pill category-core ${apiCategoryFilter === 'Core Data' ? 'active' : ''}`}
                      onClick={() => setApiCategoryFilter(apiCategoryFilter === 'Core Data' ? 'all' : 'Core Data')}
                    >
                      💾 Core Data ({categoryCounts['Core Data']})
                    </button>
                    <button
                      className={`filter-pill category-analytics ${apiCategoryFilter === 'Analytics' ? 'active' : ''}`}
                      onClick={() => setApiCategoryFilter(apiCategoryFilter === 'Analytics' ? 'all' : 'Analytics')}
                    >
                      📊 Analytics ({categoryCounts['Analytics']})
                    </button>
                    <button
                      className={`filter-pill category-external ${apiCategoryFilter === 'External Integration' ? 'active' : ''}`}
                      onClick={() => setApiCategoryFilter(apiCategoryFilter === 'External Integration' ? 'all' : 'External Integration')}
                    >
                      🔗 External ({categoryCounts['External Integration']})
                    </button>
                    <button
                      className={`filter-pill category-compliance ${apiCategoryFilter === 'Compliance' ? 'active' : ''}`}
                      onClick={() => setApiCategoryFilter(apiCategoryFilter === 'Compliance' ? 'all' : 'Compliance')}
                    >
                      ⚖️ Compliance ({categoryCounts['Compliance']})
                    </button>
                    <button
                      className={`filter-pill category-financial ${apiCategoryFilter === 'Financial' ? 'active' : ''}`}
                      onClick={() => setApiCategoryFilter(apiCategoryFilter === 'Financial' ? 'all' : 'Financial')}
                    >
                      💰 Financial ({categoryCounts['Financial']})
                    </button>
                  </div>
                </div>

                {/* Difficulty Pills */}
                <div className="filter-section">
                  <span className="filter-section-label">Difficulty:</span>
                  <div className="filter-pills">
                    <button
                      className={`filter-pill ${apiDifficultyFilter === 'all' ? 'active' : ''}`}
                      onClick={() => setApiDifficultyFilter('all')}
                    >
                      All
                    </button>
                    <button
                      className={`filter-pill difficulty-easy ${apiDifficultyFilter === 'Easy' ? 'active' : ''}`}
                      onClick={() => setApiDifficultyFilter(apiDifficultyFilter === 'Easy' ? 'all' : 'Easy')}
                    >
                      🟢 Easy
                    </button>
                    <button
                      className={`filter-pill difficulty-medium ${apiDifficultyFilter === 'Medium' ? 'active' : ''}`}
                      onClick={() => setApiDifficultyFilter(apiDifficultyFilter === 'Medium' ? 'all' : 'Medium')}
                    >
                      🟡 Medium
                    </button>
                    <button
                      className={`filter-pill difficulty-hard ${apiDifficultyFilter === 'Hard' ? 'active' : ''}`}
                      onClick={() => setApiDifficultyFilter(apiDifficultyFilter === 'Hard' ? 'all' : 'Hard')}
                    >
                      🟠 Hard
                    </button>
                  </div>
                </div>
              </div>

              {/* Results count */}
              <div className="api-results-count">
                Showing {filteredApiResources.length} of {missingApiResources.length} endpoints
              </div>

              {/* Missing API Resources Grid */}
              <div className="missing-api-grid">
                {filteredApiResources.map((resource) => (
                  <div key={resource.id} className={`missing-api-card priority-${resource.priority.toLowerCase()}`}>
                    <div className="api-card-header">
                      <span className={`priority-badge priority-${resource.priority.toLowerCase()}`}>
                        {resource.priority}
                      </span>
                      <span className={`category-badge category-${resource.category.toLowerCase().replace(/\s+/g, '-')}`}>
                        {resource.category}
                      </span>
                    </div>

                    <h3 className="api-card-title">{resource.name}</h3>
                    <p className="api-card-description">{resource.description}</p>

                    <div className="api-endpoint">
                      <code>{resource.endpoint}</code>
                    </div>

                    <div className="api-card-meta">
                      <span className={`api-difficulty difficulty-${resource.difficulty.toLowerCase()}`}>
                        {resource.difficulty === 'Easy' && '🟢'}
                        {resource.difficulty === 'Medium' && '🟡'}
                        {resource.difficulty === 'Hard' && '🟠'}
                        {resource.difficulty}
                      </span>
                      <span className="api-hours">⏱️ {resource.estimatedHours}</span>
                    </div>

                    <div className="api-data-source">
                      <span className="source-label">📡 Source:</span>
                      <span className="source-value">{resource.dataSource}</span>
                    </div>

                    <div className="api-enables">
                      <span className="enables-label">🔓 Enables:</span>
                      <div className="enables-list">
                        {resource.enablesProjects.slice(0, 3).map((projectId, idx) => (
                          <span key={idx} className="enables-tag">{projectId}</span>
                        ))}
                        {resource.enablesProjects.length > 3 && (
                          <span className="enables-more">+{resource.enablesProjects.length - 3} more</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Data Sources View */}
          {missingViewMode === 'data' && (
            <>
              {/* Type Filter Pills */}
              <div className="interactive-filters api-filters">
                <div className="filter-section">
                  <span className="filter-section-label">Type:</span>
                  <div className="filter-pills">
                    <button className="filter-pill active">All Types</button>
                    <button className="filter-pill type-database">
                      🗄️ Internal DB ({dataSourceTypeCounts['Internal Database']})
                    </button>
                    <button className="filter-pill type-crm">
                      📝 CRM Field ({dataSourceTypeCounts['CRM Field']})
                    </button>
                    <button className="filter-pill type-external">
                      🔌 External API ({dataSourceTypeCounts['External API']})
                    </button>
                    <button className="filter-pill type-config">
                      ⚙️ Config ({dataSourceTypeCounts['Configuration']})
                    </button>
                  </div>
                </div>
              </div>

              {/* Results count */}
              <div className="api-results-count">
                Showing {sortedDataSources.length} data sources
              </div>

              {/* Data Sources Grid */}
              <div className="missing-api-grid">
                {sortedDataSources.map((source) => (
                  <div key={source.id} className={`missing-api-card data-source-card priority-${source.priority.toLowerCase()}`}>
                    <div className="api-card-header">
                      <span className={`priority-badge priority-${source.priority.toLowerCase()}`}>
                        {source.priority}
                      </span>
                      <span className={`type-badge type-${source.type.toLowerCase().replace(/[\/\s]+/g, '-')}`}>
                        {source.type === 'Internal Database' && '🗄️'}
                        {source.type === 'CRM Field' && '📝'}
                        {source.type === 'External API' && '🔌'}
                        {source.type === 'Configuration' && '⚙️'}
                        {source.type === 'Calculated/Aggregated' && '📊'}
                        {source.type}
                      </span>
                      <span className={`status-badge status-${source.status.toLowerCase().replace(/\s+/g, '-')}`}>
                        {source.status}
                      </span>
                    </div>

                    <h3 className="api-card-title">{source.name}</h3>
                    <p className="api-card-description">{source.description}</p>

                    <div className="api-data-source">
                      <span className="source-label">📡 Source:</span>
                      <span className="source-value">{source.source}</span>
                    </div>

                    <div className="api-card-meta">
                      <span className={`effort-badge effort-${source.effort.toLowerCase()}`}>
                        {source.effort === 'Low' && '🟢'}
                        {source.effort === 'Medium' && '🟡'}
                        {source.effort === 'High' && '🟠'}
                        {source.effort} Effort
                      </span>
                    </div>

                    {source.notes && (
                      <div className="data-source-notes">
                        <span className="notes-label">📋 Note:</span> {source.notes}
                      </div>
                    )}

                    <div className="api-enables">
                      <span className="enables-label">🔓 Enables:</span>
                      <div className="enables-list">
                        {source.enablesProjects.slice(0, 3).map((projectId, idx) => (
                          <span key={idx} className="enables-tag">{projectId}</span>
                        ))}
                        {source.enablesProjects.length > 3 && (
                          <span className="enables-more">+{source.enablesProjects.length - 3} more</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
        );
      })()}

      {/* Vision Tab */}
      {activeTab === 'vision' && (
        <div className="vision-tab">
          {/* Hero Section */}
          <div className="vision-hero">
            <h2>You can&apos;t scale chaos.</h2>
            <p className="vision-tagline">
              Before AI can help, data must flow. Before data flows, pipes must be built.
            </p>
          </div>

          {/* The Problem Section */}
          <div className="vision-section vision-problem">
            <h3>😤 The Problem We&apos;re Solving</h3>
            <div className="problem-grid">
              <div className="problem-card">
                <span className="problem-icon">📊</span>
                <h4>Data in Silos</h4>
                <p>Zoho, Sheets, WhatsApp, Aircall - information scattered everywhere.</p>
              </div>
              <div className="problem-card">
                <span className="problem-icon">🎯</span>
                <h4>SDRs Flying Blind</h4>
                <p>No way to know which lead to call next or which installer is available.</p>
              </div>
              <div className="problem-card">
                <span className="problem-icon">📈</span>
                <h4>Can&apos;t Measure What Works</h4>
                <p>Spending on ads without knowing which campaigns actually convert.</p>
              </div>
              <div className="problem-card">
                <span className="problem-icon">⏰</span>
                <h4>Manual Doesn&apos;t Scale</h4>
                <p>More leads = more chaos. Growth is limited by operational capacity.</p>
              </div>
            </div>
          </div>

          {/* The Solution: Three Pillars */}
          <div className="vision-section vision-pillars">
            <h3>🏛️ The Three Pillars of Scalable Growth</h3>
            <p className="section-intro">Build in order. Each layer enables the next.</p>

            <div className="pillar-deep-grid">
              <div className="pillar-deep pillar-deep-foundation">
                <div className="pillar-deep-header">
                  <span className="pillar-deep-icon">🏗️</span>
                  <div>
                    <h4>1. Data Foundation</h4>
                    <span className="pillar-deep-status">Building Now</span>
                  </div>
                </div>
                <p className="pillar-deep-what"><strong>What:</strong> Reliable APIs, unified data layer, quality monitoring</p>
                <p className="pillar-deep-why"><strong>Why:</strong> Every AI feature, every dashboard, every automation depends on this. No foundation = no building.</p>
                <div className="pillar-deep-example">
                  <span className="example-label">💡 Example:</span>
                  <p>&quot;Without knowing which installer is available and their performance history, we can&apos;t route leads intelligently.&quot;</p>
                </div>
              </div>

              <div className="pillar-deep pillar-deep-knowledge">
                <div className="pillar-deep-header">
                  <span className="pillar-deep-icon">🧠</span>
                  <div>
                    <h4>2. Knowledge Generation</h4>
                    <span className="pillar-deep-status">Next Phase</span>
                  </div>
                </div>
                <p className="pillar-deep-what"><strong>What:</strong> Tools that CREATE data while doing their job</p>
                <p className="pillar-deep-why"><strong>Why:</strong> The more leads we generate, the more data we have, the smarter our systems become. Growth feeds intelligence.</p>
                <div className="pillar-deep-example">
                  <span className="example-label">💡 Example:</span>
                  <p>&quot;SDR Portal captures call outcomes → AI learns which questions close deals → Future calls improve.&quot;</p>
                </div>
              </div>

              <div className="pillar-deep pillar-deep-empowerment">
                <div className="pillar-deep-header">
                  <span className="pillar-deep-icon">👥</span>
                  <div>
                    <h4>3. Human Empowerment</h4>
                    <span className="pillar-deep-status">The Goal</span>
                  </div>
                </div>
                <p className="pillar-deep-what"><strong>What:</strong> AI copilots that amplify human capability</p>
                <p className="pillar-deep-why"><strong>Why:</strong> SDRs focus on relationships, not data entry. Managers see trends, not spreadsheets. Humans do what humans do best.</p>
                <div className="pillar-deep-example">
                  <span className="example-label">💡 Example:</span>
                  <p>&quot;Cortex summarizes 10 WhatsApp messages into 2-line context before the call. SDR walks in prepared.&quot;</p>
                </div>
              </div>
            </div>
          </div>

          {/* Dependency Chain */}
          <div className="vision-section vision-dependencies">
            <h3>🔗 Why Order Matters</h3>
            <p className="section-intro">Each tool depends on the one before it. Skip a step and nothing works.</p>

            <div className="dependency-flow">
              <div className="dep-node dep-foundation">
                <span className="dep-icon">🏗️</span>
                <span className="dep-name">Unified Data Layer</span>
                <span className="dep-desc">The source of truth</span>
              </div>
              <div className="dep-arrow">↓</div>
              <div className="dep-branches">
                <div className="dep-branch">
                  <div className="dep-node dep-tool">
                    <span className="dep-icon">📊</span>
                    <span className="dep-name">Reporting Hub</span>
                    <span className="dep-desc">Know what&apos;s happening</span>
                  </div>
                </div>
                <div className="dep-branch">
                  <div className="dep-node dep-tool">
                    <span className="dep-icon">💬</span>
                    <span className="dep-name">SDR Portal</span>
                    <span className="dep-desc">Work efficiently</span>
                  </div>
                  <div className="dep-arrow">↓</div>
                  <div className="dep-node dep-ai">
                    <span className="dep-icon">🤖</span>
                    <span className="dep-name">AI Cortex</span>
                    <span className="dep-desc">Work smarter</span>
                  </div>
                </div>
                <div className="dep-branch">
                  <div className="dep-node dep-tool">
                    <span className="dep-icon">📣</span>
                    <span className="dep-name">Campaign OS</span>
                    <span className="dep-desc">Generate leads</span>
                  </div>
                  <div className="dep-arrow">↓</div>
                  <div className="dep-node dep-ai">
                    <span className="dep-icon">🎯</span>
                    <span className="dep-name">AI Optimization</span>
                    <span className="dep-desc">Auto-optimize spend</span>
                  </div>
                </div>
                <div className="dep-branch">
                  <div className="dep-node dep-tool">
                    <span className="dep-icon">🔧</span>
                    <span className="dep-name">Installer Portal</span>
                    <span className="dep-desc">Partner efficiency</span>
                  </div>
                  <div className="dep-arrow">↓</div>
                  <div className="dep-node dep-ai">
                    <span className="dep-icon">⚡</span>
                    <span className="dep-name">Dynamic Allocation</span>
                    <span className="dep-desc">Auto-route leads</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Practical Examples */}
          <div className="vision-section vision-examples">
            <h3>🎬 Real Examples: Before & After</h3>

            <div className="example-cards">
              <div className="example-card">
                <h4>SDR Portal + AI Cortex</h4>
                <div className="example-comparison">
                  <div className="example-before">
                    <span className="comparison-label">❌ Without Foundation</span>
                    <p>SDR opens 5 tabs, manually checks installer availability, guesses which lead to call next. Spends 30% of time on admin.</p>
                  </div>
                  <div className="example-after">
                    <span className="comparison-label">✅ With Foundation</span>
                    <p>Portal shows: &quot;Next: João in Lisboa. Installer Maria available. Similar deals closed in 2 calls.&quot;</p>
                  </div>
                  <div className="example-ai">
                    <span className="comparison-label">🤖 + AI Layer</span>
                    <p>Cortex adds: &quot;João mentioned business panels - focus on ROI angle. His last message was about financing options.&quot;</p>
                  </div>
                </div>
              </div>

              <div className="example-card">
                <h4>Campaign OS + Attribution</h4>
                <div className="example-comparison">
                  <div className="example-before">
                    <span className="comparison-label">❌ Without Foundation</span>
                    <p>Spend €10k/month on ads. No idea which campaigns convert. Marketing is a black box.</p>
                  </div>
                  <div className="example-after">
                    <span className="comparison-label">✅ With Foundation</span>
                    <p>Know exactly: This creative → this lead → this sale. CPL by channel, conversion by campaign.</p>
                  </div>
                  <div className="example-ai">
                    <span className="comparison-label">🤖 + AI Layer</span>
                    <p>Auto-pause underperforming ads. Suggest winning variants. Predict CAC before launching.</p>
                  </div>
                </div>
              </div>

              <div className="example-card">
                <h4>Installer Portal + Dynamic Allocation</h4>
                <div className="example-comparison">
                  <div className="example-before">
                    <span className="comparison-label">❌ Without Foundation</span>
                    <p>Assign leads randomly. Some installers overwhelmed, others idle. Lead response time: hours.</p>
                  </div>
                  <div className="example-after">
                    <span className="comparison-label">✅ With Foundation</span>
                    <p>Know: Response times, conversion rates, capacity per installer. Balance workload fairly.</p>
                  </div>
                  <div className="example-ai">
                    <span className="comparison-label">🤖 + AI Layer</span>
                    <p>Auto-route to best available installer for region/type. Lead response time: minutes.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Progress Section */}
          <div className="vision-section vision-progress">
            <h3>📍 Where We Are Now</h3>

            <div className="progress-items">
              <div className="progress-item done">
                <span className="progress-icon">✅</span>
                <div className="progress-content">
                  <span className="progress-name">API Health Monitoring</span>
                  <span className="progress-status">Live</span>
                </div>
              </div>
              <div className="progress-item done">
                <span className="progress-icon">✅</span>
                <div className="progress-content">
                  <span className="progress-name">SDR Portal v1</span>
                  <span className="progress-status">Deployed</span>
                </div>
              </div>
              <div className="progress-item in-progress">
                <span className="progress-icon">🔨</span>
                <div className="progress-content">
                  <span className="progress-name">Reporting Hub</span>
                  <span className="progress-status">Under Development</span>
                </div>
              </div>
              <div className="progress-item pending">
                <span className="progress-icon">📋</span>
                <div className="progress-content">
                  <span className="progress-name">Missing Infrastructure</span>
                  <span className="progress-status">{missingApiResources.length} API endpoints + {dataSourcesNeeded.length} data sources</span>
                </div>
              </div>
              <div className="progress-item next">
                <span className="progress-icon">🎯</span>
                <div className="progress-content">
                  <span className="progress-name">Next Milestone</span>
                  <span className="progress-status">Complete data layer → Enable AI features</span>
                </div>
              </div>
            </div>
          </div>

          {/* End Game */}
          <div className="vision-section vision-endgame">
            <h3>🚀 The End Game</h3>
            <p className="endgame-intro">When the foundation is complete:</p>

            <div className="endgame-outcomes">
              <div className="endgame-item">
                <span className="endgame-icon">📈</span>
                <p>SDRs handle <strong>3x volume</strong> without burning out</p>
              </div>
              <div className="endgame-item">
                <span className="endgame-icon">⚡</span>
                <p>Every lead reaches the right installer in <strong>minutes, not hours</strong></p>
              </div>
              <div className="endgame-item">
                <span className="endgame-icon">🤖</span>
                <p>AI handles <strong>routine decisions</strong>, humans handle <strong>relationships</strong></p>
              </div>
              <div className="endgame-item">
                <span className="endgame-icon">🌍</span>
                <p>Growth limited by <strong>market size</strong>, not operational chaos</p>
              </div>
            </div>

            <div className="endgame-cta">
              <p>The vision is clear. The path is defined. Now we build. 🏗️</p>
            </div>
          </div>
        </div>
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
