/**
 * Abeto API Client for Dashboard
 * Fetches status information from each API resource with smart health detection
 */

const API_URL = process.env.ABETO_API_URL || 'https://abeto-backend.vercel.app/api';
const API_KEY = process.env.ABETO_API_KEY || '';

interface FetchOptions {
  revalidate?: number;
  cache?: RequestCache;
}

async function fetchApi<T>(path: string, options?: FetchOptions): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    cache: options?.cache || 'no-store',
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// =============================================================================
// Health Assessment Types & Logic
// =============================================================================

export type HealthStatus = 'healthy' | 'warning' | 'degraded' | 'critical' | 'error';

export interface HealthIndicator {
  name: string;
  status: HealthStatus;
  message: string;
  value?: string | number;
}

export interface ResourceStatus {
  name: string;
  description: string;
  endpoint: string;
  status: HealthStatus;
  healthIndicators: HealthIndicator[];
  healthScore: number; // 0-100
  totalRecords: number | null;
  lastRecord: {
    id?: string;
    createdAt?: string;
    updatedAt?: string;
    preview?: string;
  } | null;
  recentActivity: {
    lastCreated?: string;
    lastUpdated?: string;
    recordsLast24h?: number;
    recordsLast7d?: number;
  };
  availableFields: string[];
  availableFilters: string[];
  supportsSearch: boolean;
  supportsPagination: boolean;
  errorMessage?: string;
  fetchedAt: string;
  responseTimeMs?: number;
}

export interface DashboardData {
  apiHealth: {
    status: 'ok' | 'error';
    internal: boolean;
    checkedAt: string;
    responseTimeMs?: number;
  };
  resources: ResourceStatus[];
  summary: {
    totalResources: number;
    healthyResources: number;
    warningResources: number;
    criticalResources: number;
    totalRecords: number;
    averageHealthScore: number;
    lastUpdated: string;
  };
}

// Smart health assessment based on multiple factors
function assessHealth(indicators: HealthIndicator[]): { status: HealthStatus; score: number } {
  if (indicators.length === 0) return { status: 'error', score: 0 };

  const statusScores: Record<HealthStatus, number> = {
    healthy: 100,
    warning: 70,
    degraded: 40,
    critical: 20,
    error: 0,
  };

  const totalScore = indicators.reduce((sum, ind) => sum + statusScores[ind.status], 0);
  const avgScore = Math.round(totalScore / indicators.length);

  let status: HealthStatus;
  if (avgScore >= 90) status = 'healthy';
  else if (avgScore >= 70) status = 'warning';
  else if (avgScore >= 40) status = 'degraded';
  else if (avgScore >= 20) status = 'critical';
  else status = 'error';

  return { status, score: avgScore };
}

function checkDataFreshness(lastDate: string | undefined, thresholds: { warning: number; critical: number }): HealthIndicator {
  if (!lastDate) {
    return { name: 'Data Freshness', status: 'warning', message: 'No recent data available' };
  }

  const hoursSinceUpdate = (Date.now() - new Date(lastDate).getTime()) / (1000 * 60 * 60);

  if (hoursSinceUpdate < thresholds.warning) {
    return { name: 'Data Freshness', status: 'healthy', message: `Updated ${Math.round(hoursSinceUpdate)}h ago`, value: `${Math.round(hoursSinceUpdate)}h` };
  } else if (hoursSinceUpdate < thresholds.critical) {
    return { name: 'Data Freshness', status: 'warning', message: `No updates in ${Math.round(hoursSinceUpdate)}h`, value: `${Math.round(hoursSinceUpdate)}h` };
  } else {
    return { name: 'Data Freshness', status: 'critical', message: `Stale data (${Math.round(hoursSinceUpdate)}h old)`, value: `${Math.round(hoursSinceUpdate)}h` };
  }
}

function checkRecordCount(count: number | null, thresholds: { min: number; warning: number }): HealthIndicator {
  if (count === null) {
    return { name: 'Record Count', status: 'error', message: 'Unable to fetch count' };
  }

  if (count >= thresholds.warning) {
    return { name: 'Record Count', status: 'healthy', message: `${count.toLocaleString()} records available`, value: count };
  } else if (count >= thresholds.min) {
    return { name: 'Record Count', status: 'warning', message: `Only ${count.toLocaleString()} records`, value: count };
  } else if (count > 0) {
    return { name: 'Record Count', status: 'degraded', message: `Low record count: ${count}`, value: count };
  } else {
    return { name: 'Record Count', status: 'critical', message: 'No records found', value: 0 };
  }
}

function checkResponseTime(ms: number): HealthIndicator {
  if (ms < 500) {
    return { name: 'Response Time', status: 'healthy', message: `${ms}ms`, value: ms };
  } else if (ms < 1500) {
    return { name: 'Response Time', status: 'warning', message: `Slow: ${ms}ms`, value: ms };
  } else if (ms < 5000) {
    return { name: 'Response Time', status: 'degraded', message: `Very slow: ${ms}ms`, value: ms };
  } else {
    return { name: 'Response Time', status: 'critical', message: `Timeout risk: ${ms}ms`, value: ms };
  }
}

// =============================================================================
// Resource-specific health thresholds
// =============================================================================

const RESOURCE_THRESHOLDS = {
  Deals: { freshness: { warning: 24, critical: 72 }, records: { min: 10, warning: 100 } },
  Regions: { freshness: { warning: 168, critical: 720 }, records: { min: 1, warning: 5 } },
  Installers: { freshness: { warning: 168, critical: 720 }, records: { min: 1, warning: 3 } },
  Opportunities: { freshness: { warning: 48, critical: 168 }, records: { min: 5, warning: 50 } },
  Calls: { freshness: { warning: 24, critical: 72 }, records: { min: 10, warning: 100 } },
  Qualifications: { freshness: { warning: 48, critical: 168 }, records: { min: 5, warning: 50 } },
  'Lost Reasons': { freshness: { warning: 720, critical: 2160 }, records: { min: 5, warning: 10 } },
  Templates: { freshness: { warning: 168, critical: 720 }, records: { min: 5, warning: 20 } },
  'Unmatched Calls': { freshness: { warning: 24, critical: 72 }, records: { min: 0, warning: 0 } }, // 0 is good here
};

// =============================================================================
// Fetch Functions for Each Resource
// =============================================================================

async function fetchDealsStatus(): Promise<ResourceStatus> {
  const fetchedAt = new Date().toISOString();
  const startTime = Date.now();

  try {
    const [listResponse, statsResponse] = await Promise.all([
      fetchApi<any>('/internal/deals?pageSize=1&sort=-createdAt'),
      fetchApi<any>('/internal/deals/stats'),
    ]);

    const responseTimeMs = Date.now() - startTime;
    const lastDeal = listResponse.data?.[0];
    const totalRecords = statsResponse.data?.total ?? listResponse.meta?.total ?? 0;
    const lastCreated = lastDeal?.createdAt;

    const thresholds = RESOURCE_THRESHOLDS.Deals;
    const indicators: HealthIndicator[] = [
      checkDataFreshness(lastCreated, thresholds.freshness),
      checkRecordCount(totalRecords, thresholds.records),
      checkResponseTime(responseTimeMs),
    ];

    // Check stage distribution
    const stageData = statsResponse.data?.countByStage || {};
    const acquiredCount = stageData.Acquired || 0;
    const lostCount = stageData.Lost || 0;
    if (totalRecords > 0) {
      const lostRatio = lostCount / totalRecords;
      if (lostRatio > 0.5) {
        indicators.push({ name: 'Lost Ratio', status: 'warning', message: `${Math.round(lostRatio * 100)}% deals lost`, value: `${Math.round(lostRatio * 100)}%` });
      } else {
        indicators.push({ name: 'Lost Ratio', status: 'healthy', message: `${Math.round(lostRatio * 100)}% lost rate`, value: `${Math.round(lostRatio * 100)}%` });
      }
    }

    const { status, score } = assessHealth(indicators);

    return {
      name: 'Deals',
      description: 'Sales deals progressing through pipeline stages',
      endpoint: '/internal/deals',
      status,
      healthScore: score,
      healthIndicators: indicators,
      totalRecords,
      lastRecord: lastDeal ? {
        id: lastDeal.id,
        createdAt: lastDeal.createdAt,
        preview: `${lastDeal.name || 'Unknown'} - ${lastDeal.stage}`,
      } : null,
      recentActivity: {
        lastCreated,
      },
      availableFields: ['id', 'name', 'phone', 'email', 'stage', 'source', 'city', 'tags', 'contact', 'address', 'attribution', 'leadFormData'],
      availableFilters: ['stages', 'sources', 'search', 'assignedTo', 'createdAfter', 'createdBefore', 'hasConversation', 'lastMessageBy'],
      supportsSearch: true,
      supportsPagination: true,
      fetchedAt,
      responseTimeMs,
    };
  } catch (error) {
    return {
      name: 'Deals',
      description: 'Sales deals progressing through pipeline stages',
      endpoint: '/internal/deals',
      status: 'error',
      healthScore: 0,
      healthIndicators: [{ name: 'API Connection', status: 'error', message: error instanceof Error ? error.message : 'Connection failed' }],
      totalRecords: null,
      lastRecord: null,
      recentActivity: {},
      availableFields: [],
      availableFilters: [],
      supportsSearch: true,
      supportsPagination: true,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      fetchedAt,
    };
  }
}

async function fetchRegionsStatus(): Promise<ResourceStatus> {
  const fetchedAt = new Date().toISOString();
  const startTime = Date.now();

  try {
    const response = await fetchApi<any>('/internal/regions?include=installers');
    const responseTimeMs = Date.now() - startTime;
    const regions = response.data || [];
    const lastRegion = regions[regions.length - 1];
    const activeRegions = regions.filter((r: any) => r.isActive).length;

    const thresholds = RESOURCE_THRESHOLDS.Regions;
    const indicators: HealthIndicator[] = [
      checkDataFreshness(lastRegion?.updatedAt || lastRegion?.createdAt, thresholds.freshness),
      checkRecordCount(regions.length, thresholds.records),
      checkResponseTime(responseTimeMs),
    ];

    // Check coverage
    if (regions.length > 0) {
      const activeRatio = activeRegions / regions.length;
      if (activeRatio >= 0.8) {
        indicators.push({ name: 'Active Coverage', status: 'healthy', message: `${activeRegions}/${regions.length} regions active` });
      } else if (activeRatio >= 0.5) {
        indicators.push({ name: 'Active Coverage', status: 'warning', message: `Only ${activeRegions}/${regions.length} active` });
      } else {
        indicators.push({ name: 'Active Coverage', status: 'degraded', message: `Low coverage: ${activeRegions}/${regions.length}` });
      }
    }

    const { status, score } = assessHealth(indicators);

    return {
      name: 'Regions',
      description: 'Geographic regions organized by postal code coverage',
      endpoint: '/internal/regions',
      status,
      healthScore: score,
      healthIndicators: indicators,
      totalRecords: regions.length,
      lastRecord: lastRegion ? {
        id: lastRegion.id,
        createdAt: lastRegion.createdAt,
        updatedAt: lastRegion.updatedAt,
        preview: `${lastRegion.name} (${lastRegion.postalCodeDigits})`,
      } : null,
      recentActivity: {
        lastUpdated: lastRegion?.updatedAt,
      },
      availableFields: ['id', 'name', 'normalizedName', 'postalCodeDigits', 'isActive', 'installers', 'quotas'],
      availableFilters: ['active', 'include'],
      supportsSearch: false,
      supportsPagination: false,
      fetchedAt,
      responseTimeMs,
    };
  } catch (error) {
    return {
      name: 'Regions',
      description: 'Geographic regions organized by postal code coverage',
      endpoint: '/internal/regions',
      status: 'error',
      healthScore: 0,
      healthIndicators: [{ name: 'API Connection', status: 'error', message: error instanceof Error ? error.message : 'Connection failed' }],
      totalRecords: null,
      lastRecord: null,
      recentActivity: {},
      availableFields: [],
      availableFilters: [],
      supportsSearch: false,
      supportsPagination: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      fetchedAt,
    };
  }
}

async function fetchInstallersStatus(): Promise<ResourceStatus> {
  const fetchedAt = new Date().toISOString();
  const startTime = Date.now();

  try {
    const response = await fetchApi<any>('/internal/installers?include=regions');
    const responseTimeMs = Date.now() - startTime;
    const installers = response.data || [];
    const lastInstaller = installers[installers.length - 1];
    const activeInstallers = installers.filter((i: any) => i.isActive).length;

    const thresholds = RESOURCE_THRESHOLDS.Installers;
    const indicators: HealthIndicator[] = [
      checkDataFreshness(lastInstaller?.updatedAt || lastInstaller?.createdAt, thresholds.freshness),
      checkRecordCount(installers.length, thresholds.records),
      checkResponseTime(responseTimeMs),
    ];

    // Check installer availability
    if (installers.length > 0) {
      if (activeInstallers === 0) {
        indicators.push({ name: 'Installer Availability', status: 'critical', message: 'No active installers!' });
      } else if (activeInstallers < installers.length) {
        indicators.push({ name: 'Installer Availability', status: 'warning', message: `${activeInstallers}/${installers.length} active` });
      } else {
        indicators.push({ name: 'Installer Availability', status: 'healthy', message: `All ${activeInstallers} installers active` });
      }
    }

    const { status, score } = assessHealth(indicators);

    return {
      name: 'Installers',
      description: 'Solar panel installation companies',
      endpoint: '/internal/installers',
      status,
      healthScore: score,
      healthIndicators: indicators,
      totalRecords: installers.length,
      lastRecord: lastInstaller ? {
        id: lastInstaller.id,
        createdAt: lastInstaller.createdAt,
        updatedAt: lastInstaller.updatedAt,
        preview: `${lastInstaller.installerName} (${lastInstaller.isActive ? 'Active' : 'Inactive'})`,
      } : null,
      recentActivity: {
        lastUpdated: lastInstaller?.updatedAt,
      },
      availableFields: ['id', 'installerName', 'isActive', 'activatedAt', 'deactivatedAt', 'regions'],
      availableFilters: ['active', 'include'],
      supportsSearch: false,
      supportsPagination: false,
      fetchedAt,
      responseTimeMs,
    };
  } catch (error) {
    return {
      name: 'Installers',
      description: 'Solar panel installation companies',
      endpoint: '/internal/installers',
      status: 'error',
      healthScore: 0,
      healthIndicators: [{ name: 'API Connection', status: 'error', message: error instanceof Error ? error.message : 'Connection failed' }],
      totalRecords: null,
      lastRecord: null,
      recentActivity: {},
      availableFields: [],
      availableFilters: [],
      supportsSearch: false,
      supportsPagination: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      fetchedAt,
    };
  }
}

async function fetchOpportunitiesStatus(): Promise<ResourceStatus> {
  const fetchedAt = new Date().toISOString();
  const startTime = Date.now();

  try {
    const [listResponse, statsResponse] = await Promise.all([
      fetchApi<any>('/internal/opportunities?pageSize=1&sort=-createdAt'),
      fetchApi<any>('/internal/opportunities/stats'),
    ]);

    const responseTimeMs = Date.now() - startTime;
    const lastOpp = listResponse.data?.[0];
    const totalRecords = statsResponse.data?.total ?? listResponse.meta?.total ?? 0;

    const thresholds = RESOURCE_THRESHOLDS.Opportunities;
    const indicators: HealthIndicator[] = [
      checkDataFreshness(lastOpp?.createdAt, thresholds.freshness),
      checkRecordCount(totalRecords, thresholds.records),
      checkResponseTime(responseTimeMs),
    ];

    // Check conversion status
    const stageData = statsResponse.data?.countByStage || {};
    const wonCount = stageData.Won || 0;
    const lostCount = stageData.Lost || 0;
    const closedCount = wonCount + lostCount;
    if (closedCount > 0) {
      const winRate = wonCount / closedCount;
      if (winRate >= 0.3) {
        indicators.push({ name: 'Win Rate', status: 'healthy', message: `${Math.round(winRate * 100)}% win rate`, value: `${Math.round(winRate * 100)}%` });
      } else if (winRate >= 0.15) {
        indicators.push({ name: 'Win Rate', status: 'warning', message: `${Math.round(winRate * 100)}% win rate`, value: `${Math.round(winRate * 100)}%` });
      } else {
        indicators.push({ name: 'Win Rate', status: 'degraded', message: `Low: ${Math.round(winRate * 100)}% win rate`, value: `${Math.round(winRate * 100)}%` });
      }
    }

    const { status, score } = assessHealth(indicators);

    return {
      name: 'Opportunities',
      description: 'Qualified deals sent to installers',
      endpoint: '/internal/opportunities',
      status,
      healthScore: score,
      healthIndicators: indicators,
      totalRecords,
      lastRecord: lastOpp ? {
        id: lastOpp.id,
        createdAt: lastOpp.createdAt,
        updatedAt: lastOpp.updatedAt,
        preview: `${lastOpp.installerName} - ${lastOpp.stage?.name}`,
      } : null,
      recentActivity: {
        lastCreated: lastOpp?.createdAt,
      },
      availableFields: ['id', 'installerId', 'installerName', 'dealId', 'stage', 'stageTimestamps', 'amount', 'lostData', 'wonData'],
      availableFilters: ['installerId', 'dealId', 'isOpen', 'stageName', 'search', 'include'],
      supportsSearch: true,
      supportsPagination: true,
      fetchedAt,
      responseTimeMs,
    };
  } catch (error) {
    return {
      name: 'Opportunities',
      description: 'Qualified deals sent to installers',
      endpoint: '/internal/opportunities',
      status: 'error',
      healthScore: 0,
      healthIndicators: [{ name: 'API Connection', status: 'error', message: error instanceof Error ? error.message : 'Connection failed' }],
      totalRecords: null,
      lastRecord: null,
      recentActivity: {},
      availableFields: [],
      availableFilters: [],
      supportsSearch: true,
      supportsPagination: true,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      fetchedAt,
    };
  }
}

async function fetchCallsStatus(): Promise<ResourceStatus> {
  const fetchedAt = new Date().toISOString();
  const startTime = Date.now();

  try {
    const [listResponse, statsResponse] = await Promise.all([
      fetchApi<any>('/internal/calls?pageSize=1&sort=-createdAt'),
      fetchApi<any>('/internal/calls/stats'),
    ]);

    const responseTimeMs = Date.now() - startTime;
    const lastCall = listResponse.data?.[0];
    const totalRecords = statsResponse.data?.totalCalls ?? listResponse.meta?.total ?? 0;

    const thresholds = RESOURCE_THRESHOLDS.Calls;
    const indicators: HealthIndicator[] = [
      checkDataFreshness(lastCall?.createdAt, thresholds.freshness),
      checkRecordCount(totalRecords, thresholds.records),
      checkResponseTime(responseTimeMs),
    ];

    // Check call outcomes
    const outcomeData = statsResponse.data?.countByOutcome || {};
    const answered = outcomeData.answered || 0;
    const notAnswered = outcomeData.not_answered || 0;
    const totalOutcome = answered + notAnswered;
    if (totalOutcome > 0) {
      const answerRate = answered / totalOutcome;
      if (answerRate >= 0.5) {
        indicators.push({ name: 'Answer Rate', status: 'healthy', message: `${Math.round(answerRate * 100)}% answered`, value: `${Math.round(answerRate * 100)}%` });
      } else if (answerRate >= 0.3) {
        indicators.push({ name: 'Answer Rate', status: 'warning', message: `${Math.round(answerRate * 100)}% answered`, value: `${Math.round(answerRate * 100)}%` });
      } else {
        indicators.push({ name: 'Answer Rate', status: 'degraded', message: `Low: ${Math.round(answerRate * 100)}%`, value: `${Math.round(answerRate * 100)}%` });
      }
    }

    // Check backlog
    const statusData = statsResponse.data?.countByStatus || {};
    const backlog = statusData.backlog || 0;
    if (backlog > 100) {
      indicators.push({ name: 'Backlog', status: 'warning', message: `${backlog} calls in backlog`, value: backlog });
    } else if (backlog > 0) {
      indicators.push({ name: 'Backlog', status: 'healthy', message: `${backlog} in backlog`, value: backlog });
    }

    const { status, score } = assessHealth(indicators);

    return {
      name: 'Calls',
      description: 'Phone calls for deal follow-up',
      endpoint: '/internal/calls',
      status,
      healthScore: score,
      healthIndicators: indicators,
      totalRecords,
      lastRecord: lastCall ? {
        id: lastCall.id,
        createdAt: lastCall.createdAt,
        preview: `${lastCall.callType} - ${lastCall.status}`,
      } : null,
      recentActivity: {
        lastCreated: lastCall?.createdAt,
      },
      availableFields: ['id', 'dealId', 'phoneNumber', 'direction', 'status', 'priority', 'callType', 'outcome', 'callDuration', 'timestamps'],
      availableFilters: ['dealId', 'status', 'priority', 'callType', 'outcome', 'dateAfter', 'dateBefore'],
      supportsSearch: false,
      supportsPagination: true,
      fetchedAt,
      responseTimeMs,
    };
  } catch (error) {
    return {
      name: 'Calls',
      description: 'Phone calls for deal follow-up',
      endpoint: '/internal/calls',
      status: 'error',
      healthScore: 0,
      healthIndicators: [{ name: 'API Connection', status: 'error', message: error instanceof Error ? error.message : 'Connection failed' }],
      totalRecords: null,
      lastRecord: null,
      recentActivity: {},
      availableFields: [],
      availableFilters: [],
      supportsSearch: false,
      supportsPagination: true,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      fetchedAt,
    };
  }
}

async function fetchQualificationsStatus(): Promise<ResourceStatus> {
  const fetchedAt = new Date().toISOString();
  const startTime = Date.now();

  try {
    const response = await fetchApi<any>('/internal/qualifications?isLatest=true');
    const responseTimeMs = Date.now() - startTime;
    const qualifications = response.data || [];
    const lastQual = qualifications[0];

    const approvedCount = qualifications.filter((q: any) => q.status === 'approved').length;
    const pendingCount = qualifications.filter((q: any) => q.status === 'pending').length;

    const thresholds = RESOURCE_THRESHOLDS.Qualifications;
    const indicators: HealthIndicator[] = [
      checkDataFreshness(lastQual?.createdAt, thresholds.freshness),
      checkRecordCount(qualifications.length, thresholds.records),
      checkResponseTime(responseTimeMs),
    ];

    // Check approval status
    if (qualifications.length > 0) {
      const approvalRate = approvedCount / qualifications.length;
      if (approvalRate >= 0.7) {
        indicators.push({ name: 'Approval Rate', status: 'healthy', message: `${Math.round(approvalRate * 100)}% approved` });
      } else if (approvalRate >= 0.4) {
        indicators.push({ name: 'Approval Rate', status: 'warning', message: `${Math.round(approvalRate * 100)}% approved` });
      } else {
        indicators.push({ name: 'Approval Rate', status: 'degraded', message: `Low: ${Math.round(approvalRate * 100)}%` });
      }

      if (pendingCount > 20) {
        indicators.push({ name: 'Pending Queue', status: 'warning', message: `${pendingCount} pending review` });
      }
    }

    const { status, score } = assessHealth(indicators);

    return {
      name: 'Qualifications',
      description: 'Customer qualification records',
      endpoint: '/internal/qualifications',
      status,
      healthScore: score,
      healthIndicators: indicators,
      totalRecords: qualifications.length,
      lastRecord: lastQual ? {
        id: lastQual.id,
        createdAt: lastQual.createdAt,
        updatedAt: lastQual.updatedAt,
        preview: `${lastQual.status} - v${lastQual.version}`,
      } : null,
      recentActivity: {
        lastCreated: lastQual?.createdAt,
      },
      availableFields: ['id', 'dealId', 'callId', 'status', 'source', 'fullAddress', 'averageEnergyBill', 'decisionStage', 'decisionTimeline', 'primaryMotivation'],
      availableFilters: ['dealId', 'status', 'source', 'isLatest'],
      supportsSearch: false,
      supportsPagination: false,
      fetchedAt,
      responseTimeMs,
    };
  } catch (error) {
    return {
      name: 'Qualifications',
      description: 'Customer qualification records',
      endpoint: '/internal/qualifications',
      status: 'error',
      healthScore: 0,
      healthIndicators: [{ name: 'API Connection', status: 'error', message: error instanceof Error ? error.message : 'Connection failed' }],
      totalRecords: null,
      lastRecord: null,
      recentActivity: {},
      availableFields: [],
      availableFilters: [],
      supportsSearch: false,
      supportsPagination: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      fetchedAt,
    };
  }
}

async function fetchLostReasonsStatus(): Promise<ResourceStatus> {
  const fetchedAt = new Date().toISOString();
  const startTime = Date.now();

  try {
    const response = await fetchApi<any>('/internal/lost-reasons');
    const responseTimeMs = Date.now() - startTime;
    const reasons = response.data || [];
    const lastReason = reasons[reasons.length - 1];
    const activeReasons = reasons.filter((r: any) => r.isActive).length;

    const thresholds = RESOURCE_THRESHOLDS['Lost Reasons'];
    const indicators: HealthIndicator[] = [
      checkDataFreshness(lastReason?.updatedAt || lastReason?.createdAt, thresholds.freshness),
      checkRecordCount(reasons.length, thresholds.records),
      checkResponseTime(responseTimeMs),
    ];

    // Check active reasons
    if (activeReasons < 5) {
      indicators.push({ name: 'Active Reasons', status: 'warning', message: `Only ${activeReasons} active reasons` });
    } else {
      indicators.push({ name: 'Active Reasons', status: 'healthy', message: `${activeReasons} reasons configured` });
    }

    const { status, score } = assessHealth(indicators);

    return {
      name: 'Lost Reasons',
      description: 'Predefined reasons for lost deals/opportunities',
      endpoint: '/internal/lost-reasons',
      status,
      healthScore: score,
      healthIndicators: indicators,
      totalRecords: reasons.length,
      lastRecord: lastReason ? {
        id: lastReason.id,
        createdAt: lastReason.createdAt,
        updatedAt: lastReason.updatedAt,
        preview: `${lastReason.value} (${lastReason.category})`,
      } : null,
      recentActivity: {
        lastUpdated: lastReason?.updatedAt,
      },
      availableFields: ['id', 'value', 'category', 'description', 'typicalCues', 'applicableTo', 'isRecyclable', 'isActive'],
      availableFilters: ['active', 'category', 'domain'],
      supportsSearch: false,
      supportsPagination: false,
      fetchedAt,
      responseTimeMs,
    };
  } catch (error) {
    return {
      name: 'Lost Reasons',
      description: 'Predefined reasons for lost deals/opportunities',
      endpoint: '/internal/lost-reasons',
      status: 'error',
      healthScore: 0,
      healthIndicators: [{ name: 'API Connection', status: 'error', message: error instanceof Error ? error.message : 'Connection failed' }],
      totalRecords: null,
      lastRecord: null,
      recentActivity: {},
      availableFields: [],
      availableFilters: [],
      supportsSearch: false,
      supportsPagination: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      fetchedAt,
    };
  }
}

async function fetchTemplatesStatus(): Promise<ResourceStatus> {
  const fetchedAt = new Date().toISOString();
  const startTime = Date.now();

  try {
    const response = await fetchApi<any>('/internal/templates');
    const responseTimeMs = Date.now() - startTime;
    const templates = response.data || [];
    const lastTemplate = templates[templates.length - 1];
    const approvedTemplates = templates.filter((t: any) => t.status === 'APPROVED').length;

    const thresholds = RESOURCE_THRESHOLDS.Templates;
    const indicators: HealthIndicator[] = [
      checkDataFreshness(lastTemplate?.updatedAt || lastTemplate?.createdAt, thresholds.freshness),
      checkRecordCount(templates.length, thresholds.records),
      checkResponseTime(responseTimeMs),
    ];

    // Check approved templates
    if (templates.length > 0) {
      const approvalRate = approvedTemplates / templates.length;
      if (approvalRate >= 0.8) {
        indicators.push({ name: 'Approval Status', status: 'healthy', message: `${approvedTemplates}/${templates.length} approved` });
      } else if (approvalRate >= 0.5) {
        indicators.push({ name: 'Approval Status', status: 'warning', message: `${approvedTemplates}/${templates.length} approved` });
      } else {
        indicators.push({ name: 'Approval Status', status: 'degraded', message: `Only ${approvedTemplates} approved` });
      }
    }

    const { status, score } = assessHealth(indicators);

    return {
      name: 'Templates',
      description: 'WhatsApp message templates',
      endpoint: '/internal/templates',
      status,
      healthScore: score,
      healthIndicators: indicators,
      totalRecords: templates.length,
      lastRecord: lastTemplate ? {
        id: lastTemplate.id,
        createdAt: lastTemplate.createdAt,
        updatedAt: lastTemplate.updatedAt,
        preview: `${lastTemplate.templateName} (${lastTemplate.status})`,
      } : null,
      recentActivity: {
        lastUpdated: lastTemplate?.updatedAt,
      },
      availableFields: ['id', 'externalId', 'templateName', 'language', 'body', 'status', 'category', 'messageType', 'buttons', 'variables'],
      availableFilters: ['messageType', 'status', 'isEnriched', 'include'],
      supportsSearch: false,
      supportsPagination: false,
      fetchedAt,
      responseTimeMs,
    };
  } catch (error) {
    return {
      name: 'Templates',
      description: 'WhatsApp message templates',
      endpoint: '/internal/templates',
      status: 'error',
      healthScore: 0,
      healthIndicators: [{ name: 'API Connection', status: 'error', message: error instanceof Error ? error.message : 'Connection failed' }],
      totalRecords: null,
      lastRecord: null,
      recentActivity: {},
      availableFields: [],
      availableFilters: [],
      supportsSearch: false,
      supportsPagination: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      fetchedAt,
    };
  }
}

async function fetchUnmatchedCallsStatus(): Promise<ResourceStatus> {
  const fetchedAt = new Date().toISOString();
  const startTime = Date.now();

  try {
    const response = await fetchApi<any>('/internal/unmatched-calls');
    const responseTimeMs = Date.now() - startTime;
    const data = response.data;
    const calls = data?.unmatchedCalls || [];
    const total = data?.meta?.total ?? calls.length;
    const lastCall = calls[0];

    const indicators: HealthIndicator[] = [
      checkResponseTime(responseTimeMs),
    ];

    // For unmatched calls, fewer is better
    if (total === 0) {
      indicators.push({ name: 'Queue Status', status: 'healthy', message: 'No unmatched calls', value: 0 });
    } else if (total < 10) {
      indicators.push({ name: 'Queue Status', status: 'warning', message: `${total} calls need attention`, value: total });
    } else if (total < 50) {
      indicators.push({ name: 'Queue Status', status: 'degraded', message: `${total} calls pending`, value: total });
    } else {
      indicators.push({ name: 'Queue Status', status: 'critical', message: `${total} calls backlogged!`, value: total });
    }

    if (lastCall?.createdAt) {
      const hoursSince = (Date.now() - new Date(lastCall.createdAt).getTime()) / (1000 * 60 * 60);
      if (hoursSince > 48) {
        indicators.push({ name: 'Oldest Unresolved', status: 'warning', message: `${Math.round(hoursSince)}h old` });
      }
    }

    const { status, score } = assessHealth(indicators);

    return {
      name: 'Unmatched Calls',
      description: 'Calls awaiting manual resolution',
      endpoint: '/internal/unmatched-calls',
      status,
      healthScore: score,
      healthIndicators: indicators,
      totalRecords: total,
      lastRecord: lastCall ? {
        id: lastCall.id,
        createdAt: lastCall.createdAt,
        updatedAt: lastCall.updatedAt,
        preview: `${lastCall.phoneNumber} (${lastCall.status})`,
      } : null,
      recentActivity: {
        lastCreated: lastCall?.createdAt,
      },
      availableFields: ['id', 'telephonyServiceId', 'phoneNumber', 'rawPayload', 'status', 'resolvedToCallId'],
      availableFilters: ['limit', 'offset', 'createdAfter', 'createdBefore'],
      supportsSearch: false,
      supportsPagination: true,
      fetchedAt,
      responseTimeMs,
    };
  } catch (error) {
    return {
      name: 'Unmatched Calls',
      description: 'Calls awaiting manual resolution',
      endpoint: '/internal/unmatched-calls',
      status: 'error',
      healthScore: 0,
      healthIndicators: [{ name: 'API Connection', status: 'error', message: error instanceof Error ? error.message : 'Connection failed' }],
      totalRecords: null,
      lastRecord: null,
      recentActivity: {},
      availableFields: [],
      availableFilters: [],
      supportsSearch: false,
      supportsPagination: true,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      fetchedAt,
    };
  }
}

async function fetchHealthStatus(): Promise<{ status: 'ok' | 'error'; internal: boolean; checkedAt: string; responseTimeMs?: number }> {
  const startTime = Date.now();
  try {
    const response = await fetchApi<any>('/internal/health');
    return {
      status: response.status || 'ok',
      internal: response.internal ?? true,
      checkedAt: new Date().toISOString(),
      responseTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      status: 'error',
      internal: false,
      checkedAt: new Date().toISOString(),
      responseTimeMs: Date.now() - startTime,
    };
  }
}

// =============================================================================
// Main Dashboard Data Fetcher
// =============================================================================

export async function fetchDashboardData(): Promise<DashboardData> {
  const [
    apiHealth,
    dealsStatus,
    regionsStatus,
    installersStatus,
    opportunitiesStatus,
    callsStatus,
    qualificationsStatus,
    lostReasonsStatus,
    templatesStatus,
    unmatchedCallsStatus,
  ] = await Promise.all([
    fetchHealthStatus(),
    fetchDealsStatus(),
    fetchRegionsStatus(),
    fetchInstallersStatus(),
    fetchOpportunitiesStatus(),
    fetchCallsStatus(),
    fetchQualificationsStatus(),
    fetchLostReasonsStatus(),
    fetchTemplatesStatus(),
    fetchUnmatchedCallsStatus(),
  ]);

  const resources = [
    dealsStatus,
    regionsStatus,
    installersStatus,
    opportunitiesStatus,
    callsStatus,
    qualificationsStatus,
    lostReasonsStatus,
    templatesStatus,
    unmatchedCallsStatus,
  ];

  const healthyResources = resources.filter(r => r.status === 'healthy').length;
  const warningResources = resources.filter(r => r.status === 'warning').length;
  const criticalResources = resources.filter(r => r.status === 'critical' || r.status === 'error').length;
  const totalRecords = resources.reduce((sum, r) => sum + (r.totalRecords || 0), 0);
  const averageHealthScore = Math.round(resources.reduce((sum, r) => sum + r.healthScore, 0) / resources.length);

  return {
    apiHealth,
    resources,
    summary: {
      totalResources: resources.length,
      healthyResources,
      warningResources,
      criticalResources,
      totalRecords,
      averageHealthScore,
      lastUpdated: new Date().toISOString(),
    },
  };
}

// =============================================================================
// Project Proposals Generator - Based on Abeto Operational Processes
// =============================================================================

export type ProjectStage = 'Deployed' | 'Under Dev' | 'Pilot' | 'Planned' | 'Idea';
export type ProjectCategory = 'Hand-Off' | 'Qualification' | 'Lead Acquisition' | 'Partner Management' | 'AI/ML' | 'SDR Portal' | 'Installers Portal' | 'Reporting' | 'Platform' | 'Marketing' | 'Partnerships' | 'Admin';

export interface ProjectProposal {
  id: string;
  title: string;
  description: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  estimatedHours: string;
  resourcesUsed: string[];
  benefits: string[];
  prerequisites: string[];
  apiEndpoints: string[];
  category: ProjectCategory;
  opsProcess: string;
  currentLOA: string;
  potentialLOA: string;
  missingApiData: string[];
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  // New fields - optional with defaults applied in generateProjectProposals
  stage?: ProjectStage;
  prototypeUrl?: string;
  notionUrl?: string;
  primaryUsers?: string[];
  integrationsNeeded?: string[];
  dataStatus?: 'Live' | 'Partial' | 'Static' | 'None';
  nextMilestone?: string;
  rank?: number; // For manual ordering
}

// =============================================================================
// Existing Products/Prototypes
// =============================================================================

export function getExistingProducts(): ProjectProposal[] {
  return [
    {
      id: 'sdr-portal',
      title: 'SDR Portal',
      description: 'Flagship product managing SDR funnel execution. Lead pipeline view, qualification workflow, and handoff management. Main surface for copiloting and workflow intelligence.',
      difficulty: 'Hard',
      estimatedHours: 'Ongoing',
      resourcesUsed: ['Deals', 'Qualifications', 'Calls', 'Templates', 'Opportunities'],
      benefits: [
        'Live workflow backbone for SDR operations',
        'Centralized lead management',
        'Real-time qualification tracking',
        'Integrated handoff workflow',
      ],
      prerequisites: ['CRM integration', 'WhatsApp integration', 'Telephony integration'],
      apiEndpoints: ['/internal/deals', '/internal/qualifications', '/internal/calls', '/internal/templates'],
      category: 'SDR Portal',
      opsProcess: 'Calls & WhatsApp + Contact prioritization',
      currentLOA: 'Semi-Automated',
      potentialLOA: 'High Automation',
      missingApiData: [],
      priority: 'Critical',
      stage: 'Deployed',
      prototypeUrl: 'https://notion.so/abeto/SDR-Portal-front-end-feedback-2e1e74322e5180bdbf87d88337be98fd',
      primaryUsers: ['SDRs', 'Ops'],
      integrationsNeeded: ['CRM', 'WhatsApp', 'Telephony'],
      dataStatus: 'Live',
      nextMilestone: 'Expand Cortex copiloting + connect automation pilots',
    },
    {
      id: 'investor-portal',
      title: 'Investor Portal',
      description: 'Centralized board reporting and investor materials portal. Dashboard, reports, documents (data room), and showcase. Improves transparency, investor trust, and IR workflow.',
      difficulty: 'Medium',
      estimatedHours: '40-60 hours',
      resourcesUsed: ['Deals', 'Opportunities'],
      benefits: [
        'Centralized investor communications',
        'Automated report generation',
        'Professional data room',
        'Hosts Cortex demo + investor Q&A',
      ],
      prerequisites: ['Report templating', 'Document management', 'Access control'],
      apiEndpoints: ['/internal/deals/stats', '/internal/opportunities/stats'],
      category: 'Reporting',
      opsProcess: 'Performance Reporting',
      currentLOA: 'Manual',
      potentialLOA: 'High Automation',
      missingApiData: ['Financial metrics aggregation', 'Board-level KPIs'],
      priority: 'Medium',
      stage: 'Under Dev',
      prototypeUrl: 'https://investors-abeto-reporting.vercel.app/',
      primaryUsers: ['Investors', 'Board'],
      integrationsNeeded: ['Reporting Hub', 'Finance', 'KPI pipelines'],
      dataStatus: 'Partial',
      nextMilestone: 'Complete data room + automated reporting',
    },
    {
      id: 'reporting-hub',
      title: 'Reporting Hub',
      description: 'Central performance visibility with KPI dashboards and performance benchmarking. Single source of truth supporting Cortex and decision-making.',
      difficulty: 'Medium',
      estimatedHours: '50-70 hours',
      resourcesUsed: ['Deals', 'Opportunities', 'Calls', 'Installers', 'Regions'],
      benefits: [
        'Single source of truth for KPIs',
        'Supports Cortex structured insights',
        'Cross-team visibility',
        'Performance benchmarking',
      ],
      prerequisites: ['Data warehouse design', 'KPI definitions', 'Dashboard framework'],
      apiEndpoints: ['/internal/deals/stats', '/internal/opportunities/stats', '/internal/calls/stats'],
      category: 'Reporting',
      opsProcess: 'Performance Reporting',
      currentLOA: 'Manual',
      potentialLOA: 'High Automation',
      missingApiData: ['Historical data aggregation', 'Cross-pipeline metrics'],
      priority: 'High',
      stage: 'Under Dev',
      prototypeUrl: 'https://abeto-reporting.vercel.app/',
      primaryUsers: ['Leadership', 'Ops'],
      integrationsNeeded: ['CRM', 'Sales', 'Ops', 'Marketing pipelines'],
      dataStatus: 'Partial',
      nextMilestone: 'Define KPI set + build v1 dashboard',
    },
    {
      id: 'ai-cortex',
      title: 'AI Cortex',
      description: 'Embedded intelligence layer across all tools. Converts ops data into copiloting and automation. Core multi-agent orchestration providing compounding advantage across workflows.',
      difficulty: 'Hard',
      estimatedHours: '100+ hours',
      resourcesUsed: ['Deals', 'Qualifications', 'Calls', 'Opportunities', 'Installers'],
      benefits: [
        'Compounding advantage across workflows',
        'Multi-agent orchestration',
        'Copiloting for all teams',
        'Automated decision support',
      ],
      prerequisites: ['Data layer access', 'LLM integration', 'Agent framework'],
      apiEndpoints: ['All endpoints'],
      category: 'Platform',
      opsProcess: 'All processes',
      currentLOA: 'Not Implemented',
      potentialLOA: 'High Automation',
      missingApiData: ['Unified data access layer', 'Real-time event streaming'],
      priority: 'Critical',
      stage: 'Pilot',
      prototypeUrl: 'https://investors-abeto-reporting.vercel.app/cortex-demo/walkthrough',
      primaryUsers: ['All teams'],
      integrationsNeeded: ['Data layer', 'All integrations'],
      dataStatus: 'None',
      nextMilestone: 'Define MVP + embed into SDR Portal first',
    },
    {
      id: 'funnel-automation-os',
      title: 'Funnel Automation OS',
      description: 'Automates WhatsApp and telephony funnel execution. Flow editor, routing rules, and compliance dashboard. Scale lead volume 2-3× without headcount.',
      difficulty: 'Hard',
      estimatedHours: '80-100 hours',
      resourcesUsed: ['Deals', 'Templates', 'Calls'],
      benefits: [
        'Scale lead volume 2-3× without headcount',
        'Automated routing intelligence',
        'Bot optimization insights',
        'A/B testing capabilities',
      ],
      prerequisites: ['Flow editor', 'Routing engine', 'Compliance rules'],
      apiEndpoints: ['/internal/deals', '/internal/templates', '/internal/calls'],
      category: 'SDR Portal',
      opsProcess: 'Chatbot Optimization + Recycling Workflow',
      currentLOA: 'Manual',
      potentialLOA: 'High Automation',
      missingApiData: ['Flow state tracking', 'Routing rules engine', 'A/B test results'],
      priority: 'High',
      stage: 'Pilot',
      prototypeUrl: 'https://claude.ai/public/artifacts/f4b89609-1d66-4cd5-ac68-178efb49891a',
      primaryUsers: ['Sales Ops', 'SDR Ops'],
      integrationsNeeded: ['CRM', 'WhatsApp Business', 'Telephony APIs'],
      dataStatus: 'Static',
      nextMilestone: 'Live integrations + execution engine + A/B testing',
    },
    {
      id: 'campaign-os',
      title: 'Campaign OS',
      description: 'Runs paid media ops using historic data. Multi-channel dashboard, spend-to-CRM mapping, and VoC insights. Scale paid media without hiring; optimization moat.',
      difficulty: 'Hard',
      estimatedHours: '70-90 hours',
      resourcesUsed: ['Deals', 'Qualifications'],
      benefits: [
        'Scale paid media without hiring',
        'Optimization moat via historic data',
        'Cortex-driven insights',
        'Creative angle suggestions',
      ],
      prerequisites: ['Ad platform APIs', 'Attribution modeling', 'VoC analysis'],
      apiEndpoints: ['/internal/deals', '/internal/deals/stats'],
      category: 'Marketing',
      opsProcess: 'Paid Media Optimization',
      currentLOA: 'Manual',
      potentialLOA: 'High Automation',
      missingApiData: ['UTM tracking', 'Ad spend data', 'Attribution paths'],
      priority: 'Medium',
      stage: 'Pilot',
      prototypeUrl: 'https://claude.ai/public/artifacts/f4b89609-1d66-4cd5-ac68-178efb49891a',
      primaryUsers: ['Marketing', 'Growth'],
      integrationsNeeded: ['Zoho', 'Meta', 'Google', 'TikTok', 'Transcripts'],
      dataStatus: 'Static',
      nextMilestone: 'Live sync + Cortex-driven insights + execution',
    },
    {
      id: 'partner-expansion-tool',
      title: 'Partner Expansion Tool',
      description: 'Scales installer partnerships end-to-end. Pipeline CRM, onboarding workflow, and outreach sequences. Removes partner acquisition bottleneck without scaling BDRs.',
      difficulty: 'Medium',
      estimatedHours: '50-70 hours',
      resourcesUsed: ['Installers', 'Regions'],
      benefits: [
        'Remove partner acquisition bottleneck',
        'Automated scoring and personalization',
        'Workflow automation',
        'No need to scale BDRs',
      ],
      prerequisites: ['Pipeline CRM', 'Email sequences', 'Scoring model'],
      apiEndpoints: ['/internal/installers', '/internal/regions'],
      category: 'Partnerships',
      opsProcess: 'Installer Network Expansion',
      currentLOA: 'Manual',
      potentialLOA: 'High Automation',
      missingApiData: ['Partner pipeline tracking', 'Outreach status', 'Engagement scoring'],
      priority: 'High',
      stage: 'Pilot',
      prototypeUrl: 'https://claude.ai/public/artifacts/8f4cfd99-f0db-4335-9e56-c930dde67988',
      primaryUsers: ['Partner Ops', 'BizDev'],
      integrationsNeeded: ['DB', 'Email', 'Airtable', 'Webhooks', 'CRM'],
      dataStatus: 'Static',
      nextMilestone: 'Persistence + outreach automation + scoring engine',
    },
    {
      id: 'installer-portal-product',
      title: 'Installer Portal',
      description: 'Productivity-first portal for installers. Co-pilot workflows, pipeline view, and performance dashboards. Adoption lever that complements existing installer teams.',
      difficulty: 'Hard',
      estimatedHours: '80-100 hours',
      resourcesUsed: ['Installers', 'Opportunities', 'Deals', 'Regions', 'Lost Reasons'],
      benefits: [
        'Installer self-service',
        'Performance transparency',
        'Reduced back-and-forth communication',
        'Copilot for installer execution',
      ],
      prerequisites: ['Installer auth', 'Role-based access', 'Performance calculations'],
      apiEndpoints: ['/internal/installers', '/internal/opportunities', '/internal/regions/{id}/quotas'],
      category: 'Installers Portal',
      opsProcess: 'Partner ROI Tracking + Partner Follow-Up',
      currentLOA: 'Not Implemented',
      potentialLOA: 'High Automation',
      missingApiData: ['Installer auth endpoint', 'Per-installer metrics', 'SLA tracking'],
      priority: 'Critical',
      stage: 'Planned',
      primaryUsers: ['Installers', 'Account Managers'],
      integrationsNeeded: ['Partner CRM', 'Leads', 'Performance data'],
      dataStatus: 'None',
      nextMilestone: 'Define MVP (productivity-first) + pilot rollout',
    },
    {
      id: 'admin-accounting-hr',
      title: 'Admin / Accounting / HR Tools',
      description: 'Internal tooling for compliance, reporting, and admin workflows. Removes friction and scales operations with improved reliability and control.',
      difficulty: 'Medium',
      estimatedHours: '40-60 hours',
      resourcesUsed: [],
      benefits: [
        'Remove operational friction',
        'Scale operations',
        'Improve reliability',
        'Copilot for compliance workflows',
      ],
      prerequisites: ['Process mapping', 'Compliance rules', 'Workflow automation'],
      apiEndpoints: [],
      category: 'Admin',
      opsProcess: 'Invoicing & Reconciliation',
      currentLOA: 'Manual',
      potentialLOA: 'Medium Automation',
      missingApiData: ['Accounting integrations', 'HR data access'],
      priority: 'Low',
      stage: 'Planned',
      primaryUsers: ['Ops', 'Admin', 'HR'],
      integrationsNeeded: ['Accounting', 'Reporting systems'],
      dataStatus: 'None',
      nextMilestone: 'Map processes + define top 3 automations',
    },
  ];
}

export function generateProjectProposals(data: DashboardData): ProjectProposal[] {
  const proposals: ProjectProposal[] = [];

  // =============================================================================
  // HAND-OFF PHASE PROJECTS
  // =============================================================================

  proposals.push({
    id: 'dynamic-allocation-engine',
    title: 'Dynamic Installer Allocation Engine',
    description: 'AI-powered real-time lead-to-installer matching system. Scores installers based on region, capacity, historical conversion, SLA compliance, and customer preferences. Replaces manual Google Sheets allocation with automated decisions.',
    difficulty: 'Hard',
    estimatedHours: '50-70 hours',
    resourcesUsed: ['Deals', 'Opportunities', 'Regions', 'Installers'],
    benefits: [
      'Instant lead assignment (vs. manual decision time)',
      'Optimized distribution based on conversion data',
      'Automatic quota balancing across installers',
      'Deviation alerts when targets drift >15%',
    ],
    prerequisites: ['Scoring algorithm design', 'Real-time event processing', 'Admin config panel'],
    apiEndpoints: ['/internal/deals', '/internal/opportunities', '/internal/regions', '/internal/installers', '/internal/regions/{id}/quotas'],
    category: 'Hand-Off',
    opsProcess: 'Assignation per installer',
    currentLOA: 'Manual (Google Sheets)',
    potentialLOA: 'High Automation',
    missingApiData: [
      'Installer capacity/availability endpoint',
      'Monthly weight targets per region/installer',
      'Real-time deviation calculations',
      'Installer performance scores (conversion rate, speed-to-contact)',
    ],
    priority: 'Critical',
  });

  proposals.push({
    id: 'ai-qualification-notes',
    title: 'AI Qualification Notes Generator',
    description: 'Consolidate SDR comments, call transcripts, and qualification data into structured, standardized notes for installers. Include deal temperature, preferred contact times, and key customer motivations.',
    difficulty: 'Medium',
    estimatedHours: '30-40 hours',
    resourcesUsed: ['Deals', 'Qualifications', 'Calls'],
    benefits: [
      'Consistent note quality across all SDRs',
      'Faster installer onboarding per lead',
      'Reduced "temperature was off" feedback',
      'Structured data for ML training',
    ],
    prerequisites: ['LLM integration (GPT-4)', 'Prompt engineering', 'Zoho field mapping'],
    apiEndpoints: ['/internal/deals', '/internal/qualifications', '/internal/calls'],
    category: 'Hand-Off',
    opsProcess: 'AI Qualification Notes',
    currentLOA: 'Semi-Automated',
    potentialLOA: 'High Automation',
    missingApiData: [
      'Call transcripts endpoint',
      'SDR comments field',
      'Deal temperature field',
      'Customer preferred channel/time preferences',
    ],
    priority: 'High',
  });

  proposals.push({
    id: 'handoff-whatsapp-automation',
    title: 'Post-Handoff WhatsApp Automation',
    description: 'Automatically send WhatsApp messages to customers after installer assignment with: installer name, expected call time, and contact number. Include 24h follow-up nudge if no contact made.',
    difficulty: 'Easy',
    estimatedHours: '15-20 hours',
    resourcesUsed: ['Deals', 'Templates', 'Opportunities', 'Installers'],
    benefits: [
      'Customer knows who will call and when',
      'Reduced missed calls from unknown numbers',
      'Automatic follow-up reduces drop-off',
      'Better customer experience post-qualification',
    ],
    prerequisites: ['WhatsApp Business API (Woztell)', 'Template approval'],
    apiEndpoints: ['/internal/deals', '/internal/templates', '/internal/opportunities', '/internal/deals/{id}/messages'],
    category: 'Hand-Off',
    opsProcess: 'Call transfer and scheduling',
    currentLOA: 'Not Implemented',
    potentialLOA: 'High Automation',
    missingApiData: [
      'Installer contact details (rep name, phone)',
      'Customer preferred time slot field',
      'Message send status tracking',
    ],
    priority: 'High',
  });

  proposals.push({
    id: 'installer-feedback-dashboard',
    title: 'Installer Feedback Collection Dashboard',
    description: 'Track installer feedback per lead: temperature accuracy, missing details, lead viability. Use to refine AI prompts, coach SDRs, and improve qualification structure.',
    difficulty: 'Medium',
    estimatedHours: '25-35 hours',
    resourcesUsed: ['Opportunities', 'Installers', 'Lost Reasons', 'Deals'],
    benefits: [
      'Systematic feedback collection',
      'Identify qualification gaps by pattern',
      'Coach SDRs with real examples',
      'Continuous prompt improvement',
    ],
    prerequisites: ['Feedback form/API', 'Dashboard with filtering'],
    apiEndpoints: ['/internal/opportunities', '/internal/installers', '/internal/lost-reasons'],
    category: 'Hand-Off',
    opsProcess: 'Installer/Customer Feedback Collection',
    currentLOA: 'Manual',
    potentialLOA: 'High Automation',
    missingApiData: [
      'Installer feedback endpoint (per opportunity)',
      'Feedback categories (temperature off, detail missing, etc.)',
      'Feedback timestamps and installer ID',
    ],
    priority: 'Medium',
  });

  // =============================================================================
  // QUALIFICATION PHASE PROJECTS
  // =============================================================================

  proposals.push({
    id: 'contact-prioritization-engine',
    title: 'AI Contact Prioritization System',
    description: 'SDR Portal feature that ranks contacts by conversion probability, optimal contact time, and channel preference. Shows "next best call" recommendations based on historical patterns.',
    difficulty: 'Hard',
    estimatedHours: '45-60 hours',
    resourcesUsed: ['Deals', 'Calls', 'Qualifications'],
    benefits: [
      'Higher answer rates from optimal timing',
      'SDRs focus on highest-value contacts',
      'Reduced time deciding who to call',
      'Data-driven working hours optimization',
    ],
    prerequisites: ['ML model for contact scoring', 'Real-time queue management', 'SDR Portal integration'],
    apiEndpoints: ['/internal/deals', '/internal/calls', '/internal/calls/stats', '/internal/qualifications'],
    category: 'SDR Portal',
    opsProcess: 'Contact prioritization',
    currentLOA: 'Manual',
    potentialLOA: 'High Automation',
    missingApiData: [
      'Historical contact attempt times',
      'Answer rate by time-of-day/day-of-week',
      'Customer timezone/preferred hours',
      'SDR availability calendar',
    ],
    priority: 'Critical',
  });

  proposals.push({
    id: 'recycling-workflow-automation',
    title: 'Lead Recycling Workflow System',
    description: 'Automatic flagging and reassignment of recyclable leads based on installer CRM feedback. Track recycling outcomes and optimize re-engagement timing.',
    difficulty: 'Medium',
    estimatedHours: '30-40 hours',
    resourcesUsed: ['Deals', 'Opportunities', 'Lost Reasons', 'Calls'],
    benefits: [
      'Recover lost revenue from recyclable leads',
      'Automatic re-assignment without manual review',
      'Track recycling success rates',
      'Optimize timing for re-engagement',
    ],
    prerequisites: ['Installer CRM integrations', 'Recycling rules engine'],
    apiEndpoints: ['/internal/deals', '/internal/opportunities', '/internal/lost-reasons'],
    category: 'Qualification',
    opsProcess: 'Recycling Workflow',
    currentLOA: 'Semi-Automated',
    potentialLOA: 'High Automation',
    missingApiData: [
      'Recyclable flag on lost reasons',
      'Recycling attempt count per deal',
      'Installer CRM webhook events',
      'Re-engagement cooldown rules',
    ],
    priority: 'High',
  });

  proposals.push({
    id: 'answer-rate-monitoring',
    title: 'SIM/Number Answer Rate Monitor',
    description: 'Track answer rates and spam flags per phone number. Alert when numbers need rotation. Proactive SIM card management to maintain high contact rates.',
    difficulty: 'Easy',
    estimatedHours: '15-25 hours',
    resourcesUsed: ['Calls', 'Unmatched Calls'],
    benefits: [
      'Maintain high answer rates',
      'Proactive SIM rotation before spam flags',
      'Identify best-performing numbers',
      'Reduce wasted call attempts',
    ],
    prerequisites: ['Aircall integration', 'Alerting system'],
    apiEndpoints: ['/internal/calls', '/internal/calls/stats', '/internal/unmatched-calls'],
    category: 'Qualification',
    opsProcess: 'Answer Rate Monitoring',
    currentLOA: 'Manual',
    potentialLOA: 'Medium Automation',
    missingApiData: [
      'Outbound number identifier per call',
      'Spam flag detection',
      'Answer rate aggregation by number',
    ],
    priority: 'Medium',
  });

  proposals.push({
    id: 'whatsapp-conversation-summary',
    title: 'WhatsApp Conversation AI Summary',
    description: 'AI-powered summary of WhatsApp conversations to speed up SDR call preparation. Extract key points, customer concerns, and suggested talking points.',
    difficulty: 'Medium',
    estimatedHours: '25-35 hours',
    resourcesUsed: ['Deals', 'Templates'],
    benefits: [
      'Faster call prep for SDRs',
      'No context loss between channels',
      'Consistent information across team',
      'Better customer experience (no repetition)',
    ],
    prerequisites: ['LLM integration', 'WhatsApp message history access'],
    apiEndpoints: ['/internal/deals', '/internal/deals/{id}/messages', '/internal/templates'],
    category: 'SDR Portal',
    opsProcess: 'Calls & WhatsApp',
    currentLOA: 'Semi-Automated',
    potentialLOA: 'High Automation',
    missingApiData: [
      'Full WhatsApp conversation history endpoint',
      'Message timestamps and direction',
      'Conversation summary field in deals',
    ],
    priority: 'Critical',
  });

  proposals.push({
    id: 'chatbot-ab-testing',
    title: 'Chatbot A/B Testing & Analytics Platform',
    description: 'Track per-template success rates, drop-off points, and escalation triggers. Enable controlled A/B tests on bot flows with automatic winner detection.',
    difficulty: 'Medium',
    estimatedHours: '35-45 hours',
    resourcesUsed: ['Templates', 'Deals'],
    benefits: [
      'Data-driven template optimization',
      'Identify failing flows quickly',
      'Reduce escalation burden',
      'Continuous bot improvement',
    ],
    prerequisites: ['Botpress/chatbot integration', 'Event tracking system'],
    apiEndpoints: ['/internal/templates', '/internal/deals'],
    category: 'Qualification',
    opsProcess: 'Chatbot Optimization',
    currentLOA: 'Manual',
    potentialLOA: 'High Automation',
    missingApiData: [
      'Chatbot conversation events endpoint',
      'Template performance metrics (reply rate, success rate)',
      'A/B test variant tracking',
      'Escalation event logging',
    ],
    priority: 'Medium',
  });

  // =============================================================================
  // LEAD ACQUISITION PHASE PROJECTS
  // =============================================================================

  proposals.push({
    id: 'provider-roi-dashboard',
    title: 'Lead Provider ROI Dashboard',
    description: 'Real-time view of CPL, qualification rate, and conversion by provider and region. Automatic budget reallocation suggestions based on performance.',
    difficulty: 'Medium',
    estimatedHours: '30-40 hours',
    resourcesUsed: ['Deals', 'Opportunities', 'Regions'],
    benefits: [
      'Optimize budget allocation in real-time',
      'Identify underperforming providers quickly',
      'Track CPL trends over time',
      'Data-driven provider negotiations',
    ],
    prerequisites: ['Provider tracking in deals', 'Financial calculations'],
    apiEndpoints: ['/internal/deals', '/internal/deals/stats', '/internal/opportunities/stats', '/internal/regions'],
    category: 'Lead Acquisition',
    opsProcess: 'Budget Allocation Process',
    currentLOA: 'Manual',
    potentialLOA: 'Medium Automation',
    missingApiData: [
      'Lead provider/source field',
      'CPL per provider',
      'Provider agreement terms',
      'Monthly budget caps per provider',
    ],
    priority: 'High',
  });

  proposals.push({
    id: 'lead-validation-automation',
    title: 'Automated Lead Validation & Quality Control',
    description: 'Pre-flag invalid leads using AI before SDR contact. Auto-generate weekly validation reports for providers. Track rejection rates by provider/region.',
    difficulty: 'Medium',
    estimatedHours: '25-35 hours',
    resourcesUsed: ['Deals', 'Qualifications'],
    benefits: [
      'Reduce SDR time on invalid leads',
      'Faster provider feedback cycles',
      'Consistent validation criteria',
      'Automated rejection documentation',
    ],
    prerequisites: ['Validation rules engine', 'Provider reporting templates'],
    apiEndpoints: ['/internal/deals', '/internal/qualifications'],
    category: 'Lead Acquisition',
    opsProcess: 'Validation & Quality Control',
    currentLOA: 'Semi-Automated',
    potentialLOA: 'High Automation',
    missingApiData: [
      'Validation status field',
      'Rejection reason categories',
      'Provider ID on deals',
      'Validation timestamp',
    ],
    priority: 'Medium',
  });

  proposals.push({
    id: 'api-self-service-portal',
    title: 'Provider API Self-Service Portal',
    description: 'Self-service portal for lead providers to test API payloads, view integration status, and access documentation. Includes real-time webhook monitoring and error logs.',
    difficulty: 'Hard',
    estimatedHours: '45-60 hours',
    resourcesUsed: ['Deals'],
    benefits: [
      'Faster provider onboarding',
      'Reduced support burden',
      'Self-service troubleshooting',
      'Better integration quality',
    ],
    prerequisites: ['Authentication system', 'Webhook monitoring', 'Documentation generation'],
    apiEndpoints: ['/internal/deals'],
    category: 'Lead Acquisition',
    opsProcess: 'API/CRM Integrations & Onboarding',
    currentLOA: 'Manual',
    potentialLOA: 'High Automation',
    missingApiData: [
      'Provider authentication tokens',
      'Webhook delivery logs',
      'Integration health status per provider',
      'Error rate tracking',
    ],
    priority: 'Medium',
  });

  // =============================================================================
  // PARTNER MANAGEMENT PHASE PROJECTS
  // =============================================================================

  proposals.push({
    id: 'installer-performance-portal',
    title: 'Installer Performance Portal',
    description: 'Self-service dashboard for installers showing: leads received, conversion rates, ROI, SLA compliance, and comparison to targets. Includes score degradation alerts.',
    difficulty: 'Hard',
    estimatedHours: '60-80 hours',
    resourcesUsed: ['Installers', 'Opportunities', 'Deals', 'Regions', 'Lost Reasons'],
    benefits: [
      'Transparent performance tracking',
      'Self-service reduces back-and-forth',
      'Motivates improvement through visibility',
      'Fair lead distribution justification',
    ],
    prerequisites: ['Installer authentication', 'Role-based access', 'Real-time calculations'],
    apiEndpoints: ['/internal/installers', '/internal/opportunities', '/internal/opportunities/stats', '/internal/regions/{id}/quotas', '/internal/lost-reasons'],
    category: 'Installers Portal',
    opsProcess: 'Partner ROI Tracking',
    currentLOA: 'Manual',
    potentialLOA: 'High Automation',
    missingApiData: [
      'Installer login/auth endpoint',
      'Per-installer conversion metrics',
      'SLA tracking (time-to-contact, etc.)',
      'Score calculation formula',
    ],
    priority: 'Critical',
  });

  proposals.push({
    id: 'installer-sla-monitoring',
    title: 'Installer SLA & Conversion Monitoring',
    description: 'Real-time tracking of installer SLA compliance: time-to-contact, follow-up frequency, stage update delays. Auto-alerts for SLA breaches.',
    difficulty: 'Medium',
    estimatedHours: '30-40 hours',
    resourcesUsed: ['Opportunities', 'Installers'],
    benefits: [
      'Ensure consistent service levels',
      'Early warning for underperformers',
      'Data for partner conversations',
      'Protect customer experience',
    ],
    prerequisites: ['SLA rules configuration', 'Alerting system'],
    apiEndpoints: ['/internal/opportunities', '/internal/installers'],
    category: 'Partner Management',
    opsProcess: 'Conversion & SLA Monitoring',
    currentLOA: 'Manual',
    potentialLOA: 'High Automation',
    missingApiData: [
      'Opportunity stage timestamps',
      'First contact timestamp',
      'SLA thresholds per installer',
      'Alert configuration endpoint',
    ],
    priority: 'High',
  });

  proposals.push({
    id: 'installer-quote-sync',
    title: 'Installer Quote Sync System',
    description: 'Collect final offer amounts from installers via webhook, form, or portal. Enables financing integration and accurate ROI tracking.',
    difficulty: 'Medium',
    estimatedHours: '25-35 hours',
    resourcesUsed: ['Opportunities', 'Installers', 'Deals'],
    benefits: [
      'Enable financing partnerships',
      'Accurate revenue tracking',
      'Price benchmarking across installers',
      'Better forecasting',
    ],
    prerequisites: ['Webhook endpoint for installers', 'Data validation'],
    apiEndpoints: ['/internal/opportunities', '/internal/installers'],
    category: 'Installers Portal',
    opsProcess: 'Financing Partnerships',
    currentLOA: 'Not Implemented',
    potentialLOA: 'Medium Automation',
    missingApiData: [
      'Offer amount field on opportunities',
      'Offer timestamp',
      'Installer webhook POST endpoint',
      'Pricing baseline data',
    ],
    priority: 'Medium',
  });

  proposals.push({
    id: 'automated-invoicing',
    title: 'Automated Provider & Partner Invoicing',
    description: 'Auto-generate monthly invoices for lead providers (based on validation results) and installers (based on won opportunities). Reconciliation with rejection tracking.',
    difficulty: 'Medium',
    estimatedHours: '35-45 hours',
    resourcesUsed: ['Deals', 'Opportunities', 'Installers'],
    benefits: [
      'Hours saved on manual invoicing',
      'Fewer billing disputes',
      'Automatic reconciliation',
      'Clear audit trail',
    ],
    prerequisites: ['Accounting rules engine', 'PDF generation', 'Email integration'],
    apiEndpoints: ['/internal/deals', '/internal/deals/stats', '/internal/opportunities', '/internal/opportunities/stats'],
    category: 'Partner Management',
    opsProcess: 'Invoicing & Reconciliation',
    currentLOA: 'Manual',
    potentialLOA: 'Medium Automation',
    missingApiData: [
      'Provider pricing/CPL data',
      'Validation status for invoicing',
      'Won opportunity revenue',
      'Invoice line item breakdown',
    ],
    priority: 'Low',
  });

  // =============================================================================
  // AI/ML PROJECTS
  // =============================================================================

  proposals.push({
    id: 'lead-temperature-predictor',
    title: 'AI Lead Temperature Predictor',
    description: 'ML model that predicts deal temperature (Hot/Warm/Cold) based on qualification data, engagement patterns, and historical outcomes. Assist SDRs in temperature assignment.',
    difficulty: 'Hard',
    estimatedHours: '50-70 hours',
    resourcesUsed: ['Deals', 'Qualifications', 'Calls', 'Opportunities'],
    benefits: [
      'Consistent temperature assignment',
      'Reduce "temperature was off" installer feedback',
      'Prioritize hot leads automatically',
      'Train new SDRs faster',
    ],
    prerequisites: ['ML pipeline', 'Historical labeled data', 'Model serving infrastructure'],
    apiEndpoints: ['/internal/deals', '/internal/qualifications', '/internal/calls', '/internal/opportunities'],
    category: 'AI/ML',
    opsProcess: 'AI Qualification Notes',
    currentLOA: 'Manual (SDR judgment)',
    potentialLOA: 'High Automation',
    missingApiData: [
      'Historical temperature labels',
      'Temperature outcome validation (was it accurate?)',
      'Engagement metrics (messages, calls, response times)',
    ],
    priority: 'High',
  });

  proposals.push({
    id: 'lost-deal-pattern-analyzer',
    title: 'Lost Deal Pattern Analyzer & Alert System',
    description: 'ML-powered analysis of lost deals to identify patterns by region, installer, source, and time. Proactive alerts for at-risk deals based on early warning signals.',
    difficulty: 'Hard',
    estimatedHours: '45-60 hours',
    resourcesUsed: ['Deals', 'Opportunities', 'Lost Reasons', 'Installers', 'Regions'],
    benefits: [
      'Understand systematic loss patterns',
      'Intervene before deals are lost',
      'Coach installers on specific issues',
      'Improve qualification criteria',
    ],
    prerequisites: ['Pattern recognition algorithms', 'Alerting infrastructure'],
    apiEndpoints: ['/internal/deals', '/internal/opportunities', '/internal/lost-reasons', '/internal/deals/{id}/stage-changes'],
    category: 'AI/ML',
    opsProcess: 'Partner ROI Tracking',
    currentLOA: 'Manual',
    potentialLOA: 'High Automation',
    missingApiData: [
      'Deal stage change history with timestamps',
      'Lost reason linked to specific deal attributes',
      'Installer-specific loss patterns',
    ],
    priority: 'Medium',
  });

  proposals.push({
    id: 'optimal-contact-time-model',
    title: 'Optimal Contact Time Predictor',
    description: 'ML model that predicts the best time and channel to contact each lead based on historical answer patterns, timezone, and stated preferences.',
    difficulty: 'Medium',
    estimatedHours: '35-45 hours',
    resourcesUsed: ['Deals', 'Calls'],
    benefits: [
      'Higher answer rates',
      'Fewer wasted call attempts',
      'Better customer experience',
      'SDR efficiency improvement',
    ],
    prerequisites: ['Time-series analysis', 'Customer preference data'],
    apiEndpoints: ['/internal/deals', '/internal/calls', '/internal/calls/stats'],
    category: 'AI/ML',
    opsProcess: 'Contact prioritization',
    currentLOA: 'Manual',
    potentialLOA: 'High Automation',
    missingApiData: [
      'Call attempt timestamps with outcomes',
      'Customer stated preferences',
      'Regional time patterns',
    ],
    priority: 'High',
  });

  // =============================================================================
  // REPORTING PROJECTS
  // =============================================================================

  proposals.push({
    id: 'weekly-performance-digest',
    title: 'Automated Weekly Performance Digest',
    description: 'Auto-generated weekly report with: deals by stage, conversion rates, SDR performance, installer metrics, and provider ROI. Sent to stakeholders with key action items.',
    difficulty: 'Medium',
    estimatedHours: '25-35 hours',
    resourcesUsed: ['Deals', 'Opportunities', 'Calls', 'Installers', 'Regions'],
    benefits: [
      'Consistent weekly visibility',
      'Hours saved on manual reporting',
      'Highlight key actions needed',
      'Historical trend tracking',
    ],
    prerequisites: ['Report templating', 'Email/Slack integration', 'PDF generation'],
    apiEndpoints: ['/internal/deals/stats', '/internal/opportunities/stats', '/internal/calls/stats'],
    category: 'Lead Acquisition',
    opsProcess: 'Performance Reporting',
    currentLOA: 'Manual',
    potentialLOA: 'High Automation',
    missingApiData: [
      'Week-over-week comparison data',
      'SDR-level performance breakdown',
      'Provider-level aggregations',
    ],
    priority: 'Medium',
  });

  proposals.push({
    id: 'gdpr-compliance-tracker',
    title: 'GDPR Compliance & Consent Tracker',
    description: 'Track consent status for every lead, opt-out requests, and data retention compliance. Auto-anonymize expired leads and generate compliance audit reports.',
    difficulty: 'Medium',
    estimatedHours: '30-40 hours',
    resourcesUsed: ['Deals', 'Qualifications'],
    benefits: [
      'Legal compliance assurance',
      'Automated data retention',
      'Audit-ready reports',
      'Customer trust protection',
    ],
    prerequisites: ['Consent tracking system', 'Data retention rules', 'Anonymization logic'],
    apiEndpoints: ['/internal/deals', '/internal/qualifications'],
    category: 'Qualification',
    opsProcess: 'GDPR & Law Compliance',
    currentLOA: 'Not Implemented',
    potentialLOA: 'Medium Automation',
    missingApiData: [
      'Consent flag and source per deal',
      'Consent timestamp',
      'Opt-out tracking',
      'Data retention policy configuration',
    ],
    priority: 'Medium',
    stage: 'Idea',
    primaryUsers: ['Ops', 'Legal'],
    integrationsNeeded: ['CRM', 'Data retention system'],
    dataStatus: 'None',
    nextMilestone: 'Define retention policy + consent tracking fields',
  });

  // Add default fields to all proposals that don't have them
  const enrichedProposals = proposals.map((p, index) => ({
    ...p,
    stage: p.stage || 'Idea' as ProjectStage,
    primaryUsers: p.primaryUsers || ['Ops'],
    integrationsNeeded: p.integrationsNeeded || [],
    dataStatus: p.dataStatus || 'None' as const,
    nextMilestone: p.nextMilestone || '',
    rank: index + 100, // Ideas come after existing products
  }));

  // Merge with existing products (they come first)
  const existingProducts = getExistingProducts().map((p, index) => ({
    ...p,
    rank: index + 1,
  }));

  return [...existingProducts, ...enrichedProposals];
}
