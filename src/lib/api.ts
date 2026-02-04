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
// ABETO PRODUCT & INITIATIVE SYSTEM
// =============================================================================
//
// THE THREE PILLARS OF SCALABLE GROWTH:
//
// 🏗️ PILLAR 1: DATA FOUNDATION
//    Without reliable, real-time data, nothing else works. This is the bedrock.
//    Tools need data to be useful. Dashboards need data to show insights.
//    AI needs data to learn. Automation needs data to act.
//
// 🚀 PILLAR 2: DATA GENERATION
//    The goal isn't just to automate - it's to GROW. More leads, more calls,
//    more qualifications, more sales, more partners. Tools that help generate
//    new data become exponentially more powerful as they feed themselves.
//
// 👥 PILLAR 3: HUMAN EMPOWERMENT
//    Humans will ALWAYS be essential. New employees, new installers, new
//    customers - the business grows through people. AI tools empower humans
//    to do more, not replace them. Every project should clarify how humans
//    and AI work together.
//
// =============================================================================

export type ProjectStage = 'Deployed' | 'Under Dev' | 'Pilot' | 'Planned' | 'Idea';
export type ProjectPillar = 'Data Foundation' | 'Knowledge Generation' | 'Human Empowerment';
export type ProjectCategory = 'Data Layer' | 'Lead Generation' | 'SDR Tools' | 'Partner Growth' | 'Installer Tools' | 'Reporting & Intelligence' | 'Marketing & Campaigns' | 'Operations' | 'Platform Infrastructure';

export interface ProjectProposal {
  id: string;
  title: string;
  description: string;

  // Strategic positioning
  pillar: ProjectPillar;
  pillarOrder: number; // 1, 2, or 3 for sorting within pillars
  whyItMatters: string; // The "so what?" explanation

  // Human role - critical for conveying the message
  humanRole: {
    before: string; // What humans do today
    after: string;  // What humans do after this is deployed
    whoIsEmpowered: string[]; // Which roles benefit
    newCapabilities: string[]; // What can they do now that they couldn't before
  };

  // Technical details
  difficulty: 'Easy' | 'Medium' | 'Hard';
  estimatedHours: string;
  resourcesUsed: string[];
  apiEndpoints: string[];

  // Dependencies and relationships
  dependsOn: string[]; // IDs of projects this depends on
  enables: string[]; // IDs of projects this enables
  relatedTo: string[]; // IDs of related projects

  // Data requirements - THE MOST IMPORTANT SECTION
  dataRequirements: {
    required: string[]; // Data that MUST exist
    generates: string[]; // New data this project creates
    improves: string[]; // Existing data this project enriches
  };

  // Status and planning
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  stage?: ProjectStage;
  prototypeUrl?: string;
  notionUrl?: string;
  primaryUsers?: string[];
  dataStatus?: 'Live' | 'Partial' | 'Static' | 'None';
  nextMilestone?: string;

  // Legacy fields for compatibility
  benefits: string[];
  prerequisites: string[];
  category: ProjectCategory;
  opsProcess: string;
  currentLOA: string;
  potentialLOA: string;
  missingApiData: string[];
  integrationsNeeded?: string[];
  rank?: number;
}

// =============================================================================
// COMPLETE PRODUCT & INITIATIVE CATALOG
// Organized by the Three Pillars of Scalable Growth
// =============================================================================

export function getExistingProducts(): ProjectProposal[] {
  return [
    // =========================================================================
    // 🏗️ PILLAR 1: DATA FOUNDATION
    // Without reliable, real-time data, NOTHING ELSE WORKS
    // =========================================================================
    {
      id: 'unified-data-layer',
      title: 'Unified Data Layer (API)',
      description: 'The foundation of everything. Real-time access to all business data through a single, reliable API. Currently serving Deals, Opportunities, Calls, Qualifications, Installers, Regions, Templates, and Lost Reasons. This is the bedrock upon which all other tools are built.',
      pillar: 'Data Foundation',
      pillarOrder: 1,
      whyItMatters: 'Every dashboard, every AI feature, every automation depends on this. If data is unreliable or unavailable, nothing else matters. This API is the single source of truth.',
      humanRole: {
        before: 'Data scattered across Zoho, spreadsheets, WhatsApp. Hours spent manually compiling reports.',
        after: 'Data available instantly via API. Humans focus on decision-making, not data gathering.',
        whoIsEmpowered: ['All Teams', 'Developers', 'Operations'],
        newCapabilities: ['Real-time dashboards', 'Automated reporting', 'AI-powered insights', 'Cross-system integrations'],
      },
      difficulty: 'Hard',
      estimatedHours: 'Ongoing',
      resourcesUsed: ['Deals', 'Opportunities', 'Calls', 'Qualifications', 'Installers', 'Regions', 'Templates', 'Lost Reasons'],
      apiEndpoints: ['All /internal/* endpoints'],
      dependsOn: [],
      enables: ['reporting-hub', 'ai-cortex', 'sdr-portal', 'installer-portal-product'],
      relatedTo: ['data-quality-monitor'],
      dataRequirements: {
        required: ['Zoho CRM access', 'WhatsApp webhooks', 'Telephony events'],
        generates: ['Unified data model', 'Real-time events', 'Historical records'],
        improves: ['Data consistency', 'Access speed', 'Reliability'],
      },
      benefits: ['Single source of truth', 'Real-time data access', 'Foundation for AI/automation', 'Enables all other products'],
      prerequisites: ['Database infrastructure', 'API framework', 'Authentication system'],
      category: 'Data Layer',
      opsProcess: 'All data operations',
      currentLOA: 'Automated',
      potentialLOA: 'Fully Automated',
      missingApiData: ['Call transcripts', 'WhatsApp full history', 'Financial data'],
      priority: 'Critical',
      stage: 'Deployed',
      prototypeUrl: 'https://abeto-backend.vercel.app/api/docs',
      primaryUsers: ['Developers', 'All Products'],
      integrationsNeeded: ['Zoho', 'Woztell', 'Aircall'],
      dataStatus: 'Live',
      nextMilestone: 'Add call transcripts + WhatsApp conversation history',
    },
    {
      id: 'reporting-hub',
      title: 'Reporting Hub',
      description: 'Central performance visibility. The single source of truth for all KPIs, supporting both human decision-making and AI insights (Cortex). Without accurate, real-time metrics, we cannot measure success or identify problems.',
      pillar: 'Data Foundation',
      pillarOrder: 2,
      whyItMatters: 'You cannot improve what you cannot measure. This hub ensures everyone sees the same numbers and understands how the business is performing.',
      humanRole: {
        before: 'Leadership spends hours in spreadsheets. Different people report different numbers. Decisions based on outdated data.',
        after: 'Leadership opens one dashboard for truth. Humans focus on analyzing trends and making strategic decisions.',
        whoIsEmpowered: ['Leadership', 'Operations', 'Team Leads'],
        newCapabilities: ['Real-time performance tracking', 'Historical trend analysis', 'Anomaly detection', 'Goal tracking'],
      },
      difficulty: 'Medium',
      estimatedHours: '50-70 hours',
      resourcesUsed: ['Deals', 'Opportunities', 'Calls', 'Installers', 'Regions'],
      apiEndpoints: ['/internal/deals/stats', '/internal/opportunities/stats', '/internal/calls/stats'],
      dependsOn: ['unified-data-layer'],
      enables: ['ai-cortex', 'investor-portal', 'installer-performance-tracking'],
      relatedTo: ['data-quality-monitor'],
      dataRequirements: {
        required: ['Deal pipeline data', 'Opportunity outcomes', 'Call metrics', 'Installer performance'],
        generates: ['KPI snapshots', 'Trend calculations', 'Benchmark comparisons'],
        improves: ['Decision accuracy', 'Goal alignment', 'Team accountability'],
      },
      benefits: ['Single source of truth for KPIs', 'Supports Cortex insights', 'Cross-team visibility', 'Performance benchmarking'],
      prerequisites: ['KPI definitions agreed', 'Historical data available', 'Dashboard framework'],
      category: 'Reporting & Intelligence',
      opsProcess: 'Performance Reporting',
      currentLOA: 'Manual',
      potentialLOA: 'High Automation',
      missingApiData: ['Historical data aggregation', 'Cross-pipeline metrics'],
      priority: 'High',
      stage: 'Under Dev',
      prototypeUrl: 'https://abeto-reporting.vercel.app/',
      primaryUsers: ['Leadership', 'Ops'],
      integrationsNeeded: ['Unified Data Layer'],
      dataStatus: 'Partial',
      nextMilestone: 'Define KPI set + build v1 dashboard',
    },
    {
      id: 'data-quality-monitor',
      title: 'Data Quality Monitor',
      description: 'Automated monitoring of data health, completeness, and freshness. Alerts when data is missing, stale, or inconsistent. Critical for maintaining trust in all other systems.',
      pillar: 'Data Foundation',
      pillarOrder: 3,
      whyItMatters: 'Bad data leads to bad decisions. This ensures we catch data problems before they cascade into business problems.',
      humanRole: {
        before: 'Data issues discovered by accident when reports look wrong. Fire-fighting mode.',
        after: 'Humans receive proactive alerts about data issues. Focus shifts to prevention and root cause analysis.',
        whoIsEmpowered: ['Operations', 'Tech Team', 'Data Stewards'],
        newCapabilities: ['Proactive issue detection', 'Data lineage tracking', 'Quality scoring', 'Automated remediation'],
      },
      difficulty: 'Medium',
      estimatedHours: '30-40 hours',
      resourcesUsed: ['All resources'],
      apiEndpoints: ['All endpoints'],
      dependsOn: ['unified-data-layer'],
      enables: ['ai-cortex'],
      relatedTo: ['reporting-hub'],
      dataRequirements: {
        required: ['Access to all data sources', 'Historical baselines'],
        generates: ['Quality scores', 'Freshness metrics', 'Completeness reports', 'Alert history'],
        improves: ['Data reliability', 'Trust in systems', 'Issue response time'],
      },
      benefits: ['Early problem detection', 'Maintains data trust', 'Reduces downstream errors', 'Enables confident automation'],
      prerequisites: ['Define quality rules', 'Set up alerting', 'Historical baselines'],
      category: 'Data Layer',
      opsProcess: 'Data governance',
      currentLOA: 'Not Implemented',
      potentialLOA: 'High Automation',
      missingApiData: ['Quality metrics endpoints'],
      priority: 'High',
      stage: 'Idea',
      primaryUsers: ['Ops', 'Tech'],
      integrationsNeeded: ['Slack/Email alerts'],
      dataStatus: 'None',
      nextMilestone: 'Define quality rules + build monitoring dashboard',
    },

    // =========================================================================
    // 🚀 PILLAR 2: DATA GENERATION
    // The goal is GROWTH. More leads, more calls, more sales, more partners.
    // =========================================================================
    {
      id: 'campaign-os',
      title: 'Campaign OS (Lead Generation)',
      description: 'Generates NEW LEADS through optimized paid media campaigns. Multi-channel dashboard, spend-to-CRM mapping, and AI-powered creative suggestions. The more leads we generate, the more data we have, the smarter our systems become.',
      pillar: 'Knowledge Generation',
      pillarOrder: 1,
      whyItMatters: 'Leads are the lifeblood of the business. This tool helps generate MORE leads, not just manage existing ones. Every new lead feeds the entire system.',
      humanRole: {
        before: 'Marketing manually manages campaigns across platforms. Limited visibility into what works.',
        after: 'Marketing focuses on creative strategy and market insights. AI handles optimization and scaling.',
        whoIsEmpowered: ['Marketing', 'Growth', 'Leadership'],
        newCapabilities: ['Cross-platform optimization', 'AI creative suggestions', 'Real-time ROI tracking', 'Automated bid management'],
      },
      difficulty: 'Hard',
      estimatedHours: '70-90 hours',
      resourcesUsed: ['Deals', 'Qualifications'],
      apiEndpoints: ['/internal/deals', '/internal/deals/stats'],
      dependsOn: ['unified-data-layer', 'reporting-hub'],
      enables: ['ai-cortex'],
      relatedTo: ['funnel-automation-os'],
      dataRequirements: {
        required: ['UTM tracking', 'Ad platform APIs', 'Conversion data'],
        generates: ['NEW LEADS', 'Campaign performance data', 'Attribution insights', 'Creative performance'],
        improves: ['Lead quality', 'CAC efficiency', 'Channel mix'],
      },
      benefits: ['Scale lead volume 2-3×', 'Optimization moat via data', 'AI-driven creative angles', 'Cross-platform insights'],
      prerequisites: ['Ad platform APIs (Meta, Google, TikTok)', 'Attribution modeling', 'UTM infrastructure'],
      category: 'Lead Generation',
      opsProcess: 'Paid Media Optimization',
      currentLOA: 'Manual',
      potentialLOA: 'High Automation',
      missingApiData: ['UTM tracking', 'Ad spend data', 'Attribution paths'],
      priority: 'High',
      stage: 'Pilot',
      prototypeUrl: 'https://claude.ai/public/artifacts/f4b89609-1d66-4cd5-ac68-178efb49891a',
      primaryUsers: ['Marketing', 'Growth'],
      integrationsNeeded: ['Meta', 'Google', 'TikTok', 'Zoho'],
      dataStatus: 'Static',
      nextMilestone: 'Live ad platform sync + automated optimization',
    },
    {
      id: 'partner-expansion-tool',
      title: 'Partner Expansion Engine',
      description: 'Generates NEW PARTNERS (installers) through automated outreach, scoring, and onboarding. More partners = more capacity = more sales. Each new partner expands our ability to serve customers.',
      pillar: 'Knowledge Generation',
      pillarOrder: 2,
      whyItMatters: 'Growth is limited by installer capacity. This tool systematically expands our partner network, directly enabling more sales.',
      humanRole: {
        before: 'BizDev manually researches, contacts, and onboards installers. Bottleneck on one person.',
        after: 'BizDev focuses on relationship building and strategic partnerships. Tool handles prospecting and follow-up.',
        whoIsEmpowered: ['BizDev', 'Partner Ops', 'Leadership'],
        newCapabilities: ['Automated prospecting', 'Engagement scoring', 'Sequence automation', 'Pipeline visibility'],
      },
      difficulty: 'Medium',
      estimatedHours: '50-70 hours',
      resourcesUsed: ['Installers', 'Regions'],
      apiEndpoints: ['/internal/installers', '/internal/regions'],
      dependsOn: ['unified-data-layer'],
      enables: ['installer-portal-product'],
      relatedTo: ['installer-performance-tracking'],
      dataRequirements: {
        required: ['Installer database', 'Region coverage data'],
        generates: ['NEW PARTNERS', 'Prospecting data', 'Engagement history', 'Onboarding records'],
        improves: ['Partner acquisition rate', 'Coverage expansion', 'Onboarding speed'],
      },
      benefits: ['Remove acquisition bottleneck', '3× partner acquisition rate', 'Systematic geographic expansion', 'No need to scale BDRs'],
      prerequisites: ['Partner prospect database', 'Email sequences', 'Scoring model'],
      category: 'Partner Growth',
      opsProcess: 'Installer Network Expansion',
      currentLOA: 'Manual',
      potentialLOA: 'High Automation',
      missingApiData: ['Partner pipeline tracking', 'Outreach status', 'Engagement scoring'],
      priority: 'High',
      stage: 'Pilot',
      prototypeUrl: 'https://claude.ai/public/artifacts/8f4cfd99-f0db-4335-9e56-c930dde67988',
      primaryUsers: ['Partner Ops', 'BizDev'],
      integrationsNeeded: ['Email', 'LinkedIn', 'CRM'],
      dataStatus: 'Static',
      nextMilestone: 'Automated outreach sequences + scoring engine',
    },
    {
      id: 'funnel-automation-os',
      title: 'Funnel Automation OS',
      description: 'Generates NEW QUALIFICATIONS & CALLS through automated WhatsApp and telephony flows. More conversations = more qualified leads = more sales. Scales SDR capacity without hiring.',
      pillar: 'Knowledge Generation',
      pillarOrder: 3,
      whyItMatters: 'SDR capacity is the bottleneck. This tool multiplies what each SDR can accomplish, generating more qualifying conversations per day.',
      humanRole: {
        before: 'SDRs manually manage every conversation. Limited by hours in the day.',
        after: 'SDRs focus on complex conversations and closing. Bot handles initial qualification and scheduling.',
        whoIsEmpowered: ['SDRs', 'Sales Ops', 'Operations'],
        newCapabilities: ['24/7 lead response', 'Automated qualification', 'Smart routing', 'A/B testing at scale'],
      },
      difficulty: 'Hard',
      estimatedHours: '80-100 hours',
      resourcesUsed: ['Deals', 'Templates', 'Calls'],
      apiEndpoints: ['/internal/deals', '/internal/templates', '/internal/calls'],
      dependsOn: ['unified-data-layer', 'sdr-portal'],
      enables: ['ai-cortex'],
      relatedTo: ['campaign-os'],
      dataRequirements: {
        required: ['Deal data', 'Message templates', 'Call outcomes'],
        generates: ['NEW CALLS', 'NEW QUALIFICATIONS', 'Conversation data', 'A/B test results'],
        improves: ['Response speed', 'Qualification rate', 'SDR efficiency'],
      },
      benefits: ['2-3× lead capacity', 'Instant response 24/7', 'Consistent qualification', 'A/B optimization'],
      prerequisites: ['Flow editor', 'Routing engine', 'WhatsApp Business API'],
      category: 'SDR Tools',
      opsProcess: 'Chatbot + Call Automation',
      currentLOA: 'Manual',
      potentialLOA: 'High Automation',
      missingApiData: ['Flow state tracking', 'Routing rules', 'A/B test results'],
      priority: 'High',
      stage: 'Pilot',
      prototypeUrl: 'https://claude.ai/public/artifacts/f4b89609-1d66-4cd5-ac68-178efb49891a',
      primaryUsers: ['Sales Ops', 'SDR Ops'],
      integrationsNeeded: ['WhatsApp Business', 'Aircall'],
      dataStatus: 'Static',
      nextMilestone: 'Live WhatsApp integration + flow execution',
    },

    // =========================================================================
    // 👥 PILLAR 3: HUMAN EMPOWERMENT
    // AI tools make humans MORE capable, not obsolete
    // =========================================================================
    {
      id: 'sdr-portal',
      title: 'SDR Portal',
      description: 'The daily workspace for SDRs. Empowers humans to handle more leads with better context. Every feature is designed to make SDRs faster and more effective, not to replace them.',
      pillar: 'Human Empowerment',
      pillarOrder: 1,
      whyItMatters: 'SDRs are the human connection point with customers. This tool gives them superpowers - better context, smarter prioritization, instant access to everything they need.',
      humanRole: {
        before: 'SDRs juggle multiple tabs, manually look up history, guess who to call next.',
        after: 'SDRs have everything in one view. AI suggests priorities. Humans focus on building relationships and closing.',
        whoIsEmpowered: ['SDRs', 'Team Leads', 'Operations'],
        newCapabilities: ['Single-view workspace', 'AI-suggested priorities', 'Instant context', 'Performance tracking'],
      },
      difficulty: 'Hard',
      estimatedHours: 'Ongoing',
      resourcesUsed: ['Deals', 'Qualifications', 'Calls', 'Templates', 'Opportunities'],
      apiEndpoints: ['/internal/deals', '/internal/qualifications', '/internal/calls', '/internal/templates'],
      dependsOn: ['unified-data-layer'],
      enables: ['ai-cortex', 'funnel-automation-os'],
      relatedTo: ['reporting-hub'],
      dataRequirements: {
        required: ['All SDR workflow data'],
        generates: ['Activity logs', 'Performance metrics', 'User feedback'],
        improves: ['SDR productivity', 'Data quality', 'Process compliance'],
      },
      benefits: ['Single workspace for all SDR tasks', 'AI-powered prioritization', 'Real-time pipeline view', 'Integrated communications'],
      prerequisites: ['CRM integration', 'WhatsApp integration', 'Telephony integration'],
      category: 'SDR Tools',
      opsProcess: 'Full SDR Workflow',
      currentLOA: 'Semi-Automated',
      potentialLOA: 'High Automation',
      missingApiData: [],
      priority: 'Critical',
      stage: 'Deployed',
      prototypeUrl: 'https://notion.so/abeto/SDR-Portal-front-end-feedback-2e1e74322e5180bdbf87d88337be98fd',
      primaryUsers: ['SDRs', 'Ops'],
      integrationsNeeded: ['Zoho', 'WhatsApp', 'Aircall'],
      dataStatus: 'Live',
      nextMilestone: 'Expand Cortex copiloting',
    },
    {
      id: 'installer-portal-product',
      title: 'Installer Portal',
      description: 'Empowers installers to self-serve, track their performance, and succeed. Happy, informed installers close more deals. This is about making our PARTNERS more effective.',
      pillar: 'Human Empowerment',
      pillarOrder: 2,
      whyItMatters: 'Installers are essential humans in our ecosystem. When they succeed, we succeed. This tool gives them visibility and control.',
      humanRole: {
        before: 'Installers call/email to get lead info. No visibility into performance. Frustrated by lack of transparency.',
        after: 'Installers self-serve all information. Understand their performance. AI helps them prioritize and improve.',
        whoIsEmpowered: ['Installers', 'Account Managers', 'Partner Ops'],
        newCapabilities: ['Self-service lead access', 'Performance dashboards', 'AI recommendations', 'Direct communication'],
      },
      difficulty: 'Hard',
      estimatedHours: '80-100 hours',
      resourcesUsed: ['Installers', 'Opportunities', 'Deals', 'Regions', 'Lost Reasons'],
      apiEndpoints: ['/internal/installers', '/internal/opportunities', '/internal/regions/{id}/quotas'],
      dependsOn: ['unified-data-layer', 'reporting-hub'],
      enables: ['installer-performance-tracking'],
      relatedTo: ['partner-expansion-tool'],
      dataRequirements: {
        required: ['Installer auth', 'Opportunity data', 'Performance metrics'],
        generates: ['Installer activity logs', 'Feedback data', 'Engagement metrics'],
        improves: ['Installer satisfaction', 'Conversion rates', 'Communication efficiency'],
      },
      benefits: ['Installer self-service', 'Performance transparency', 'Reduced support burden', 'Happier partners'],
      prerequisites: ['Installer authentication', 'Role-based access', 'Performance calculations'],
      category: 'Installer Tools',
      opsProcess: 'Partner Relationship Management',
      currentLOA: 'Not Implemented',
      potentialLOA: 'High Automation',
      missingApiData: ['Installer auth endpoint', 'Per-installer metrics', 'SLA tracking'],
      priority: 'Critical',
      stage: 'Planned',
      primaryUsers: ['Installers', 'Account Managers'],
      integrationsNeeded: ['Partner CRM', 'Performance data'],
      dataStatus: 'None',
      nextMilestone: 'Define MVP + pilot with top installers',
    },
    {
      id: 'ai-cortex',
      title: 'AI Cortex (Copilot for Everyone)',
      description: 'The intelligence layer that makes every human more effective. Not a replacement for people, but a copilot that provides insights, suggestions, and automation WHEN humans need it.',
      pillar: 'Human Empowerment',
      pillarOrder: 3,
      whyItMatters: 'AI amplifies human capability. Cortex is the assistant that never sleeps, never forgets, and learns from every interaction to help humans make better decisions faster.',
      humanRole: {
        before: 'Humans make decisions based on intuition and limited data. Context is lost between handoffs.',
        after: 'Humans make AI-informed decisions. Cortex provides context, suggestions, and handles routine tasks. Humans focus on judgment and relationships.',
        whoIsEmpowered: ['Everyone - SDRs, Ops, Leadership, Partners'],
        newCapabilities: ['Instant context on any lead', 'Proactive suggestions', 'Automated routine decisions', 'Natural language data access'],
      },
      difficulty: 'Hard',
      estimatedHours: '100+ hours',
      resourcesUsed: ['All resources'],
      apiEndpoints: ['All endpoints'],
      dependsOn: ['unified-data-layer', 'reporting-hub', 'data-quality-monitor'],
      enables: [],
      relatedTo: ['sdr-portal', 'installer-portal-product'],
      dataRequirements: {
        required: ['Complete data foundation', 'Historical patterns', 'User feedback'],
        generates: ['Insights', 'Recommendations', 'Automated actions', 'Learning data'],
        improves: ['Decision quality', 'Response speed', 'Consistency', 'Knowledge sharing'],
      },
      benefits: ['Compounding intelligence', 'Copilot for all teams', 'Automated routine decisions', 'Institutional memory'],
      prerequisites: ['Solid data foundation', 'LLM integration', 'Agent framework'],
      category: 'Platform Infrastructure',
      opsProcess: 'All processes',
      currentLOA: 'Not Implemented',
      potentialLOA: 'High Automation',
      missingApiData: ['Unified context access', 'Real-time events'],
      priority: 'Critical',
      stage: 'Pilot',
      prototypeUrl: 'https://investors-abeto-reporting.vercel.app/cortex-demo/walkthrough',
      primaryUsers: ['All teams'],
      integrationsNeeded: ['All systems'],
      dataStatus: 'None',
      nextMilestone: 'MVP in SDR Portal first',
    },
    {
      id: 'investor-portal',
      title: 'Investor Portal',
      description: 'Empowers leadership and investors with transparent, real-time business visibility. Builds trust through openness and professionalism.',
      pillar: 'Human Empowerment',
      pillarOrder: 4,
      whyItMatters: 'Investors and board members are humans who need clear information to support the company. This tool makes that relationship more effective.',
      humanRole: {
        before: 'Leadership spends days preparing board materials. Investors wait for quarterly updates.',
        after: 'Leadership shares a link. Investors self-serve real-time data. Meetings focus on strategy, not data review.',
        whoIsEmpowered: ['Leadership', 'Investors', 'Board Members'],
        newCapabilities: ['Real-time performance access', 'Self-service data room', 'Automated report generation', 'Cortex Q&A'],
      },
      difficulty: 'Medium',
      estimatedHours: '40-60 hours',
      resourcesUsed: ['Deals', 'Opportunities'],
      apiEndpoints: ['/internal/deals/stats', '/internal/opportunities/stats'],
      dependsOn: ['unified-data-layer', 'reporting-hub'],
      enables: [],
      relatedTo: ['ai-cortex'],
      dataRequirements: {
        required: ['KPI data', 'Historical trends', 'Financial metrics'],
        generates: ['Report archives', 'Access logs', 'Q&A history'],
        improves: ['Investor relations', 'Board preparation time', 'Transparency'],
      },
      benefits: ['Professional investor experience', 'Automated reporting', 'Self-service data room', 'AI-powered Q&A'],
      prerequisites: ['Reporting Hub operational', 'Document management', 'Access control'],
      category: 'Reporting & Intelligence',
      opsProcess: 'Board & Investor Relations',
      currentLOA: 'Manual',
      potentialLOA: 'High Automation',
      missingApiData: ['Financial aggregations', 'Board KPIs'],
      priority: 'Medium',
      stage: 'Under Dev',
      prototypeUrl: 'https://investors-abeto-reporting.vercel.app/',
      primaryUsers: ['Investors', 'Board', 'Leadership'],
      integrationsNeeded: ['Reporting Hub'],
      dataStatus: 'Partial',
      nextMilestone: 'Complete data room + automated reporting',
    },

    // =========================================================================
    // SUPPORTING INITIATIVES
    // =========================================================================
    {
      id: 'installer-performance-tracking',
      title: 'Installer Performance & SLA Tracking',
      description: 'Sub-system of Installer Portal. Tracks conversion rates, response times, and SLA compliance. Enables fair lead distribution and performance coaching.',
      pillar: 'Human Empowerment',
      pillarOrder: 5,
      whyItMatters: 'Fair, transparent metrics help installers improve and help us allocate leads effectively.',
      humanRole: {
        before: 'Account managers manually track installer performance in spreadsheets.',
        after: 'Performance is automatically tracked. Account managers focus on coaching and relationship building.',
        whoIsEmpowered: ['Account Managers', 'Partner Ops', 'Installers'],
        newCapabilities: ['Automated SLA tracking', 'Performance benchmarking', 'Coaching insights', 'Fair allocation'],
      },
      difficulty: 'Medium',
      estimatedHours: '30-40 hours',
      resourcesUsed: ['Opportunities', 'Installers'],
      apiEndpoints: ['/internal/opportunities', '/internal/opportunities/stats', '/internal/installers'],
      dependsOn: ['unified-data-layer', 'installer-portal-product'],
      enables: ['dynamic-allocation-engine'],
      relatedTo: ['reporting-hub'],
      dataRequirements: {
        required: ['Opportunity stage timestamps', 'Installer activity'],
        generates: ['Performance scores', 'SLA metrics', 'Conversion rates'],
        improves: ['Installer accountability', 'Lead allocation fairness', 'Coaching effectiveness'],
      },
      benefits: ['Fair performance measurement', 'SLA compliance tracking', 'Data-driven coaching', 'Optimal lead allocation'],
      prerequisites: ['Opportunity timestamps', 'SLA definitions'],
      category: 'Installer Tools',
      opsProcess: 'Partner Performance Management',
      currentLOA: 'Manual',
      potentialLOA: 'High Automation',
      missingApiData: ['Stage timestamps', 'SLA thresholds'],
      priority: 'High',
      stage: 'Planned',
      primaryUsers: ['Account Managers', 'Installers'],
      integrationsNeeded: ['Installer Portal'],
      dataStatus: 'Partial',
      nextMilestone: 'Define SLAs + build tracking',
    },
    {
      id: 'dynamic-allocation-engine',
      title: 'Dynamic Lead Allocation Engine',
      description: 'AI-powered lead-to-installer matching. Uses performance data, capacity, and customer preferences to optimize allocation. Part of the funnel automation.',
      pillar: 'Human Empowerment',
      pillarOrder: 6,
      whyItMatters: 'Better allocation = happier customers + happier installers + more conversions.',
      humanRole: {
        before: 'Ops manually assigns leads using Google Sheets. Time-consuming and inconsistent.',
        after: 'AI handles routine allocation. Ops reviews edge cases and adjusts rules. Focus shifts to optimization.',
        whoIsEmpowered: ['Operations', 'Account Managers'],
        newCapabilities: ['Instant allocation', 'Performance-based routing', 'Capacity balancing', 'Deviation alerts'],
      },
      difficulty: 'Hard',
      estimatedHours: '50-70 hours',
      resourcesUsed: ['Deals', 'Opportunities', 'Regions', 'Installers'],
      apiEndpoints: ['/internal/deals', '/internal/opportunities', '/internal/regions', '/internal/installers'],
      dependsOn: ['unified-data-layer', 'installer-performance-tracking'],
      enables: [],
      relatedTo: ['funnel-automation-os'],
      dataRequirements: {
        required: ['Installer performance scores', 'Capacity data', 'Region coverage'],
        generates: ['Allocation decisions', 'Quota tracking', 'Deviation alerts'],
        improves: ['Conversion rates', 'Installer satisfaction', 'Customer experience'],
      },
      benefits: ['Instant allocation', 'Optimal matching', 'Automatic quota balancing', 'Performance-based routing'],
      prerequisites: ['Performance tracking operational', 'Allocation rules defined'],
      category: 'Operations',
      opsProcess: 'Lead Allocation',
      currentLOA: 'Manual',
      potentialLOA: 'High Automation',
      missingApiData: ['Installer capacity', 'Weight targets', 'Deviation calculations'],
      priority: 'High',
      stage: 'Idea',
      primaryUsers: ['Operations'],
      integrationsNeeded: ['Installer Portal', 'SDR Portal'],
      dataStatus: 'Partial',
      nextMilestone: 'Define allocation rules + scoring model',
    },

    // =========================================================================
    // 📋 SUB-PROJECTS & FEATURE IDEAS
    // Specific features within larger products
    // =========================================================================
    {
      id: 'whatsapp-conversation-summary',
      title: 'WhatsApp Conversation AI Summary',
      description: 'AI-powered summary of WhatsApp conversations to speed up SDR call preparation. Extract key points, customer concerns, and suggested talking points. Part of SDR Portal.',
      pillar: 'Human Empowerment',
      pillarOrder: 10,
      whyItMatters: 'SDRs waste time reading long message threads. AI summaries give instant context.',
      humanRole: {
        before: 'SDRs spend 5-10 minutes reading WhatsApp history before each call.',
        after: 'SDRs get instant AI summary with key points. Jump straight into meaningful conversations.',
        whoIsEmpowered: ['SDRs'],
        newCapabilities: ['Instant context', 'Key points extraction', 'Suggested talking points'],
      },
      difficulty: 'Medium',
      estimatedHours: '25-35 hours',
      resourcesUsed: ['Deals', 'Templates'],
      apiEndpoints: ['/internal/deals', '/internal/deals/{id}/messages'],
      dependsOn: ['sdr-portal', 'unified-data-layer'],
      enables: ['ai-cortex'],
      relatedTo: ['funnel-automation-os'],
      dataRequirements: {
        required: ['Full WhatsApp conversation history', 'Message timestamps'],
        generates: ['Conversation summaries', 'Suggested responses'],
        improves: ['SDR efficiency', 'Call preparation time'],
      },
      benefits: ['Faster call prep', 'No context loss', 'Consistent information', 'Better customer experience'],
      prerequisites: ['LLM integration', 'WhatsApp message history access'],
      category: 'SDR Tools',
      opsProcess: 'Call Preparation',
      currentLOA: 'Manual',
      potentialLOA: 'High Automation',
      missingApiData: ['Full WhatsApp conversation history endpoint', 'Message direction field'],
      priority: 'High',
      stage: 'Idea',
      primaryUsers: ['SDRs'],
      integrationsNeeded: ['OpenAI/Claude API'],
      dataStatus: 'Partial',
      nextMilestone: 'Build conversation history endpoint + LLM integration',
    },
    {
      id: 'contact-prioritization-engine',
      title: 'AI Contact Prioritization',
      description: 'SDR Portal feature that ranks contacts by conversion probability, optimal contact time, and channel preference. Shows "next best call" recommendations based on historical patterns.',
      pillar: 'Human Empowerment',
      pillarOrder: 11,
      whyItMatters: 'SDRs should focus on highest-value contacts at optimal times.',
      humanRole: {
        before: 'SDRs guess who to call next based on gut feeling.',
        after: 'AI suggests optimal contact order. SDRs focus on execution, not decision-making.',
        whoIsEmpowered: ['SDRs', 'Team Leads'],
        newCapabilities: ['AI-ranked contact list', 'Optimal timing suggestions', 'Channel recommendations'],
      },
      difficulty: 'Hard',
      estimatedHours: '45-60 hours',
      resourcesUsed: ['Deals', 'Calls', 'Qualifications'],
      apiEndpoints: ['/internal/deals', '/internal/calls', '/internal/qualifications'],
      dependsOn: ['sdr-portal', 'unified-data-layer'],
      enables: ['ai-cortex'],
      relatedTo: ['funnel-automation-os'],
      dataRequirements: {
        required: ['Historical contact patterns', 'Answer rates by time', 'Customer timezones'],
        generates: ['Priority scores', 'Contact recommendations', 'Timing suggestions'],
        improves: ['Answer rates', 'SDR efficiency', 'Conversion rates'],
      },
      benefits: ['Higher answer rates', 'SDR focus on high-value contacts', 'Data-driven optimization'],
      prerequisites: ['ML model for scoring', 'Historical data analysis'],
      category: 'SDR Tools',
      opsProcess: 'Contact Prioritization',
      currentLOA: 'Manual',
      potentialLOA: 'High Automation',
      missingApiData: ['Historical contact attempt times', 'Answer rate by time-of-day', 'Customer preferred hours'],
      priority: 'High',
      stage: 'Idea',
      primaryUsers: ['SDRs'],
      integrationsNeeded: ['ML pipeline'],
      dataStatus: 'Partial',
      nextMilestone: 'Build scoring model + SDR Portal integration',
    },
    {
      id: 'lead-recycling-workflow',
      title: 'Lead Recycling Workflow',
      description: 'Automatic flagging and reassignment of recyclable leads based on installer feedback. Track recycling outcomes and optimize re-engagement timing. Part of Funnel Automation.',
      pillar: 'Knowledge Generation',
      pillarOrder: 10,
      whyItMatters: 'Lost leads can be recovered. Systematic recycling increases total conversions.',
      humanRole: {
        before: 'Lost leads disappear into a black hole. No systematic re-engagement.',
        after: 'System automatically identifies recyclable leads. Ops reviews and approves re-engagement.',
        whoIsEmpowered: ['Operations', 'SDRs'],
        newCapabilities: ['Automatic recyclable identification', 'Optimal re-engagement timing', 'Outcome tracking'],
      },
      difficulty: 'Medium',
      estimatedHours: '30-40 hours',
      resourcesUsed: ['Deals', 'Opportunities', 'Lost Reasons'],
      apiEndpoints: ['/internal/deals', '/internal/opportunities', '/internal/lost-reasons'],
      dependsOn: ['unified-data-layer'],
      enables: [],
      relatedTo: ['funnel-automation-os'],
      dataRequirements: {
        required: ['Lost reason with recyclable flag', 'Recycling attempt count'],
        generates: ['Recycling queue', 'Re-engagement schedule', 'Outcome data'],
        improves: ['Total conversion rate', 'Lead utilization'],
      },
      benefits: ['Recover lost revenue', 'Automatic re-assignment', 'Track recycling success'],
      prerequisites: ['Installer CRM integrations', 'Recycling rules'],
      category: 'Operations',
      opsProcess: 'Recycling Workflow',
      currentLOA: 'Manual',
      potentialLOA: 'High Automation',
      missingApiData: ['Recyclable flag on lost reasons', 'Recycling attempt count per deal', 'Re-engagement cooldown rules'],
      priority: 'Medium',
      stage: 'Idea',
      primaryUsers: ['Operations'],
      integrationsNeeded: ['Installer CRM webhooks'],
      dataStatus: 'Partial',
      nextMilestone: 'Add recyclable flags + build workflow',
    },
    {
      id: 'installer-feedback-system',
      title: 'Installer Feedback Collection',
      description: 'Track installer feedback per lead: temperature accuracy, missing details, lead viability. Use to refine AI prompts, coach SDRs, and improve qualification. Part of Installer Portal.',
      pillar: 'Human Empowerment',
      pillarOrder: 12,
      whyItMatters: 'Installer feedback closes the loop. Improves lead quality over time.',
      humanRole: {
        before: 'Installer feedback is informal and lost. No systematic learning.',
        after: 'Structured feedback collection. Data used to coach SDRs and improve AI.',
        whoIsEmpowered: ['Installers', 'SDR Team Leads', 'Operations'],
        newCapabilities: ['Structured feedback', 'Pattern identification', 'Continuous improvement'],
      },
      difficulty: 'Medium',
      estimatedHours: '25-35 hours',
      resourcesUsed: ['Opportunities', 'Installers', 'Lost Reasons'],
      apiEndpoints: ['/internal/opportunities', '/internal/installers', '/internal/lost-reasons'],
      dependsOn: ['installer-portal-product'],
      enables: ['ai-cortex'],
      relatedTo: ['installer-performance-tracking'],
      dataRequirements: {
        required: ['Feedback categories', 'Installer ID per feedback'],
        generates: ['Feedback patterns', 'SDR coaching insights', 'AI improvement data'],
        improves: ['Lead quality', 'SDR performance', 'AI accuracy'],
      },
      benefits: ['Systematic feedback', 'Pattern identification', 'Continuous improvement'],
      prerequisites: ['Feedback form/API', 'Dashboard with filtering'],
      category: 'Installer Tools',
      opsProcess: 'Feedback Collection',
      currentLOA: 'Not Implemented',
      potentialLOA: 'High Automation',
      missingApiData: ['Installer feedback endpoint', 'Feedback categories', 'Feedback timestamps'],
      priority: 'Medium',
      stage: 'Idea',
      primaryUsers: ['Installers', 'Team Leads'],
      integrationsNeeded: ['Installer Portal'],
      dataStatus: 'None',
      nextMilestone: 'Design feedback form + API endpoint',
    },
    {
      id: 'installer-quote-sync',
      title: 'Installer Quote Sync',
      description: 'Collect final offer amounts from installers via webhook, form, or portal. Enables financing integration and accurate ROI tracking. Part of Installer Portal.',
      pillar: 'Data Foundation',
      pillarOrder: 10,
      whyItMatters: 'Without quote data, we cannot measure true ROI or enable financing partnerships.',
      humanRole: {
        before: 'Quote amounts unknown. Manual tracking in spreadsheets.',
        after: 'Installers submit quotes through portal. Automatic sync to CRM.',
        whoIsEmpowered: ['Operations', 'Finance', 'Installers'],
        newCapabilities: ['Price benchmarking', 'Revenue tracking', 'Financing integration'],
      },
      difficulty: 'Medium',
      estimatedHours: '25-35 hours',
      resourcesUsed: ['Opportunities', 'Installers'],
      apiEndpoints: ['/internal/opportunities', '/internal/installers'],
      dependsOn: ['installer-portal-product'],
      enables: [],
      relatedTo: ['reporting-hub'],
      dataRequirements: {
        required: ['Offer amount field on opportunities', 'Installer webhook endpoint'],
        generates: ['Quote data', 'Price benchmarks', 'Revenue forecasts'],
        improves: ['ROI accuracy', 'Financial planning'],
      },
      benefits: ['Enable financing partnerships', 'Accurate revenue tracking', 'Price benchmarking'],
      prerequisites: ['Webhook endpoint for installers', 'Data validation'],
      category: 'Installer Tools',
      opsProcess: 'Quote Collection',
      currentLOA: 'Not Implemented',
      potentialLOA: 'Medium Automation',
      missingApiData: ['Offer amount field', 'Offer timestamp', 'Installer webhook POST endpoint'],
      priority: 'Medium',
      stage: 'Idea',
      primaryUsers: ['Installers', 'Operations'],
      integrationsNeeded: ['Installer Portal'],
      dataStatus: 'None',
      nextMilestone: 'Add offer amount field + webhook endpoint',
    },
    {
      id: 'answer-rate-monitoring',
      title: 'SIM/Number Answer Rate Monitor',
      description: 'Track answer rates and spam flags per phone number. Alert when numbers need rotation. Proactive SIM card management.',
      pillar: 'Data Foundation',
      pillarOrder: 11,
      whyItMatters: 'Spam-flagged numbers = wasted call attempts. Proactive rotation maintains contact rates.',
      humanRole: {
        before: 'Number issues discovered when answer rates drop. Reactive.',
        after: 'Automated monitoring alerts before problems impact performance.',
        whoIsEmpowered: ['Operations', 'SDR Team Leads'],
        newCapabilities: ['Proactive SIM rotation', 'Answer rate tracking', 'Spam detection'],
      },
      difficulty: 'Easy',
      estimatedHours: '15-25 hours',
      resourcesUsed: ['Calls', 'Unmatched Calls'],
      apiEndpoints: ['/internal/calls', '/internal/calls/stats', '/internal/unmatched-calls'],
      dependsOn: ['unified-data-layer'],
      enables: [],
      relatedTo: ['reporting-hub'],
      dataRequirements: {
        required: ['Outbound number per call', 'Answer rate aggregation'],
        generates: ['Number health scores', 'Rotation alerts'],
        improves: ['Answer rates', 'Call efficiency'],
      },
      benefits: ['Maintain high answer rates', 'Proactive SIM rotation', 'Reduce wasted attempts'],
      prerequisites: ['Aircall integration', 'Alerting system'],
      category: 'Operations',
      opsProcess: 'Answer Rate Monitoring',
      currentLOA: 'Manual',
      potentialLOA: 'Medium Automation',
      missingApiData: ['Outbound number identifier per call', 'Spam flag detection', 'Answer rate by number'],
      priority: 'Low',
      stage: 'Idea',
      primaryUsers: ['Operations'],
      integrationsNeeded: ['Aircall'],
      dataStatus: 'Partial',
      nextMilestone: 'Add outbound number tracking + alerting',
    },
    {
      id: 'gdpr-compliance-tracker',
      title: 'GDPR Compliance & Consent Tracker',
      description: 'Track consent status for every lead, opt-out requests, and data retention compliance. Auto-anonymize expired leads.',
      pillar: 'Data Foundation',
      pillarOrder: 12,
      whyItMatters: 'GDPR violations = €40k-€300k fines. Compliance is non-negotiable.',
      humanRole: {
        before: 'Consent tracked informally. Legal exposure unknown.',
        after: 'Automated consent tracking. Clear audit trail. Legal peace of mind.',
        whoIsEmpowered: ['Legal', 'Operations', 'Leadership'],
        newCapabilities: ['Consent audit trail', 'Auto-anonymization', 'Compliance reporting'],
      },
      difficulty: 'Medium',
      estimatedHours: '30-40 hours',
      resourcesUsed: ['Deals', 'Qualifications'],
      apiEndpoints: ['/internal/deals', '/internal/qualifications'],
      dependsOn: ['unified-data-layer'],
      enables: [],
      relatedTo: ['data-quality-monitor'],
      dataRequirements: {
        required: ['Consent flag per deal', 'Consent timestamp', 'Opt-out tracking'],
        generates: ['Compliance reports', 'Anonymization logs', 'Audit trail'],
        improves: ['Legal compliance', 'Customer trust'],
      },
      benefits: ['Legal compliance', 'Automated data retention', 'Audit-ready reports'],
      prerequisites: ['Consent tracking system', 'Anonymization logic'],
      category: 'Operations',
      opsProcess: 'GDPR Compliance',
      currentLOA: 'Not Implemented',
      potentialLOA: 'High Automation',
      missingApiData: ['Consent flag and source per deal', 'Consent timestamp', 'Opt-out tracking', 'Data retention config'],
      priority: 'Medium',
      stage: 'Idea',
      primaryUsers: ['Legal', 'Operations'],
      integrationsNeeded: ['Data retention system'],
      dataStatus: 'None',
      nextMilestone: 'Define consent fields + retention policy',
    },
    {
      id: 'automated-invoicing',
      title: 'Automated Provider & Partner Invoicing',
      description: 'Auto-generate monthly invoices for lead providers and installers. Reconciliation with rejection tracking.',
      pillar: 'Human Empowerment',
      pillarOrder: 13,
      whyItMatters: 'Manual invoicing takes hours and causes disputes. Automation saves time and improves relationships.',
      humanRole: {
        before: 'Finance spends hours on monthly invoicing. Frequent disputes.',
        after: 'Automated invoice generation. Finance reviews and approves.',
        whoIsEmpowered: ['Finance', 'Operations'],
        newCapabilities: ['Automated invoice generation', 'Reconciliation', 'Dispute reduction'],
      },
      difficulty: 'Medium',
      estimatedHours: '35-45 hours',
      resourcesUsed: ['Deals', 'Opportunities', 'Installers'],
      apiEndpoints: ['/internal/deals/stats', '/internal/opportunities/stats'],
      dependsOn: ['reporting-hub'],
      enables: [],
      relatedTo: ['installer-quote-sync'],
      dataRequirements: {
        required: ['Provider pricing/CPL data', 'Validation status', 'Won opportunity revenue'],
        generates: ['Invoices', 'Reconciliation reports'],
        improves: ['Finance efficiency', 'Partner relationships'],
      },
      benefits: ['Hours saved on invoicing', 'Fewer disputes', 'Clear audit trail'],
      prerequisites: ['Accounting rules engine', 'PDF generation'],
      category: 'Operations',
      opsProcess: 'Invoicing',
      currentLOA: 'Manual',
      potentialLOA: 'Medium Automation',
      missingApiData: ['Provider pricing/CPL data', 'Invoice line item breakdown'],
      priority: 'Low',
      stage: 'Idea',
      primaryUsers: ['Finance'],
      integrationsNeeded: ['Accounting system'],
      dataStatus: 'Partial',
      nextMilestone: 'Define invoicing rules + template',
    },
    {
      id: 'api-self-service-portal',
      title: 'Provider API Self-Service Portal',
      description: 'Self-service portal for lead providers to test API payloads, view integration status, and access documentation.',
      pillar: 'Data Foundation',
      pillarOrder: 13,
      whyItMatters: 'Provider onboarding is slow and support-heavy. Self-service accelerates partnerships.',
      humanRole: {
        before: 'Tech team manually onboards each provider. High support burden.',
        after: 'Providers self-serve API integration. Tech reviews edge cases only.',
        whoIsEmpowered: ['Tech Team', 'Partner Ops', 'Providers'],
        newCapabilities: ['Self-service onboarding', 'Real-time testing', 'Error debugging'],
      },
      difficulty: 'Hard',
      estimatedHours: '45-60 hours',
      resourcesUsed: ['Deals'],
      apiEndpoints: ['/internal/deals'],
      dependsOn: ['unified-data-layer'],
      enables: [],
      relatedTo: ['campaign-os'],
      dataRequirements: {
        required: ['Provider auth tokens', 'Webhook logs', 'Integration health'],
        generates: ['Integration status', 'Error logs', 'Usage metrics'],
        improves: ['Provider onboarding speed', 'Support efficiency'],
      },
      benefits: ['Faster provider onboarding', 'Reduced support', 'Better integration quality'],
      prerequisites: ['Auth system', 'Webhook monitoring', 'Documentation'],
      category: 'Data Layer',
      opsProcess: 'Provider Onboarding',
      currentLOA: 'Manual',
      potentialLOA: 'High Automation',
      missingApiData: ['Provider auth tokens', 'Webhook delivery logs', 'Integration health per provider'],
      priority: 'Low',
      stage: 'Idea',
      primaryUsers: ['Providers', 'Tech'],
      integrationsNeeded: ['Auth0/custom auth'],
      dataStatus: 'None',
      nextMilestone: 'Build documentation portal + API sandbox',
    },

    // =========================================================================
    // 🌟 GROWTH HACK IDEAS (from strategic doc)
    // Marketing & acquisition initiatives
    // =========================================================================
    {
      id: 'programmatic-seo-pages',
      title: 'Programmatic Municipality SEO Pages',
      description: 'Generate 8,000+ SEO-optimized pages for Spanish municipalities. Target long-tail keywords like "placas solares [municipio]" with zero competition.',
      pillar: 'Knowledge Generation',
      pillarOrder: 20,
      whyItMatters: 'Spain has 8,131 municipalities. 90%+ have ZERO solar installer SEO pages. Massive organic traffic opportunity.',
      humanRole: {
        before: 'Marketing creates pages manually. Only covering 50-100 cities.',
        after: 'AI generates thousands of pages. Marketing focuses on strategy and optimization.',
        whoIsEmpowered: ['Marketing', 'Growth', 'SEO'],
        newCapabilities: ['Massive organic reach', 'Long-tail dominance', 'Zero-cost traffic'],
      },
      difficulty: 'Hard',
      estimatedHours: '80-100 hours',
      resourcesUsed: ['External APIs'],
      apiEndpoints: [],
      dependsOn: [],
      enables: ['campaign-os'],
      relatedTo: ['pvpc-savings-widget', 'irpf-calculator'],
      dataRequirements: {
        required: ['PVGIS solar data', 'INE municipality data', 'Municipal incentives'],
        generates: ['Organic traffic', 'Local leads', 'SEO authority'],
        improves: ['CAC', 'Brand awareness', 'Organic lead volume'],
      },
      benefits: ['8000+ pages with zero competition', 'Massive organic traffic', '-60% CAC'],
      prerequisites: ['PVGIS API', 'ESIOS API', 'Municipal data scraper'],
      category: 'Marketing & Campaigns',
      opsProcess: 'SEO & Content',
      currentLOA: 'Not Implemented',
      potentialLOA: 'High Automation',
      missingApiData: ['PVGIS integration', 'Municipal incentives database'],
      priority: 'High',
      stage: 'Idea',
      primaryUsers: ['Marketing'],
      integrationsNeeded: ['PVGIS', 'ESIOS', 'INE data'],
      dataStatus: 'None',
      nextMilestone: 'Build 500 pilot pages for top municipalities',
    },
    {
      id: 'pvpc-savings-widget',
      title: 'Live PVPC Savings Widget',
      description: 'Real-time widget showing current electricity prices and potential solar savings. Viral sharing mechanism.',
      pillar: 'Knowledge Generation',
      pillarOrder: 21,
      whyItMatters: 'Spaniards check electricity prices obsessively. High bill anxiety = engagement opportunity.',
      humanRole: {
        before: 'Static savings estimates. No real-time engagement.',
        after: 'Real-time pricing creates urgency. Widget drives viral sharing.',
        whoIsEmpowered: ['Marketing', 'Growth'],
        newCapabilities: ['Real-time engagement', 'Viral sharing', 'Daily habit formation'],
      },
      difficulty: 'Easy',
      estimatedHours: '15-25 hours',
      resourcesUsed: ['External APIs'],
      apiEndpoints: [],
      dependsOn: [],
      enables: ['programmatic-seo-pages'],
      relatedTo: ['irpf-calculator'],
      dataRequirements: {
        required: ['ESIOS real-time PVPC data'],
        generates: ['Engagement', 'Social shares', 'Leads'],
        improves: ['Website engagement', 'Viral reach'],
      },
      benefits: ['High engagement', 'Viral potential', '-40% CAC via organic'],
      prerequisites: ['ESIOS API integration'],
      category: 'Marketing & Campaigns',
      opsProcess: 'Lead Generation',
      currentLOA: 'Not Implemented',
      potentialLOA: 'Fully Automated',
      missingApiData: ['ESIOS API integration'],
      priority: 'Medium',
      stage: 'Idea',
      primaryUsers: ['Marketing'],
      integrationsNeeded: ['ESIOS/REE API'],
      dataStatus: 'None',
      nextMilestone: 'Build standalone microsite first',
    },
    {
      id: 'irpf-calculator',
      title: 'IRPF 60% Tax Deduction Calculator',
      description: 'Interactive calculator showing exact tax savings from solar investment. Urgency: expires Dec 31, 2025.',
      pillar: 'Knowledge Generation',
      pillarOrder: 22,
      whyItMatters: 'Most Spaniards DON\'T KNOW about the 60% IRPF deduction. Huge urgency trigger.',
      humanRole: {
        before: 'Tax benefits explained in text. No personalization.',
        after: 'Interactive calculator shows exact savings. Urgency drives conversions.',
        whoIsEmpowered: ['Marketing', 'Sales'],
        newCapabilities: ['Personalized tax calculations', 'Urgency messaging', 'Conversion optimization'],
      },
      difficulty: 'Easy',
      estimatedHours: '10-15 hours',
      resourcesUsed: [],
      apiEndpoints: [],
      dependsOn: [],
      enables: ['programmatic-seo-pages'],
      relatedTo: ['pvpc-savings-widget'],
      dataRequirements: {
        required: ['IRPF rules', 'Tax bracket data'],
        generates: ['Calculator usage data', 'Lead conversion'],
        improves: ['Conversion rate', 'Urgency perception'],
      },
      benefits: ['Urgency trigger', 'Higher conversions', '-30% CAC'],
      prerequisites: ['IRPF deduction rules'],
      category: 'Marketing & Campaigns',
      opsProcess: 'Lead Generation',
      currentLOA: 'Not Implemented',
      potentialLOA: 'Fully Automated',
      missingApiData: [],
      priority: 'Medium',
      stage: 'Idea',
      primaryUsers: ['Marketing'],
      integrationsNeeded: [],
      dataStatus: 'None',
      nextMilestone: 'Build calculator + embed on all pages',
    },
    {
      id: 'gmb-automation',
      title: 'Google Business Multi-Location Automation',
      description: 'Automate 50+ Google Business profiles for service areas. Dominate local pack results.',
      pillar: 'Knowledge Generation',
      pillarOrder: 23,
      whyItMatters: 'Local pack visibility = highest intent clicks at zero cost.',
      humanRole: {
        before: 'Single GMB profile. Limited local visibility.',
        after: 'Automated multi-location presence. AI handles posts and review responses.',
        whoIsEmpowered: ['Marketing', 'Operations'],
        newCapabilities: ['Local pack dominance', 'Automated posts', 'AI review responses'],
      },
      difficulty: 'Medium',
      estimatedHours: '30-40 hours',
      resourcesUsed: ['Opportunities', 'Installers'],
      apiEndpoints: [],
      dependsOn: [],
      enables: ['review-generation-system'],
      relatedTo: ['programmatic-seo-pages'],
      dataRequirements: {
        required: ['GMB API access', 'Service area data'],
        generates: ['Local visibility', 'Reviews', 'Local leads'],
        improves: ['Local SEO', 'Trust signals'],
      },
      benefits: ['Local pack visibility', 'Zero-cost clicks', '-45% CAC'],
      prerequisites: ['GMB API', 'Automation framework'],
      category: 'Marketing & Campaigns',
      opsProcess: 'Local Marketing',
      currentLOA: 'Manual',
      potentialLOA: 'High Automation',
      missingApiData: [],
      priority: 'Medium',
      stage: 'Idea',
      primaryUsers: ['Marketing'],
      integrationsNeeded: ['Google Business API'],
      dataStatus: 'None',
      nextMilestone: 'Set up 10 pilot profiles',
    },
    {
      id: 'review-generation-system',
      title: 'Review Generation & Auto-Reply',
      description: 'Automated review requests after installation + AI-powered review responses.',
      pillar: 'Knowledge Generation',
      pillarOrder: 24,
      whyItMatters: 'Spanish trust factor: Reviews > Ads. Systematic review generation builds moat.',
      humanRole: {
        before: 'Reviews happen randomly. No systematic collection.',
        after: 'Automated request sequence. AI responds within 2 hours.',
        whoIsEmpowered: ['Marketing', 'Operations'],
        newCapabilities: ['Systematic review collection', 'Fast response times', 'Social proof at scale'],
      },
      difficulty: 'Easy',
      estimatedHours: '15-25 hours',
      resourcesUsed: ['Opportunities', 'Installers'],
      apiEndpoints: ['/internal/opportunities'],
      dependsOn: ['unified-data-layer'],
      enables: [],
      relatedTo: ['gmb-automation'],
      dataRequirements: {
        required: ['Installation completion dates', 'Customer contact info'],
        generates: ['Reviews', 'Social proof', 'Testimonials'],
        improves: ['Trust', 'Conversion rate'],
      },
      benefits: ['Systematic social proof', '-25% CAC via trust', 'Referral loop'],
      prerequisites: ['WhatsApp automation', 'GMB API'],
      category: 'Marketing & Campaigns',
      opsProcess: 'Review Management',
      currentLOA: 'Not Implemented',
      potentialLOA: 'High Automation',
      missingApiData: ['Installation completion date field'],
      priority: 'Medium',
      stage: 'Idea',
      primaryUsers: ['Marketing'],
      integrationsNeeded: ['GMB API', 'WhatsApp'],
      dataStatus: 'Partial',
      nextMilestone: 'Build review request flow',
    },
    {
      id: 'competitor-intel-agent',
      title: 'Competitor Ad Intelligence Agent',
      description: 'Daily scraping of competitor ads from Meta/Google Ad Libraries. AI analysis of gaps and opportunities.',
      pillar: 'Human Empowerment',
      pillarOrder: 20,
      whyItMatters: 'Avoid wasting ad spend on losing angles. Find gaps competitors miss.',
      humanRole: {
        before: 'Marketing manually checks competitor ads occasionally.',
        after: 'Daily automated intel. AI suggests counter-strategies.',
        whoIsEmpowered: ['Marketing', 'Growth'],
        newCapabilities: ['Real-time competitor tracking', 'Gap identification', 'AI strategy suggestions'],
      },
      difficulty: 'Medium',
      estimatedHours: '20-30 hours',
      resourcesUsed: ['External APIs'],
      apiEndpoints: [],
      dependsOn: [],
      enables: ['campaign-os'],
      relatedTo: [],
      dataRequirements: {
        required: ['Meta Ad Library access', 'Google Ads Transparency'],
        generates: ['Competitor insights', 'Creative gaps', 'Strategy recommendations'],
        improves: ['Ad efficiency', 'Creative quality'],
      },
      benefits: ['Avoid wasted spend', 'Find untapped angles', '-20% CAC'],
      prerequisites: ['Ad library scrapers', 'AI analysis pipeline'],
      category: 'Marketing & Campaigns',
      opsProcess: 'Competitive Intelligence',
      currentLOA: 'Manual',
      potentialLOA: 'High Automation',
      missingApiData: [],
      priority: 'Low',
      stage: 'Idea',
      primaryUsers: ['Marketing'],
      integrationsNeeded: ['Meta Ad Library', 'Claude API'],
      dataStatus: 'None',
      nextMilestone: 'Build scraper + weekly reports',
    },
    {
      id: 'robinson-suppressor',
      title: 'Robinson/Stop Publicidad Suppressor',
      description: 'Automated daily suppression of leads on Robinson list. CLI registration for 2025 compliance.',
      pillar: 'Data Foundation',
      pillarOrder: 14,
      whyItMatters: 'Robinson violations = €40k-€300k fines. Call blocking from unregistered numbers.',
      humanRole: {
        before: 'Manual Robinson checks. Risk of violations.',
        after: 'Automated nightly suppression. Zero compliance risk.',
        whoIsEmpowered: ['Legal', 'Operations'],
        newCapabilities: ['Automated suppression', 'CLI registration', 'Compliance audit trail'],
      },
      difficulty: 'Easy',
      estimatedHours: '10-15 hours',
      resourcesUsed: ['Deals'],
      apiEndpoints: ['/internal/deals'],
      dependsOn: ['unified-data-layer'],
      enables: [],
      relatedTo: ['gdpr-compliance-tracker'],
      dataRequirements: {
        required: ['Robinson list access', 'Phone hashing'],
        generates: ['Suppression logs', 'Compliance reports'],
        improves: ['Legal compliance', 'Call efficiency'],
      },
      benefits: ['Avoid €40k-€300k fines', 'Protect call capability', 'Legal peace of mind'],
      prerequisites: ['Robinson list API', 'Nightly job scheduler'],
      category: 'Operations',
      opsProcess: 'Compliance',
      currentLOA: 'Not Implemented',
      potentialLOA: 'Fully Automated',
      missingApiData: ['Robinson list integration'],
      priority: 'High',
      stage: 'Idea',
      primaryUsers: ['Legal', 'Operations'],
      integrationsNeeded: ['Robinson list API'],
      dataStatus: 'None',
      nextMilestone: 'Build suppression agent + CLI registration',
    },
    {
      id: 'unified-quote-api',
      title: 'Unified Quote Calculator API',
      description: 'Single source of truth for all pricing calculations. Every touchpoint calls this API for consistent quotes.',
      pillar: 'Data Foundation',
      pillarOrder: 15,
      whyItMatters: 'Inconsistent pricing = customer confusion = lost deals. One API to rule them all.',
      humanRole: {
        before: 'Different prices on website, ads, WhatsApp. Customer confusion.',
        after: 'Consistent pricing everywhere. Sales focuses on closing, not explaining discrepancies.',
        whoIsEmpowered: ['Sales', 'Marketing', 'Operations'],
        newCapabilities: ['Consistent pricing', 'Real-time quotes', 'Dynamic calculations'],
      },
      difficulty: 'Hard',
      estimatedHours: '40-60 hours',
      resourcesUsed: ['Deals', 'Regions'],
      apiEndpoints: ['/internal/deals', '/internal/regions'],
      dependsOn: ['unified-data-layer'],
      enables: ['funnel-automation-os', 'programmatic-seo-pages'],
      relatedTo: ['irpf-calculator', 'pvpc-savings-widget'],
      dataRequirements: {
        required: ['PVGIS yield data', 'PVPC rates', 'Municipal incentives', 'Equipment pricing'],
        generates: ['Instant quotes', 'Savings calculations', 'Payback estimates'],
        improves: ['Trust', 'Conversion rate', 'Sales efficiency'],
      },
      benefits: ['Consistent pricing', 'Higher trust', '-35% CAC via consistency'],
      prerequisites: ['PVGIS API', 'ESIOS API', 'Pricing database'],
      category: 'Platform Infrastructure',
      opsProcess: 'Quoting',
      currentLOA: 'Manual',
      potentialLOA: 'Fully Automated',
      missingApiData: ['PVGIS integration', 'Municipal incentives', 'Equipment pricing'],
      priority: 'High',
      stage: 'Idea',
      primaryUsers: ['All teams'],
      integrationsNeeded: ['PVGIS', 'ESIOS'],
      dataStatus: 'None',
      nextMilestone: 'Build basic quote API + integrate with website',
    },
  ];
}

// =============================================================================
// 🔧 MISSING API RESOURCES
// API endpoints that need to be created to enable all projects
// =============================================================================

export interface MissingApiResource {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  enablesProjects: string[];
  dataSource: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  estimatedHours: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  category: 'Core Data' | 'Analytics' | 'External Integration' | 'Compliance' | 'Financial';
}

export function getMissingApiResources(): MissingApiResource[] {
  return [
    // CRITICAL - Block multiple projects
    {
      id: 'whatsapp-conversation-history',
      name: 'WhatsApp Conversation History',
      description: 'Full message history for each deal including timestamps, direction (inbound/outbound), and message content. Currently only have templates.',
      endpoint: '/internal/deals/{id}/messages',
      enablesProjects: ['whatsapp-conversation-summary', 'ai-cortex', 'funnel-automation-os'],
      dataSource: 'Woztell/WhatsApp Business API',
      difficulty: 'Medium',
      estimatedHours: '20-30 hours',
      priority: 'Critical',
      category: 'Core Data',
    },
    {
      id: 'call-transcripts',
      name: 'Call Transcripts & Recordings',
      description: 'Transcribed call content and recording URLs. Essential for AI analysis and quality monitoring.',
      endpoint: '/internal/calls/{id}/transcript',
      enablesProjects: ['ai-cortex', 'sdr-portal', 'contact-prioritization-engine'],
      dataSource: 'Aircall API',
      difficulty: 'Medium',
      estimatedHours: '25-35 hours',
      priority: 'Critical',
      category: 'Core Data',
    },
    {
      id: 'installer-auth',
      name: 'Installer Authentication',
      description: 'Secure login system for installers to access their portal. Token-based auth with role permissions.',
      endpoint: '/internal/installers/auth',
      enablesProjects: ['installer-portal-product', 'installer-feedback-system', 'installer-quote-sync'],
      dataSource: 'Custom (Auth0 or internal)',
      difficulty: 'Hard',
      estimatedHours: '40-50 hours',
      priority: 'Critical',
      category: 'Core Data',
    },
    {
      id: 'opportunity-stage-timestamps',
      name: 'Opportunity Stage Change History',
      description: 'Timestamp for each stage change on opportunities. Required for SLA tracking and performance measurement.',
      endpoint: '/internal/opportunities/{id}/stage-history',
      enablesProjects: ['installer-performance-tracking', 'dynamic-allocation-engine', 'reporting-hub'],
      dataSource: 'Zoho CRM',
      difficulty: 'Easy',
      estimatedHours: '10-15 hours',
      priority: 'Critical',
      category: 'Analytics',
    },

    // HIGH - Enable important features
    {
      id: 'installer-performance-metrics',
      name: 'Installer Performance Metrics',
      description: 'Aggregated metrics per installer: conversion rate, avg response time, SLA compliance, lead count by outcome.',
      endpoint: '/internal/installers/{id}/performance',
      enablesProjects: ['installer-portal-product', 'installer-performance-tracking', 'dynamic-allocation-engine'],
      dataSource: 'Calculated from Opportunities',
      difficulty: 'Medium',
      estimatedHours: '25-35 hours',
      priority: 'High',
      category: 'Analytics',
    },
    {
      id: 'installer-feedback-endpoint',
      name: 'Installer Feedback Collection',
      description: 'API for installers to submit feedback on leads: temperature accuracy, missing info, viability.',
      endpoint: '/internal/opportunities/{id}/feedback',
      enablesProjects: ['installer-feedback-system', 'ai-cortex'],
      dataSource: 'New data collection',
      difficulty: 'Easy',
      estimatedHours: '15-20 hours',
      priority: 'High',
      category: 'Core Data',
    },
    {
      id: 'historical-call-patterns',
      name: 'Historical Call Patterns',
      description: 'Aggregated data on best contact times by region, customer segment, and day of week.',
      endpoint: '/internal/calls/patterns',
      enablesProjects: ['contact-prioritization-engine', 'ai-cortex', 'funnel-automation-os'],
      dataSource: 'Calculated from Calls',
      difficulty: 'Medium',
      estimatedHours: '20-30 hours',
      priority: 'High',
      category: 'Analytics',
    },
    {
      id: 'utm-tracking',
      name: 'UTM & Attribution Data',
      description: 'Source, medium, campaign, and content tracking for each deal. Map ad spend to conversions.',
      endpoint: '/internal/deals/{id}/attribution',
      enablesProjects: ['campaign-os', 'reporting-hub'],
      dataSource: 'Zoho + Lead forms',
      difficulty: 'Medium',
      estimatedHours: '20-30 hours',
      priority: 'High',
      category: 'Analytics',
    },
    {
      id: 'consent-tracking',
      name: 'GDPR Consent Tracking',
      description: 'Consent status, timestamp, source, and opt-out history for each lead.',
      endpoint: '/internal/deals/{id}/consent',
      enablesProjects: ['gdpr-compliance-tracker', 'robinson-suppressor'],
      dataSource: 'New data collection',
      difficulty: 'Medium',
      estimatedHours: '20-25 hours',
      priority: 'High',
      category: 'Compliance',
    },

    // MEDIUM - Enable specific features
    {
      id: 'offer-amount-field',
      name: 'Opportunity Offer Amount',
      description: 'Final quote amount submitted by installer for each opportunity.',
      endpoint: '/internal/opportunities (add field)',
      enablesProjects: ['installer-quote-sync', 'reporting-hub', 'automated-invoicing'],
      dataSource: 'Installer input',
      difficulty: 'Easy',
      estimatedHours: '5-10 hours',
      priority: 'Medium',
      category: 'Financial',
    },
    {
      id: 'installer-capacity',
      name: 'Installer Capacity & Quotas',
      description: 'Current capacity, monthly quota targets, and deviation tracking per installer.',
      endpoint: '/internal/installers/{id}/capacity',
      enablesProjects: ['dynamic-allocation-engine', 'installer-portal-product'],
      dataSource: 'Manual configuration + calculations',
      difficulty: 'Medium',
      estimatedHours: '20-25 hours',
      priority: 'Medium',
      category: 'Core Data',
    },
    {
      id: 'outbound-number-tracking',
      name: 'Outbound Number per Call',
      description: 'Track which SIM/number was used for each outbound call. Required for answer rate monitoring.',
      endpoint: '/internal/calls (add field)',
      enablesProjects: ['answer-rate-monitoring'],
      dataSource: 'Aircall API',
      difficulty: 'Easy',
      estimatedHours: '10-15 hours',
      priority: 'Medium',
      category: 'Core Data',
    },
    {
      id: 'recyclable-flag',
      name: 'Lost Reason Recyclable Flag',
      description: 'Flag on lost reasons indicating whether leads with this reason can be recycled.',
      endpoint: '/internal/lost-reasons (add field)',
      enablesProjects: ['lead-recycling-workflow'],
      dataSource: 'Manual configuration',
      difficulty: 'Easy',
      estimatedHours: '5-10 hours',
      priority: 'Medium',
      category: 'Core Data',
    },
    {
      id: 'provider-pricing',
      name: 'Provider Pricing & CPL',
      description: 'Cost per lead by provider, validation rules, and monthly caps.',
      endpoint: '/internal/providers',
      enablesProjects: ['campaign-os', 'automated-invoicing'],
      dataSource: 'Manual configuration',
      difficulty: 'Medium',
      estimatedHours: '20-25 hours',
      priority: 'Medium',
      category: 'Financial',
    },

    // EXTERNAL INTEGRATIONS
    {
      id: 'pvgis-integration',
      name: 'PVGIS Solar Yield API',
      description: 'Integration with EU PVGIS API for solar radiation and yield estimates by location.',
      endpoint: '/external/pvgis',
      enablesProjects: ['programmatic-seo-pages', 'unified-quote-api'],
      dataSource: 'PVGIS API (EU official, free)',
      difficulty: 'Easy',
      estimatedHours: '10-15 hours',
      priority: 'High',
      category: 'External Integration',
    },
    {
      id: 'esios-integration',
      name: 'ESIOS Real-Time PVPC Prices',
      description: 'Integration with Red Eléctrica for real-time electricity prices.',
      endpoint: '/external/esios',
      enablesProjects: ['pvpc-savings-widget', 'unified-quote-api', 'programmatic-seo-pages'],
      dataSource: 'ESIOS/REE API (free)',
      difficulty: 'Easy',
      estimatedHours: '10-15 hours',
      priority: 'High',
      category: 'External Integration',
    },
    {
      id: 'municipal-incentives',
      name: 'Municipal Incentives Database',
      description: 'IBI reductions, ICIO bonuses, and other municipal solar incentives by postal code.',
      endpoint: '/external/incentives',
      enablesProjects: ['programmatic-seo-pages', 'unified-quote-api'],
      dataSource: 'Scraped from municipal websites (quarterly)',
      difficulty: 'Hard',
      estimatedHours: '40-60 hours',
      priority: 'Medium',
      category: 'External Integration',
    },
    {
      id: 'robinson-list',
      name: 'Robinson List Integration',
      description: 'Daily download and matching against Spanish do-not-call registry.',
      endpoint: '/external/robinson',
      enablesProjects: ['robinson-suppressor', 'gdpr-compliance-tracker'],
      dataSource: 'AEPD Robinson List',
      difficulty: 'Medium',
      estimatedHours: '15-20 hours',
      priority: 'High',
      category: 'Compliance',
    },
  ];
}

// =============================================================================
// DATA SOURCES NEEDED
// These are databases, CRM fields, configurations, and external data sources
// that are NOT API endpoints but are required to build the projects.
// =============================================================================

export type DataSourceType = 'Internal Database' | 'CRM Field' | 'External API' | 'Configuration' | 'Calculated/Aggregated';
export type DataSourceStatus = 'Not Started' | 'In Progress' | 'Partial' | 'Available';

export interface DataSourceNeeded {
  id: string;
  name: string;
  description: string;
  type: DataSourceType;
  source: string; // Where it comes from (e.g., "Holded", "Google API", "Manual Entry")
  enablesProjects: string[];
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  effort: 'Low' | 'Medium' | 'High'; // Implementation effort
  status: DataSourceStatus;
  notes?: string;
}

export function getDataSourcesNeeded(): DataSourceNeeded[] {
  return [
    // CRITICAL - Block multiple high-value projects
    {
      id: 'equipment-pricing-db',
      name: 'Equipment Pricing Database',
      description: 'Solar panel, inverter, battery, and mounting equipment pricing. Required for accurate quote calculations.',
      type: 'Internal Database',
      source: 'Manual Entry + Supplier APIs',
      enablesProjects: ['unified-quote-api', 'programmatic-seo-pages', 'installer-quoting-tool'],
      priority: 'Critical',
      effort: 'Medium',
      status: 'Not Started',
      notes: 'Need to define equipment catalog structure and pricing update workflow',
    },
    {
      id: 'ine-municipality-data',
      name: 'INE Municipality Database',
      description: 'Spanish municipality data: population, coordinates, province, autonomous community. Required for SEO page generation.',
      type: 'External API',
      source: 'INE (Instituto Nacional de Estadística)',
      enablesProjects: ['programmatic-seo-pages', 'gmb-automation'],
      priority: 'Critical',
      effort: 'Low',
      status: 'Not Started',
      notes: 'Public data, needs one-time import + yearly refresh',
    },
    {
      id: 'irpf-tax-rules',
      name: 'IRPF Tax Rules Database',
      description: 'Tax bracket data, IRPF deduction percentages, deadlines by autonomous community. For personalized savings calculations.',
      type: 'Internal Database',
      source: 'AEAT (Tax Agency) + Manual Research',
      enablesProjects: ['irpf-calculator', 'programmatic-seo-pages', 'unified-quote-api'],
      priority: 'High',
      effort: 'Medium',
      status: 'Not Started',
      notes: 'Changes yearly, needs maintenance workflow',
    },

    // HIGH PRIORITY - Enable key features
    {
      id: 'installation-completion-timestamp',
      name: 'Installation Completion Date',
      description: 'Timestamp when installation is marked complete. Triggers post-install workflows (reviews, surveys).',
      type: 'CRM Field',
      source: 'Holded CRM',
      enablesProjects: ['review-generation-system', 'customer-satisfaction-survey', 'installer-performance-tracking'],
      priority: 'High',
      effort: 'Low',
      status: 'Not Started',
      notes: 'Simple field addition to Opportunities',
    },
    {
      id: 'service-territory-mapping',
      name: 'Service Territory Database',
      description: 'Geographic boundaries for each GMB location. Which postal codes each "location" serves.',
      type: 'Internal Database',
      source: 'Manual Definition',
      enablesProjects: ['gmb-automation', 'review-generation-system', 'installer-matching'],
      priority: 'High',
      effort: 'Medium',
      status: 'Not Started',
      notes: 'Need to define 50+ service areas across Spain',
    },
    {
      id: 'google-business-api-access',
      name: 'Google Business Profile API',
      description: 'OAuth access to manage multiple GMB locations: posts, reviews, Q&A, photos.',
      type: 'External API',
      source: 'Google Business API',
      enablesProjects: ['gmb-automation', 'review-generation-system'],
      priority: 'High',
      effort: 'Medium',
      status: 'Not Started',
      notes: 'Requires API verification process with Google',
    },

    // MEDIUM PRIORITY - Enable optimization features
    {
      id: 'recycling-attempt-count',
      name: 'Lead Recycling Attempt Counter',
      description: 'Track how many times a lost lead has been re-engaged. Prevents over-contacting.',
      type: 'CRM Field',
      source: 'Holded CRM',
      enablesProjects: ['lead-recycling-workflow'],
      priority: 'Medium',
      effort: 'Low',
      status: 'Not Started',
    },
    {
      id: 'reengagement-cooldown-rules',
      name: 'Re-engagement Cooldown Configuration',
      description: 'Rules for when lost leads can be re-contacted based on lost reason, time elapsed, and previous attempts.',
      type: 'Configuration',
      source: 'Internal Config',
      enablesProjects: ['lead-recycling-workflow', 'funnel-automation-os'],
      priority: 'Medium',
      effort: 'Low',
      status: 'Not Started',
    },
    {
      id: 'provider-integration-health',
      name: 'Provider Integration Health Metrics',
      description: 'Webhook delivery success rates, error logs, latency per lead provider.',
      type: 'Calculated/Aggregated',
      source: 'Internal Logs + Monitoring',
      enablesProjects: ['api-self-service-portal', 'campaign-os', 'data-quality-monitor'],
      priority: 'Medium',
      effort: 'Medium',
      status: 'Not Started',
      notes: 'Requires logging infrastructure',
    },
    {
      id: 'competitor-pricing-intel',
      name: 'Competitor Pricing Intelligence',
      description: 'Scraped or manually tracked competitor pricing, offers, and positioning.',
      type: 'Internal Database',
      source: 'Web Scraping + Manual Research',
      enablesProjects: ['competitor-intel-agent', 'programmatic-seo-pages'],
      priority: 'Medium',
      effort: 'High',
      status: 'Not Started',
      notes: 'Legal considerations for scraping',
    },
    {
      id: 'ad-spend-tracking',
      name: 'Ad Spend & Attribution Data',
      description: 'Daily ad spend by campaign/channel with attribution to leads and sales.',
      type: 'External API',
      source: 'Google Ads, Meta Ads, LinkedIn',
      enablesProjects: ['campaign-os', 'reporting-hub', 'partner-expansion-tool'],
      priority: 'Medium',
      effort: 'Medium',
      status: 'Partial',
      notes: 'Some UTM tracking exists, needs full attribution pipeline',
    },

    // LOWER PRIORITY - Nice to have
    {
      id: 'customer-nps-scores',
      name: 'Customer NPS & Satisfaction Scores',
      description: 'Net Promoter Scores and satisfaction survey results linked to deals.',
      type: 'CRM Field',
      source: 'Survey Tool + Holded',
      enablesProjects: ['customer-satisfaction-survey', 'installer-performance-tracking', 'review-generation-system'],
      priority: 'Low',
      effort: 'Low',
      status: 'Not Started',
    },
    {
      id: 'installer-certifications',
      name: 'Installer Certification Database',
      description: 'Certifications, training completed, and expiry dates per installer.',
      type: 'Internal Database',
      source: 'Manual Entry',
      enablesProjects: ['installer-portal-product', 'installer-matching', 'installer-performance-tracking'],
      priority: 'Low',
      effort: 'Low',
      status: 'Not Started',
    },
  ];
}

// =============================================================================
// SUB-TASK SYSTEM
// Detailed breakdown of each project into manageable sub-tasks
// =============================================================================

export type SubTaskStatus = 'Not Started' | 'In Progress' | 'Blocked' | 'Done';
export type AIPotential = 'High' | 'Medium' | 'Low' | 'None';
export type KnowledgeArea =
  | 'API Integration'
  | 'Frontend/React'
  | 'Database/SQL'
  | 'LLM/Prompt Engineering'
  | 'Security/Auth'
  | 'Data Analytics'
  | 'Business Logic'
  | 'External APIs'
  | 'Compliance/Legal'
  | 'UX Design'
  | 'DevOps';

export interface SubTask {
  id: string;
  title: string;
  description: string;

  // Effort & Skills
  estimatedHours: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  toolsNeeded: string[];
  knowledgeAreas: KnowledgeArea[];

  // AI Assessment
  aiPotential: AIPotential;
  aiAssistDescription: string;

  // Dependencies
  dependsOnTasks: string[];
  blockedBy: string[];

  // Cross-project sharing
  sharedWithProjects: string[];
  isFoundational: boolean;

  // Status
  status: SubTaskStatus;
}

export interface SharedTask {
  id: string;
  name: string;
  description: string;
  sharedAcrossCount: number;
  projectIds: string[];
  estimatedHours: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  status: SubTaskStatus;
}

export interface ProjectSubTasks {
  projectId: string;
  subTasks: SubTask[];
  criticalPath: string[];
  totalEstimatedHours: string;
}

// =============================================================================
// SHARED/FOUNDATIONAL TASKS
// Tasks that appear across multiple projects - should only be built once
// =============================================================================

export function getSharedTasks(): SharedTask[] {
  return [
    {
      id: 'shared-whatsapp-api',
      name: 'WhatsApp Conversation History API',
      description: 'Pull full conversation history from Woztell including timestamps, direction (inbound/outbound), and message content.',
      sharedAcrossCount: 5,
      projectIds: ['whatsapp-conversation-summary', 'ai-cortex', 'funnel-automation-os', 'sdr-portal', 'contact-prioritization-engine'],
      estimatedHours: '20-30h',
      priority: 'Critical',
      status: 'Not Started',
    },
    {
      id: 'shared-installer-auth',
      name: 'Installer Authentication System',
      description: 'Secure login system for installers with JWT tokens and role-based permissions.',
      sharedAcrossCount: 4,
      projectIds: ['installer-portal-product', 'installer-feedback-system', 'installer-quote-sync', 'installer-performance-tracking'],
      estimatedHours: '40-50h',
      priority: 'Critical',
      status: 'Not Started',
    },
    {
      id: 'shared-llm-integration',
      name: 'LLM Integration Framework',
      description: 'Unified layer for connecting to Claude/OpenAI with prompt templates and caching.',
      sharedAcrossCount: 8,
      projectIds: ['ai-cortex', 'whatsapp-conversation-summary', 'contact-prioritization-engine', 'competitor-intel-agent', 'review-generation-system', 'sdr-portal', 'funnel-automation-os', 'campaign-os'],
      estimatedHours: '25-35h',
      priority: 'Critical',
      status: 'Not Started',
    },
    {
      id: 'shared-stage-timestamps',
      name: 'Opportunity Stage Timestamps',
      description: 'Store timestamp for each stage change on opportunities for SLA and performance tracking.',
      sharedAcrossCount: 4,
      projectIds: ['installer-performance-tracking', 'dynamic-allocation-engine', 'reporting-hub', 'installer-portal-product'],
      estimatedHours: '10-15h',
      priority: 'Critical',
      status: 'Not Started',
    },
    {
      id: 'shared-pvgis-integration',
      name: 'PVGIS Solar Yield Integration',
      description: 'Integration with EU PVGIS API for solar radiation and yield estimates by location.',
      sharedAcrossCount: 3,
      projectIds: ['programmatic-seo-pages', 'unified-quote-api', 'pvpc-savings-widget'],
      estimatedHours: '10-15h',
      priority: 'High',
      status: 'Not Started',
    },
    {
      id: 'shared-esios-integration',
      name: 'ESIOS Real-Time PVPC Prices',
      description: 'Integration with Red Eléctrica for real-time electricity prices.',
      sharedAcrossCount: 3,
      projectIds: ['pvpc-savings-widget', 'unified-quote-api', 'programmatic-seo-pages'],
      estimatedHours: '10-15h',
      priority: 'High',
      status: 'Not Started',
    },
    {
      id: 'shared-alerting-system',
      name: 'Slack/Email Alerting Framework',
      description: 'Reusable alerting system for sending notifications via Slack and email.',
      sharedAcrossCount: 5,
      projectIds: ['data-quality-monitor', 'answer-rate-monitoring', 'installer-performance-tracking', 'dynamic-allocation-engine', 'reporting-hub'],
      estimatedHours: '15-20h',
      priority: 'High',
      status: 'Not Started',
    },
    {
      id: 'shared-dashboard-framework',
      name: 'React Dashboard Components',
      description: 'Reusable chart components, data tables, and dashboard layouts.',
      sharedAcrossCount: 6,
      projectIds: ['reporting-hub', 'campaign-os', 'installer-portal-product', 'sdr-portal', 'investor-portal', 'data-quality-monitor'],
      estimatedHours: '20-30h',
      priority: 'High',
      status: 'Not Started',
    },
  ];
}

// =============================================================================
// PROJECT SUB-TASKS
// Detailed sub-task breakdown for each project
// =============================================================================

export function getProjectSubTasks(): ProjectSubTasks[] {
  return [
    // =========================================================================
    // 🏗️ PILLAR 1: DATA FOUNDATION
    // =========================================================================
    {
      projectId: 'unified-data-layer',
      totalEstimatedHours: '90-125h',
      criticalPath: ['udl-1', 'udl-2', 'udl-3', 'udl-4', 'udl-5'],
      subTasks: [
        {
          id: 'udl-1',
          title: 'Add Stage Timestamp Tracking',
          description: 'Store timestamp for each stage change in opportunities. Create database migration and Zoho sync.',
          estimatedHours: '10-15h',
          difficulty: 'Medium',
          toolsNeeded: ['PostgreSQL', 'Zoho API', 'Node.js'],
          knowledgeAreas: ['Database/SQL', 'API Integration'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate migration scripts, API handlers, and sync logic',
          dependsOnTasks: [],
          blockedBy: [],
          sharedWithProjects: ['reporting-hub', 'installer-performance-tracking', 'dynamic-allocation-engine'],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'udl-2',
          title: 'Add Call Transcripts API',
          description: 'Integrate Aircall API to fetch call recordings and transcripts. Store and index for AI analysis.',
          estimatedHours: '25-35h',
          difficulty: 'Hard',
          toolsNeeded: ['Aircall API', 'Node.js', 'PostgreSQL', 'Whisper/Transcription'],
          knowledgeAreas: ['API Integration', 'Database/SQL'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can generate API integration boilerplate and data models',
          dependsOnTasks: ['udl-1'],
          blockedBy: ['Aircall API access'],
          sharedWithProjects: ['ai-cortex', 'sdr-portal', 'contact-prioritization-engine'],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'udl-3',
          title: 'Add WhatsApp History API',
          description: 'Pull full conversation history from Woztell including timestamps and message direction.',
          estimatedHours: '20-30h',
          difficulty: 'Medium',
          toolsNeeded: ['Woztell API', 'Node.js', 'PostgreSQL'],
          knowledgeAreas: ['API Integration', 'Database/SQL'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can help with data mapping and pagination handling',
          dependsOnTasks: ['udl-1'],
          blockedBy: ['Woztell API documentation'],
          sharedWithProjects: ['whatsapp-conversation-summary', 'funnel-automation-os', 'sdr-portal'],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'udl-4',
          title: 'Add Financial Data Endpoints',
          description: 'Create endpoints for invoice amounts, payments, and CPL data.',
          estimatedHours: '15-20h',
          difficulty: 'Medium',
          toolsNeeded: ['Holded API', 'Node.js', 'PostgreSQL'],
          knowledgeAreas: ['API Integration', 'Business Logic'],
          aiPotential: 'Low',
          aiAssistDescription: 'Business logic heavy - needs human expertise on financial rules',
          dependsOnTasks: ['udl-1'],
          blockedBy: ['Finance team input on data structure'],
          sharedWithProjects: ['automated-invoicing', 'reporting-hub'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'udl-5',
          title: 'Real-time Event Webhooks',
          description: 'Create webhook system to push events to subscribers (deal updates, calls, opportunities).',
          estimatedHours: '20-25h',
          difficulty: 'Hard',
          toolsNeeded: ['Node.js', 'WebSockets', 'Redis'],
          knowledgeAreas: ['API Integration', 'DevOps'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can generate webhook handlers and event routing logic',
          dependsOnTasks: ['udl-1', 'udl-2', 'udl-3'],
          blockedBy: [],
          sharedWithProjects: ['funnel-automation-os', 'sdr-portal'],
          isFoundational: true,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'reporting-hub',
      totalEstimatedHours: '50-70h',
      criticalPath: ['rh-1', 'rh-2', 'rh-3', 'rh-4', 'rh-5'],
      subTasks: [
        {
          id: 'rh-1',
          title: 'Define KPI Specifications',
          description: 'Document all metrics, formulas, and thresholds with business stakeholders.',
          estimatedHours: '8-10h',
          difficulty: 'Easy',
          toolsNeeded: ['Notion', 'Spreadsheet'],
          knowledgeAreas: ['Data Analytics', 'Business Logic'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can suggest standard KPIs and formulas based on industry',
          dependsOnTasks: [],
          blockedBy: ['Leadership alignment on metrics'],
          sharedWithProjects: ['investor-portal'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'rh-2',
          title: 'Build KPI Calculation Engine',
          description: 'Backend service for computing metrics from raw data. SQL aggregations and caching.',
          estimatedHours: '15-20h',
          difficulty: 'Medium',
          toolsNeeded: ['Node.js', 'PostgreSQL', 'Redis'],
          knowledgeAreas: ['Database/SQL', 'Data Analytics'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate SQL queries and aggregation logic',
          dependsOnTasks: ['rh-1'],
          blockedBy: [],
          sharedWithProjects: ['investor-portal', 'campaign-os'],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'rh-3',
          title: 'Create Dashboard UI Framework',
          description: 'Reusable React chart components using Recharts or Chart.js.',
          estimatedHours: '15-20h',
          difficulty: 'Medium',
          toolsNeeded: ['React', 'Recharts/Chart.js', 'Tailwind'],
          knowledgeAreas: ['Frontend/React', 'Data Analytics'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate chart components and dashboard layouts',
          dependsOnTasks: ['rh-2'],
          blockedBy: [],
          sharedWithProjects: ['investor-portal', 'installer-portal-product', 'sdr-portal'],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'rh-4',
          title: 'Implement Historical Trend Analysis',
          description: 'Time-series storage for tracking metrics over time. Week-over-week comparisons.',
          estimatedHours: '10-15h',
          difficulty: 'Medium',
          toolsNeeded: ['PostgreSQL', 'TimescaleDB'],
          knowledgeAreas: ['Database/SQL', 'Data Analytics'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can help with time-series queries and schema design',
          dependsOnTasks: ['rh-2'],
          blockedBy: [],
          sharedWithProjects: ['investor-portal'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'rh-5',
          title: 'Add Export & Scheduling',
          description: 'PDF/Excel export functionality and scheduled email reports.',
          estimatedHours: '8-10h',
          difficulty: 'Easy',
          toolsNeeded: ['React-PDF', 'Node-cron', 'SendGrid'],
          knowledgeAreas: ['Frontend/React', 'DevOps'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate PDF templates and scheduling logic',
          dependsOnTasks: ['rh-3', 'rh-4'],
          blockedBy: [],
          sharedWithProjects: ['investor-portal'],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'data-quality-monitor',
      totalEstimatedHours: '30-40h',
      criticalPath: ['dqm-1', 'dqm-2', 'dqm-3', 'dqm-4', 'dqm-5'],
      subTasks: [
        {
          id: 'dqm-1',
          title: 'Define Quality Rules',
          description: 'Document schema completeness requirements and freshness thresholds per resource.',
          estimatedHours: '5-8h',
          difficulty: 'Easy',
          toolsNeeded: ['Documentation'],
          knowledgeAreas: ['Data Analytics', 'Business Logic'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can suggest quality rules based on data types',
          dependsOnTasks: [],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'dqm-2',
          title: 'Build Quality Scoring Engine',
          description: 'Calculate health scores for each API resource based on defined rules.',
          estimatedHours: '10-15h',
          difficulty: 'Medium',
          toolsNeeded: ['Node.js', 'PostgreSQL'],
          knowledgeAreas: ['Database/SQL', 'Data Analytics'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate scoring algorithms and validation logic',
          dependsOnTasks: ['dqm-1'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'dqm-3',
          title: 'Create Alerting System',
          description: 'Slack and email notifications when data quality degrades below thresholds.',
          estimatedHours: '8-10h',
          difficulty: 'Easy',
          toolsNeeded: ['Slack API', 'SendGrid', 'Node.js'],
          knowledgeAreas: ['API Integration', 'DevOps'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate webhook handlers and notification templates',
          dependsOnTasks: ['dqm-2'],
          blockedBy: [],
          sharedWithProjects: ['answer-rate-monitoring', 'installer-performance-tracking'],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'dqm-4',
          title: 'Build Monitoring Dashboard',
          description: 'Real-time visualization of data quality across all resources.',
          estimatedHours: '8-12h',
          difficulty: 'Medium',
          toolsNeeded: ['React', 'Dashboard framework'],
          knowledgeAreas: ['Frontend/React', 'Data Analytics'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate dashboard components and layouts',
          dependsOnTasks: ['dqm-2', 'dqm-3'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'dqm-5',
          title: 'Implement Auto-Remediation',
          description: 'Self-healing scripts for common data issues (missing fields, stale records).',
          estimatedHours: '5-8h',
          difficulty: 'Medium',
          toolsNeeded: ['Node.js'],
          knowledgeAreas: ['DevOps', 'Database/SQL'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can suggest remediation patterns and generate scripts',
          dependsOnTasks: ['dqm-2'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },

    // =========================================================================
    // 🚀 PILLAR 2: KNOWLEDGE GENERATION
    // =========================================================================
    {
      projectId: 'campaign-os',
      totalEstimatedHours: '70-90h',
      criticalPath: ['cos-1', 'cos-3', 'cos-4', 'cos-5', 'cos-6'],
      subTasks: [
        {
          id: 'cos-1',
          title: 'Meta Ads API Integration',
          description: 'Connect to Facebook/Instagram Ads API for campaign data, spend, and performance.',
          estimatedHours: '15-20h',
          difficulty: 'Hard',
          toolsNeeded: ['Meta Business API', 'Node.js', 'OAuth'],
          knowledgeAreas: ['API Integration', 'External APIs'],
          aiPotential: 'Low',
          aiAssistDescription: 'Complex OAuth flows - needs manual setup and testing',
          dependsOnTasks: [],
          blockedBy: ['Meta Business Manager access'],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'cos-2',
          title: 'Google Ads API Integration',
          description: 'Connect to Google Ads API for campaign data and performance metrics.',
          estimatedHours: '15-20h',
          difficulty: 'Hard',
          toolsNeeded: ['Google Ads API', 'Node.js', 'OAuth'],
          knowledgeAreas: ['API Integration', 'External APIs'],
          aiPotential: 'Low',
          aiAssistDescription: 'Complex OAuth flows - needs manual setup and testing',
          dependsOnTasks: [],
          blockedBy: ['Google Ads MCC access'],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'cos-3',
          title: 'UTM-to-CRM Attribution Pipeline',
          description: 'Map ad clicks to deals using UTM parameters. Track full attribution path.',
          estimatedHours: '12-15h',
          difficulty: 'Medium',
          toolsNeeded: ['Node.js', 'PostgreSQL'],
          knowledgeAreas: ['Data Analytics', 'Business Logic'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can help with attribution logic and data mapping',
          dependsOnTasks: ['cos-1', 'cos-2'],
          blockedBy: [],
          sharedWithProjects: ['reporting-hub'],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'cos-4',
          title: 'Spend Dashboard & ROI Tracking',
          description: 'Visualize spend vs revenue with ROI calculations per campaign.',
          estimatedHours: '15-20h',
          difficulty: 'Medium',
          toolsNeeded: ['React', 'Chart components'],
          knowledgeAreas: ['Frontend/React', 'Data Analytics'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate dashboard components and visualization logic',
          dependsOnTasks: ['cos-3'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'cos-5',
          title: 'AI Creative Suggestions',
          description: 'Analyze winning ads and suggest variations using LLM.',
          estimatedHours: '10-15h',
          difficulty: 'Medium',
          toolsNeeded: ['OpenAI/Claude API', 'Node.js'],
          knowledgeAreas: ['LLM/Prompt Engineering'],
          aiPotential: 'High',
          aiAssistDescription: 'Core AI task - can generate prompts and analysis logic',
          dependsOnTasks: ['cos-4'],
          blockedBy: [],
          sharedWithProjects: ['competitor-intel-agent'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'cos-6',
          title: 'Automated Bid Management',
          description: 'Rule-based bid optimization with cron jobs.',
          estimatedHours: '10-12h',
          difficulty: 'Medium',
          toolsNeeded: ['Node.js', 'Cron', 'Ad APIs'],
          knowledgeAreas: ['Business Logic', 'DevOps'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can help implement bidding rules and scheduling',
          dependsOnTasks: ['cos-1', 'cos-2', 'cos-4'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'funnel-automation-os',
      totalEstimatedHours: '80-100h',
      criticalPath: ['fao-2', 'fao-1', 'fao-3', 'fao-4', 'fao-6'],
      subTasks: [
        {
          id: 'fao-1',
          title: 'WhatsApp Flow Builder',
          description: 'Visual editor for creating conversation flows with drag-and-drop.',
          estimatedHours: '20-25h',
          difficulty: 'Hard',
          toolsNeeded: ['React', 'React Flow', 'Node.js'],
          knowledgeAreas: ['Frontend/React', 'UX Design'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Complex UI - can help with component structure',
          dependsOnTasks: ['fao-2'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'fao-2',
          title: 'WhatsApp Business API Integration',
          description: 'Send/receive messages programmatically via WhatsApp Business API.',
          estimatedHours: '15-20h',
          difficulty: 'Hard',
          toolsNeeded: ['WhatsApp Business API', 'Woztell', 'Node.js'],
          knowledgeAreas: ['API Integration', 'External APIs'],
          aiPotential: 'Low',
          aiAssistDescription: 'Platform-specific requirements need manual handling',
          dependsOnTasks: [],
          blockedBy: ['WhatsApp Business verification'],
          sharedWithProjects: ['whatsapp-conversation-summary'],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'fao-3',
          title: 'Routing Engine',
          description: 'Route leads based on rules, availability, and performance scores.',
          estimatedHours: '15-18h',
          difficulty: 'Medium',
          toolsNeeded: ['Node.js', 'Redis'],
          knowledgeAreas: ['Business Logic', 'Database/SQL'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can help implement routing rules and decision trees',
          dependsOnTasks: ['fao-2'],
          blockedBy: [],
          sharedWithProjects: ['dynamic-allocation-engine'],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'fao-4',
          title: 'A/B Testing Framework',
          description: 'Split traffic and measure outcomes for flow optimization.',
          estimatedHours: '12-15h',
          difficulty: 'Medium',
          toolsNeeded: ['Node.js', 'PostgreSQL'],
          knowledgeAreas: ['Data Analytics', 'Business Logic'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate A/B testing logic and statistical analysis',
          dependsOnTasks: ['fao-1', 'fao-3'],
          blockedBy: [],
          sharedWithProjects: ['campaign-os'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'fao-5',
          title: 'Aircall IVR Integration',
          description: 'Automated call flows with interactive voice response.',
          estimatedHours: '10-12h',
          difficulty: 'Medium',
          toolsNeeded: ['Aircall API', 'Node.js'],
          knowledgeAreas: ['API Integration', 'External APIs'],
          aiPotential: 'Low',
          aiAssistDescription: 'Platform-specific - needs manual API work',
          dependsOnTasks: [],
          blockedBy: ['Aircall IVR access'],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'fao-6',
          title: 'Analytics Dashboard',
          description: 'Track flow performance, conversion rates, and drop-off points.',
          estimatedHours: '10-12h',
          difficulty: 'Medium',
          toolsNeeded: ['React', 'Charts'],
          knowledgeAreas: ['Frontend/React', 'Data Analytics'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate analytics dashboard components',
          dependsOnTasks: ['fao-4'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'partner-expansion-tool',
      totalEstimatedHours: '50-70h',
      criticalPath: ['pet-1', 'pet-2', 'pet-3', 'pet-4'],
      subTasks: [
        {
          id: 'pet-1',
          title: 'Prospect Database Setup',
          description: 'Create database schema for storing and scoring potential installer partners.',
          estimatedHours: '10-15h',
          difficulty: 'Medium',
          toolsNeeded: ['PostgreSQL', 'Airtable'],
          knowledgeAreas: ['Database/SQL'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate database schema and models',
          dependsOnTasks: [],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'pet-2',
          title: 'Email Sequence Builder',
          description: 'Create and manage automated outreach sequences.',
          estimatedHours: '12-15h',
          difficulty: 'Medium',
          toolsNeeded: ['SendGrid', 'Node.js'],
          knowledgeAreas: ['API Integration', 'Business Logic'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate email templates and sequence logic',
          dependsOnTasks: ['pet-1'],
          blockedBy: [],
          sharedWithProjects: ['lead-recycling-workflow'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'pet-3',
          title: 'Engagement Scoring Model',
          description: 'Score prospects based on email opens, clicks, and website visits.',
          estimatedHours: '10-12h',
          difficulty: 'Medium',
          toolsNeeded: ['Node.js', 'Analytics'],
          knowledgeAreas: ['Data Analytics', 'Business Logic'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate scoring algorithms',
          dependsOnTasks: ['pet-2'],
          blockedBy: [],
          sharedWithProjects: ['contact-prioritization-engine'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'pet-4',
          title: 'Pipeline Dashboard',
          description: 'Track prospects through stages with filtering and sorting.',
          estimatedHours: '12-15h',
          difficulty: 'Medium',
          toolsNeeded: ['React', 'Dashboard components'],
          knowledgeAreas: ['Frontend/React'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate dashboard and table components',
          dependsOnTasks: ['pet-1', 'pet-3'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'pet-5',
          title: 'LinkedIn Integration',
          description: 'Enrich prospect data from LinkedIn profiles.',
          estimatedHours: '8-10h',
          difficulty: 'Hard',
          toolsNeeded: ['LinkedIn API', 'Scrapers'],
          knowledgeAreas: ['API Integration', 'External APIs'],
          aiPotential: 'Low',
          aiAssistDescription: 'Platform restrictions - needs manual handling',
          dependsOnTasks: ['pet-1'],
          blockedBy: ['LinkedIn API access'],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },

    // =========================================================================
    // 👥 PILLAR 3: HUMAN EMPOWERMENT
    // =========================================================================
    {
      projectId: 'sdr-portal',
      totalEstimatedHours: '85-110h',
      criticalPath: ['sdr-1', 'sdr-3', 'sdr-2', 'sdr-4', 'sdr-5'],
      subTasks: [
        {
          id: 'sdr-1',
          title: 'WhatsApp Summary Integration',
          description: 'AI-generated summaries of WhatsApp conversations for call preparation.',
          estimatedHours: '25-35h',
          difficulty: 'Hard',
          toolsNeeded: ['LLM API', 'React', 'WhatsApp History API'],
          knowledgeAreas: ['LLM/Prompt Engineering', 'Frontend/React'],
          aiPotential: 'High',
          aiAssistDescription: 'Core AI feature - can generate prompts and UI',
          dependsOnTasks: [],
          blockedBy: ['WhatsApp History API'],
          sharedWithProjects: ['whatsapp-conversation-summary'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'sdr-2',
          title: 'Contact Prioritization UI',
          description: 'Display AI-ranked contact list with scores and reasoning.',
          estimatedHours: '15-20h',
          difficulty: 'Medium',
          toolsNeeded: ['React', 'Backend APIs'],
          knowledgeAreas: ['Frontend/React', 'UX Design'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate list components and UI logic',
          dependsOnTasks: ['sdr-3'],
          blockedBy: [],
          sharedWithProjects: ['contact-prioritization-engine'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'sdr-3',
          title: 'Cortex Copilot Panel',
          description: 'In-context AI suggestions panel with real-time recommendations.',
          estimatedHours: '20-25h',
          difficulty: 'Hard',
          toolsNeeded: ['LLM API', 'WebSockets', 'React'],
          knowledgeAreas: ['LLM/Prompt Engineering', 'Frontend/React'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate AI interaction patterns and prompts',
          dependsOnTasks: ['sdr-1'],
          blockedBy: [],
          sharedWithProjects: ['ai-cortex'],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'sdr-4',
          title: 'Performance Tracking Dashboard',
          description: 'SDR metrics, goals, and performance visualization.',
          estimatedHours: '12-15h',
          difficulty: 'Medium',
          toolsNeeded: ['React', 'Charts'],
          knowledgeAreas: ['Frontend/React', 'Data Analytics'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate dashboard components',
          dependsOnTasks: ['sdr-2'],
          blockedBy: [],
          sharedWithProjects: ['reporting-hub'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'sdr-5',
          title: 'Call Script Assistant',
          description: 'Dynamic call scripts generated based on lead context.',
          estimatedHours: '10-12h',
          difficulty: 'Medium',
          toolsNeeded: ['LLM API', 'React'],
          knowledgeAreas: ['LLM/Prompt Engineering'],
          aiPotential: 'High',
          aiAssistDescription: 'Core AI feature - can generate scripts and prompts',
          dependsOnTasks: ['sdr-1', 'sdr-3'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'installer-portal-product',
      totalEstimatedHours: '80-100h',
      criticalPath: ['ip-1', 'ip-2', 'ip-3', 'ip-4', 'ip-5', 'ip-6'],
      subTasks: [
        {
          id: 'ip-1',
          title: 'Authentication System',
          description: 'Secure installer login with JWT tokens and role-based access.',
          estimatedHours: '40-50h',
          difficulty: 'Hard',
          toolsNeeded: ['Auth0/Custom', 'JWT', 'Node.js'],
          knowledgeAreas: ['Security/Auth', 'API Integration'],
          aiPotential: 'Low',
          aiAssistDescription: 'Security-critical - needs expert review',
          dependsOnTasks: [],
          blockedBy: [],
          sharedWithProjects: ['installer-feedback-system', 'installer-quote-sync', 'installer-performance-tracking'],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'ip-2',
          title: 'Lead Management Dashboard',
          description: 'View and filter assigned leads with status updates.',
          estimatedHours: '15-20h',
          difficulty: 'Medium',
          toolsNeeded: ['React', 'APIs'],
          knowledgeAreas: ['Frontend/React', 'UX Design'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate dashboard and table components',
          dependsOnTasks: ['ip-1'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'ip-3',
          title: 'Performance Metrics View',
          description: 'Display conversion rates, response times, and SLA status.',
          estimatedHours: '10-12h',
          difficulty: 'Medium',
          toolsNeeded: ['React', 'Charts'],
          knowledgeAreas: ['Frontend/React', 'Data Analytics'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate metrics components',
          dependsOnTasks: ['ip-1'],
          blockedBy: ['Stage timestamps API'],
          sharedWithProjects: ['installer-performance-tracking'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'ip-4',
          title: 'Quote Submission Form',
          description: 'Form for installers to submit offer amounts.',
          estimatedHours: '8-10h',
          difficulty: 'Easy',
          toolsNeeded: ['React', 'APIs'],
          knowledgeAreas: ['Frontend/React'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate form components',
          dependsOnTasks: ['ip-2'],
          blockedBy: [],
          sharedWithProjects: ['installer-quote-sync'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'ip-5',
          title: 'Feedback Collection UI',
          description: 'Structured feedback form per lead with categories.',
          estimatedHours: '8-10h',
          difficulty: 'Easy',
          toolsNeeded: ['React', 'APIs'],
          knowledgeAreas: ['Frontend/React', 'UX Design'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate feedback form components',
          dependsOnTasks: ['ip-2'],
          blockedBy: [],
          sharedWithProjects: ['installer-feedback-system'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'ip-6',
          title: 'Notification System',
          description: 'Email/SMS notifications for new leads and updates.',
          estimatedHours: '8-10h',
          difficulty: 'Easy',
          toolsNeeded: ['SendGrid', 'Twilio', 'Node.js'],
          knowledgeAreas: ['API Integration'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate notification templates and logic',
          dependsOnTasks: ['ip-1'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'ai-cortex',
      totalEstimatedHours: '100-120h',
      criticalPath: ['ac-1', 'ac-2', 'ac-3', 'ac-4', 'ac-5', 'ac-6'],
      subTasks: [
        {
          id: 'ac-1',
          title: 'LLM Integration Layer',
          description: 'Unified layer for connecting to Claude/OpenAI APIs.',
          estimatedHours: '15-20h',
          difficulty: 'Medium',
          toolsNeeded: ['API SDKs', 'Node.js'],
          knowledgeAreas: ['API Integration', 'LLM/Prompt Engineering'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate SDK wrappers and API handlers',
          dependsOnTasks: [],
          blockedBy: [],
          sharedWithProjects: ['whatsapp-conversation-summary', 'sdr-portal', 'campaign-os'],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'ac-2',
          title: 'Context Aggregation Service',
          description: 'Pull relevant data for AI queries from all data sources.',
          estimatedHours: '20-25h',
          difficulty: 'Hard',
          toolsNeeded: ['Node.js', 'PostgreSQL'],
          knowledgeAreas: ['Database/SQL', 'Data Analytics'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Complex queries - can help with data aggregation',
          dependsOnTasks: ['ac-1'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'ac-3',
          title: 'Prompt Template System',
          description: 'Manage and version prompts with variables.',
          estimatedHours: '10-12h',
          difficulty: 'Medium',
          toolsNeeded: ['Node.js', 'Git-style versioning'],
          knowledgeAreas: ['LLM/Prompt Engineering'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate template management system',
          dependsOnTasks: ['ac-1'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'ac-4',
          title: 'Agent Framework',
          description: 'Multi-step AI reasoning with tool use.',
          estimatedHours: '25-30h',
          difficulty: 'Hard',
          toolsNeeded: ['LangChain/Custom', 'Node.js'],
          knowledgeAreas: ['LLM/Prompt Engineering', 'Business Logic'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Framework choice critical - needs architecture decisions',
          dependsOnTasks: ['ac-2', 'ac-3'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'ac-5',
          title: 'Real-time Suggestion Engine',
          description: 'Proactive AI suggestions based on user context.',
          estimatedHours: '15-20h',
          difficulty: 'Hard',
          toolsNeeded: ['WebSockets', 'LLM APIs'],
          knowledgeAreas: ['LLM/Prompt Engineering', 'DevOps'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Latency challenges - needs optimization',
          dependsOnTasks: ['ac-4'],
          blockedBy: [],
          sharedWithProjects: ['sdr-portal'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'ac-6',
          title: 'Learning & Feedback Loop',
          description: 'Improve AI from user feedback and outcomes.',
          estimatedHours: '15-20h',
          difficulty: 'Hard',
          toolsNeeded: ['PostgreSQL', 'Analytics'],
          knowledgeAreas: ['Data Analytics', 'LLM/Prompt Engineering'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can help design feedback collection and analysis',
          dependsOnTasks: ['ac-4', 'ac-5'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'investor-portal',
      totalEstimatedHours: '40-60h',
      criticalPath: ['inv-1', 'inv-2', 'inv-3', 'inv-4'],
      subTasks: [
        {
          id: 'inv-1',
          title: 'Investor Authentication',
          description: 'Secure login for investors with role-based access.',
          estimatedHours: '10-15h',
          difficulty: 'Medium',
          toolsNeeded: ['Auth0', 'JWT'],
          knowledgeAreas: ['Security/Auth'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can generate auth boilerplate',
          dependsOnTasks: [],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'inv-2',
          title: 'KPI Dashboard',
          description: 'Real-time performance metrics for investors.',
          estimatedHours: '12-15h',
          difficulty: 'Medium',
          toolsNeeded: ['React', 'Charts'],
          knowledgeAreas: ['Frontend/React', 'Data Analytics'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate dashboard components',
          dependsOnTasks: ['inv-1'],
          blockedBy: ['Reporting Hub KPI engine'],
          sharedWithProjects: ['reporting-hub'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'inv-3',
          title: 'Document Room',
          description: 'Secure document storage and sharing for investors.',
          estimatedHours: '10-12h',
          difficulty: 'Medium',
          toolsNeeded: ['AWS S3', 'React'],
          knowledgeAreas: ['Frontend/React', 'DevOps'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate file management components',
          dependsOnTasks: ['inv-1'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'inv-4',
          title: 'Cortex Q&A',
          description: 'AI-powered Q&A for investors to query company data.',
          estimatedHours: '12-15h',
          difficulty: 'Hard',
          toolsNeeded: ['LLM API', 'React'],
          knowledgeAreas: ['LLM/Prompt Engineering'],
          aiPotential: 'High',
          aiAssistDescription: 'Core AI feature - can generate Q&A interface',
          dependsOnTasks: ['inv-2'],
          blockedBy: ['AI Cortex context service'],
          sharedWithProjects: ['ai-cortex'],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'installer-performance-tracking',
      totalEstimatedHours: '30-40h',
      criticalPath: ['ipt-1', 'ipt-2', 'ipt-3', 'ipt-4'],
      subTasks: [
        {
          id: 'ipt-1',
          title: 'SLA Definitions',
          description: 'Define SLA thresholds for response time and conversion.',
          estimatedHours: '5-8h',
          difficulty: 'Easy',
          toolsNeeded: ['Documentation'],
          knowledgeAreas: ['Business Logic'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can suggest industry-standard SLAs',
          dependsOnTasks: [],
          blockedBy: ['Operations input'],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'ipt-2',
          title: 'Calculation Engine',
          description: 'Backend service to compute performance metrics per installer.',
          estimatedHours: '12-15h',
          difficulty: 'Medium',
          toolsNeeded: ['Node.js', 'PostgreSQL'],
          knowledgeAreas: ['Database/SQL', 'Data Analytics'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate calculation logic and SQL',
          dependsOnTasks: ['ipt-1'],
          blockedBy: ['Stage timestamps API'],
          sharedWithProjects: ['dynamic-allocation-engine'],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'ipt-3',
          title: 'Leaderboard UI',
          description: 'Visual ranking of installers by performance.',
          estimatedHours: '8-10h',
          difficulty: 'Easy',
          toolsNeeded: ['React'],
          knowledgeAreas: ['Frontend/React'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate leaderboard components',
          dependsOnTasks: ['ipt-2'],
          blockedBy: [],
          sharedWithProjects: ['installer-portal-product'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'ipt-4',
          title: 'Alert System',
          description: 'Alerts when installers fall below SLA thresholds.',
          estimatedHours: '5-8h',
          difficulty: 'Easy',
          toolsNeeded: ['Slack API', 'SendGrid'],
          knowledgeAreas: ['API Integration'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate alert logic and templates',
          dependsOnTasks: ['ipt-2'],
          blockedBy: [],
          sharedWithProjects: ['data-quality-monitor'],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'dynamic-allocation-engine',
      totalEstimatedHours: '50-70h',
      criticalPath: ['dae-1', 'dae-2', 'dae-3', 'dae-4'],
      subTasks: [
        {
          id: 'dae-1',
          title: 'Scoring Model',
          description: 'Algorithm to score installers based on performance, capacity, and region.',
          estimatedHours: '15-20h',
          difficulty: 'Hard',
          toolsNeeded: ['Node.js', 'PostgreSQL'],
          knowledgeAreas: ['Data Analytics', 'Business Logic'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can help with scoring algorithms',
          dependsOnTasks: [],
          blockedBy: ['Installer performance tracking'],
          sharedWithProjects: ['installer-performance-tracking'],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'dae-2',
          title: 'Real-time Router',
          description: 'Route leads instantly to best available installer.',
          estimatedHours: '15-18h',
          difficulty: 'Hard',
          toolsNeeded: ['Node.js', 'Redis'],
          knowledgeAreas: ['Business Logic', 'DevOps'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can help with routing logic',
          dependsOnTasks: ['dae-1'],
          blockedBy: [],
          sharedWithProjects: ['funnel-automation-os'],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'dae-3',
          title: 'Quota Balancing',
          description: 'Track and balance lead quotas across installers.',
          estimatedHours: '10-12h',
          difficulty: 'Medium',
          toolsNeeded: ['Node.js', 'PostgreSQL'],
          knowledgeAreas: ['Business Logic'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate quota tracking logic',
          dependsOnTasks: ['dae-2'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'dae-4',
          title: 'Deviation Alerts',
          description: 'Alerts when allocation deviates from targets.',
          estimatedHours: '8-10h',
          difficulty: 'Easy',
          toolsNeeded: ['Slack API', 'Node.js'],
          knowledgeAreas: ['API Integration'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate alert logic',
          dependsOnTasks: ['dae-3'],
          blockedBy: [],
          sharedWithProjects: ['data-quality-monitor'],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    // =========================================================================
    // REMAINING PROJECTS (17 more)
    // =========================================================================
    {
      projectId: 'whatsapp-conversation-summary',
      totalEstimatedHours: '25-35h',
      criticalPath: ['wcs-1', 'wcs-2', 'wcs-3', 'wcs-4'],
      subTasks: [
        {
          id: 'wcs-1',
          title: 'WhatsApp History API Integration',
          description: 'Connect to Woztell API to fetch conversation history per contact.',
          estimatedHours: '8-12h',
          difficulty: 'Medium',
          toolsNeeded: ['Woztell API', 'Node.js'],
          knowledgeAreas: ['API Integration'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can help with API integration boilerplate',
          dependsOnTasks: [],
          blockedBy: ['shared-whatsapp-api'],
          sharedWithProjects: ['sdr-portal', 'ai-cortex'],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'wcs-2',
          title: 'LLM Summarization Engine',
          description: 'Use Claude/GPT to generate concise summaries of conversations.',
          estimatedHours: '8-10h',
          difficulty: 'Medium',
          toolsNeeded: ['Claude API', 'Node.js'],
          knowledgeAreas: ['LLM/Prompt Engineering'],
          aiPotential: 'High',
          aiAssistDescription: 'Core AI task - can design prompts and summarization logic',
          dependsOnTasks: ['wcs-1'],
          blockedBy: [],
          sharedWithProjects: ['ai-cortex'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'wcs-3',
          title: 'Summary Caching Layer',
          description: 'Cache summaries to reduce API costs and latency.',
          estimatedHours: '5-8h',
          difficulty: 'Easy',
          toolsNeeded: ['Redis', 'Node.js'],
          knowledgeAreas: ['Database/SQL', 'DevOps'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate caching logic and invalidation strategies',
          dependsOnTasks: ['wcs-2'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'wcs-4',
          title: 'SDR Portal Integration',
          description: 'Display summaries in SDR portal before calls.',
          estimatedHours: '5-8h',
          difficulty: 'Easy',
          toolsNeeded: ['React'],
          knowledgeAreas: ['Frontend/React'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate React components',
          dependsOnTasks: ['wcs-3'],
          blockedBy: [],
          sharedWithProjects: ['sdr-portal'],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'contact-prioritization-engine',
      totalEstimatedHours: '45-60h',
      criticalPath: ['cpe-1', 'cpe-2', 'cpe-3', 'cpe-4', 'cpe-5'],
      subTasks: [
        {
          id: 'cpe-1',
          title: 'Data Aggregation Service',
          description: 'Aggregate all contact signals: calls, WhatsApp, emails, web visits.',
          estimatedHours: '12-15h',
          difficulty: 'Medium',
          toolsNeeded: ['Node.js', 'PostgreSQL'],
          knowledgeAreas: ['Database/SQL', 'API Integration'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can help with data aggregation queries',
          dependsOnTasks: [],
          blockedBy: ['shared-whatsapp-api'],
          sharedWithProjects: ['ai-cortex'],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'cpe-2',
          title: 'Scoring Algorithm',
          description: 'ML model or rule-based scoring for contact readiness.',
          estimatedHours: '15-18h',
          difficulty: 'Hard',
          toolsNeeded: ['Python/Node.js', 'PostgreSQL'],
          knowledgeAreas: ['Data Analytics', 'Business Logic'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can suggest scoring models and features',
          dependsOnTasks: ['cpe-1'],
          blockedBy: [],
          sharedWithProjects: ['dynamic-allocation-engine'],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'cpe-3',
          title: 'Best Time to Contact Analysis',
          description: 'Analyze historical call patterns to suggest optimal contact times.',
          estimatedHours: '8-12h',
          difficulty: 'Medium',
          toolsNeeded: ['PostgreSQL', 'Node.js'],
          knowledgeAreas: ['Data Analytics'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate time analysis queries',
          dependsOnTasks: ['cpe-1'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'cpe-4',
          title: 'Prioritized Queue API',
          description: 'API endpoint returning ranked contacts for SDRs.',
          estimatedHours: '5-8h',
          difficulty: 'Easy',
          toolsNeeded: ['Node.js'],
          knowledgeAreas: ['API Integration'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate API endpoints',
          dependsOnTasks: ['cpe-2', 'cpe-3'],
          blockedBy: [],
          sharedWithProjects: ['sdr-portal'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'cpe-5',
          title: 'UI Integration',
          description: 'Display prioritized contacts in SDR portal.',
          estimatedHours: '5-8h',
          difficulty: 'Easy',
          toolsNeeded: ['React'],
          knowledgeAreas: ['Frontend/React'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate React components',
          dependsOnTasks: ['cpe-4'],
          blockedBy: [],
          sharedWithProjects: ['sdr-portal'],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'lead-recycling-workflow',
      totalEstimatedHours: '20-30h',
      criticalPath: ['lrw-1', 'lrw-2', 'lrw-3', 'lrw-4'],
      subTasks: [
        {
          id: 'lrw-1',
          title: 'Recycling Rules Engine',
          description: 'Define rules for when leads should be recycled (e.g., stale, no response).',
          estimatedHours: '6-8h',
          difficulty: 'Medium',
          toolsNeeded: ['Node.js', 'PostgreSQL'],
          knowledgeAreas: ['Business Logic'],
          aiPotential: 'High',
          aiAssistDescription: 'Can help define and implement rules',
          dependsOnTasks: [],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'lrw-2',
          title: 'Automated Stage Transitions',
          description: 'Auto-move leads to recycled stage based on rules.',
          estimatedHours: '5-8h',
          difficulty: 'Easy',
          toolsNeeded: ['Zoho API', 'Node.js'],
          knowledgeAreas: ['API Integration', 'Business Logic'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate automation logic',
          dependsOnTasks: ['lrw-1'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'lrw-3',
          title: 'Nurture Sequence Trigger',
          description: 'Trigger email/WhatsApp nurture sequences for recycled leads.',
          estimatedHours: '6-8h',
          difficulty: 'Medium',
          toolsNeeded: ['SendGrid', 'Woztell API'],
          knowledgeAreas: ['API Integration'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate integration code',
          dependsOnTasks: ['lrw-2'],
          blockedBy: [],
          sharedWithProjects: ['funnel-automation-os'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'lrw-4',
          title: 'Recycling Dashboard',
          description: 'Track recycling rates and re-conversion success.',
          estimatedHours: '5-8h',
          difficulty: 'Easy',
          toolsNeeded: ['React', 'Charts'],
          knowledgeAreas: ['Frontend/React', 'Data Analytics'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate dashboard components',
          dependsOnTasks: ['lrw-3'],
          blockedBy: [],
          sharedWithProjects: ['reporting-hub'],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'installer-feedback-system',
      totalEstimatedHours: '20-30h',
      criticalPath: ['ifs-1', 'ifs-2', 'ifs-3', 'ifs-4'],
      subTasks: [
        {
          id: 'ifs-1',
          title: 'Feedback Schema Design',
          description: 'Design structured feedback fields (lead quality, contact info accuracy, etc.).',
          estimatedHours: '4-6h',
          difficulty: 'Easy',
          toolsNeeded: ['PostgreSQL', 'Notion'],
          knowledgeAreas: ['Database/SQL', 'Business Logic'],
          aiPotential: 'High',
          aiAssistDescription: 'Can suggest feedback schema',
          dependsOnTasks: [],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'ifs-2',
          title: 'Feedback Collection UI',
          description: 'Build form in installer portal to submit feedback.',
          estimatedHours: '6-8h',
          difficulty: 'Easy',
          toolsNeeded: ['React'],
          knowledgeAreas: ['Frontend/React', 'UX Design'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate form components',
          dependsOnTasks: ['ifs-1'],
          blockedBy: ['shared-installer-auth'],
          sharedWithProjects: ['installer-portal-product'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'ifs-3',
          title: 'Feedback API Endpoint',
          description: 'API to store and retrieve feedback per lead.',
          estimatedHours: '4-6h',
          difficulty: 'Easy',
          toolsNeeded: ['Node.js', 'PostgreSQL'],
          knowledgeAreas: ['API Integration'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate CRUD endpoints',
          dependsOnTasks: ['ifs-1'],
          blockedBy: [],
          sharedWithProjects: ['unified-data-layer'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'ifs-4',
          title: 'Feedback Analytics',
          description: 'Analyze feedback trends and surface quality issues.',
          estimatedHours: '6-8h',
          difficulty: 'Medium',
          toolsNeeded: ['PostgreSQL', 'React'],
          knowledgeAreas: ['Data Analytics', 'Frontend/React'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate analytics queries and charts',
          dependsOnTasks: ['ifs-3'],
          blockedBy: [],
          sharedWithProjects: ['reporting-hub'],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'installer-quote-sync',
      totalEstimatedHours: '15-25h',
      criticalPath: ['iqs-1', 'iqs-2', 'iqs-3'],
      subTasks: [
        {
          id: 'iqs-1',
          title: 'Quote Submission Form',
          description: 'Form for installers to submit offer amounts.',
          estimatedHours: '5-8h',
          difficulty: 'Easy',
          toolsNeeded: ['React'],
          knowledgeAreas: ['Frontend/React'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate form components',
          dependsOnTasks: [],
          blockedBy: ['shared-installer-auth'],
          sharedWithProjects: ['installer-portal-product'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'iqs-2',
          title: 'Zoho Sync Integration',
          description: 'Sync submitted quotes back to Zoho CRM opportunity.',
          estimatedHours: '6-10h',
          difficulty: 'Medium',
          toolsNeeded: ['Zoho API', 'Node.js'],
          knowledgeAreas: ['API Integration'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can help with Zoho field mapping',
          dependsOnTasks: ['iqs-1'],
          blockedBy: [],
          sharedWithProjects: ['unified-data-layer'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'iqs-3',
          title: 'Quote Validation Rules',
          description: 'Validate quotes against expected ranges and flag anomalies.',
          estimatedHours: '4-6h',
          difficulty: 'Easy',
          toolsNeeded: ['Node.js'],
          knowledgeAreas: ['Business Logic'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate validation logic',
          dependsOnTasks: ['iqs-2'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'answer-rate-monitoring',
      totalEstimatedHours: '15-25h',
      criticalPath: ['arm-1', 'arm-2', 'arm-3'],
      subTasks: [
        {
          id: 'arm-1',
          title: 'Aircall Metrics Integration',
          description: 'Pull call metrics (answer rate, avg wait time) from Aircall.',
          estimatedHours: '6-10h',
          difficulty: 'Medium',
          toolsNeeded: ['Aircall API', 'Node.js'],
          knowledgeAreas: ['API Integration'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can help with API integration',
          dependsOnTasks: [],
          blockedBy: [],
          sharedWithProjects: ['reporting-hub'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'arm-2',
          title: 'Real-time Dashboard',
          description: 'Display live answer rates and queue status.',
          estimatedHours: '6-10h',
          difficulty: 'Medium',
          toolsNeeded: ['React', 'WebSockets'],
          knowledgeAreas: ['Frontend/React', 'DevOps'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate real-time dashboard components',
          dependsOnTasks: ['arm-1'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'arm-3',
          title: 'Alert System',
          description: 'Slack alerts when answer rate drops below threshold.',
          estimatedHours: '4-6h',
          difficulty: 'Easy',
          toolsNeeded: ['Slack API', 'Node.js'],
          knowledgeAreas: ['API Integration'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate alerting logic',
          dependsOnTasks: ['arm-1'],
          blockedBy: [],
          sharedWithProjects: ['data-quality-monitor'],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'gdpr-compliance-tracker',
      totalEstimatedHours: '25-35h',
      criticalPath: ['gct-1', 'gct-2', 'gct-3', 'gct-4'],
      subTasks: [
        {
          id: 'gct-1',
          title: 'Consent Tracking Schema',
          description: 'Track consent status, timestamps, and source per contact.',
          estimatedHours: '6-8h',
          difficulty: 'Medium',
          toolsNeeded: ['PostgreSQL'],
          knowledgeAreas: ['Database/SQL', 'Compliance/Legal'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can suggest schema but needs legal review',
          dependsOnTasks: [],
          blockedBy: ['Legal team approval'],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'gct-2',
          title: 'Consent Management API',
          description: 'API to update and query consent status.',
          estimatedHours: '6-8h',
          difficulty: 'Easy',
          toolsNeeded: ['Node.js', 'PostgreSQL'],
          knowledgeAreas: ['API Integration'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate API endpoints',
          dependsOnTasks: ['gct-1'],
          blockedBy: [],
          sharedWithProjects: ['unified-data-layer'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'gct-3',
          title: 'Data Subject Requests',
          description: 'Handle deletion and export requests for GDPR compliance.',
          estimatedHours: '8-12h',
          difficulty: 'Hard',
          toolsNeeded: ['Node.js', 'PostgreSQL'],
          knowledgeAreas: ['Compliance/Legal', 'Database/SQL'],
          aiPotential: 'Low',
          aiAssistDescription: 'Needs legal expertise, can help with implementation',
          dependsOnTasks: ['gct-2'],
          blockedBy: ['Legal team approval'],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'gct-4',
          title: 'Compliance Dashboard',
          description: 'Overview of consent rates, pending requests, and audit log.',
          estimatedHours: '5-8h',
          difficulty: 'Easy',
          toolsNeeded: ['React'],
          knowledgeAreas: ['Frontend/React'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate dashboard components',
          dependsOnTasks: ['gct-3'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'automated-invoicing',
      totalEstimatedHours: '35-45h',
      criticalPath: ['ai-1', 'ai-2', 'ai-3', 'ai-4', 'ai-5'],
      subTasks: [
        {
          id: 'ai-1',
          title: 'Invoice Rules Engine',
          description: 'Define rules for when and how to generate invoices.',
          estimatedHours: '8-10h',
          difficulty: 'Medium',
          toolsNeeded: ['Node.js'],
          knowledgeAreas: ['Business Logic'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can help implement rules but needs business input',
          dependsOnTasks: [],
          blockedBy: ['Finance team approval'],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'ai-2',
          title: 'Holded API Integration',
          description: 'Connect to Holded for invoice creation and management.',
          estimatedHours: '8-12h',
          difficulty: 'Medium',
          toolsNeeded: ['Holded API', 'Node.js'],
          knowledgeAreas: ['API Integration'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can help with API integration',
          dependsOnTasks: ['ai-1'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'ai-3',
          title: 'PDF Generation',
          description: 'Generate branded invoice PDFs.',
          estimatedHours: '6-8h',
          difficulty: 'Easy',
          toolsNeeded: ['React-PDF', 'Node.js'],
          knowledgeAreas: ['Frontend/React'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate PDF templates',
          dependsOnTasks: ['ai-2'],
          blockedBy: [],
          sharedWithProjects: ['reporting-hub'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'ai-4',
          title: 'Payment Reconciliation',
          description: 'Match incoming payments to invoices.',
          estimatedHours: '8-10h',
          difficulty: 'Hard',
          toolsNeeded: ['Node.js', 'PostgreSQL'],
          knowledgeAreas: ['Business Logic', 'Database/SQL'],
          aiPotential: 'Low',
          aiAssistDescription: 'Complex matching logic needs human expertise',
          dependsOnTasks: ['ai-2'],
          blockedBy: ['Bank integration'],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'ai-5',
          title: 'Invoice Dashboard',
          description: 'Track invoice status, payments, and overdue amounts.',
          estimatedHours: '5-8h',
          difficulty: 'Easy',
          toolsNeeded: ['React'],
          knowledgeAreas: ['Frontend/React'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate dashboard components',
          dependsOnTasks: ['ai-4'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'api-self-service-portal',
      totalEstimatedHours: '40-55h',
      criticalPath: ['assp-1', 'assp-2', 'assp-3', 'assp-4', 'assp-5'],
      subTasks: [
        {
          id: 'assp-1',
          title: 'API Documentation Generator',
          description: 'Auto-generate OpenAPI docs from code.',
          estimatedHours: '8-12h',
          difficulty: 'Medium',
          toolsNeeded: ['Swagger/OpenAPI', 'Node.js'],
          knowledgeAreas: ['API Integration', 'DevOps'],
          aiPotential: 'High',
          aiAssistDescription: 'Can help set up doc generation',
          dependsOnTasks: [],
          blockedBy: [],
          sharedWithProjects: ['unified-data-layer'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'assp-2',
          title: 'API Key Management',
          description: 'Self-service API key creation and rotation.',
          estimatedHours: '10-12h',
          difficulty: 'Medium',
          toolsNeeded: ['Node.js', 'PostgreSQL'],
          knowledgeAreas: ['Security/Auth', 'API Integration'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can help with key management logic',
          dependsOnTasks: ['assp-1'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'assp-3',
          title: 'Interactive API Explorer',
          description: 'Try-it-out interface for testing API endpoints.',
          estimatedHours: '8-12h',
          difficulty: 'Medium',
          toolsNeeded: ['React', 'Swagger UI'],
          knowledgeAreas: ['Frontend/React'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate explorer components',
          dependsOnTasks: ['assp-1'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'assp-4',
          title: 'Usage Analytics',
          description: 'Track API usage per key and endpoint.',
          estimatedHours: '6-10h',
          difficulty: 'Medium',
          toolsNeeded: ['Node.js', 'PostgreSQL'],
          knowledgeAreas: ['Data Analytics', 'API Integration'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate analytics logic',
          dependsOnTasks: ['assp-2'],
          blockedBy: [],
          sharedWithProjects: ['reporting-hub'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'assp-5',
          title: 'Developer Portal UI',
          description: 'Complete portal with docs, keys, and analytics.',
          estimatedHours: '8-12h',
          difficulty: 'Medium',
          toolsNeeded: ['React'],
          knowledgeAreas: ['Frontend/React', 'UX Design'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate portal components',
          dependsOnTasks: ['assp-3', 'assp-4'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'programmatic-seo-pages',
      totalEstimatedHours: '80-100h',
      criticalPath: ['psp-1', 'psp-2', 'psp-3', 'psp-4', 'psp-5'],
      subTasks: [
        {
          id: 'psp-1',
          title: 'Municipal Data Scraper',
          description: 'Scrape INE data for all Spanish municipalities.',
          estimatedHours: '15-20h',
          difficulty: 'Medium',
          toolsNeeded: ['Python/Node.js', 'Puppeteer'],
          knowledgeAreas: ['External APIs', 'Database/SQL'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can help with scraping logic',
          dependsOnTasks: [],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'psp-2',
          title: 'PVGIS Integration',
          description: 'Fetch solar radiation data per location.',
          estimatedHours: '10-15h',
          difficulty: 'Medium',
          toolsNeeded: ['PVGIS API', 'Node.js'],
          knowledgeAreas: ['External APIs'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can help with API integration',
          dependsOnTasks: [],
          blockedBy: [],
          sharedWithProjects: ['pvpc-savings-widget', 'unified-quote-api'],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'psp-3',
          title: 'Template Engine',
          description: 'Dynamic page generation with municipality-specific content.',
          estimatedHours: '20-25h',
          difficulty: 'Medium',
          toolsNeeded: ['Next.js', 'Node.js'],
          knowledgeAreas: ['Frontend/React', 'DevOps'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate page templates and dynamic routing',
          dependsOnTasks: ['psp-1', 'psp-2'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'psp-4',
          title: 'AI Content Generation',
          description: 'Use LLM to generate unique content per municipality.',
          estimatedHours: '15-20h',
          difficulty: 'Medium',
          toolsNeeded: ['Claude API', 'Node.js'],
          knowledgeAreas: ['LLM/Prompt Engineering'],
          aiPotential: 'High',
          aiAssistDescription: 'Core AI task - can generate content prompts',
          dependsOnTasks: ['psp-3'],
          blockedBy: [],
          sharedWithProjects: ['ai-cortex'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'psp-5',
          title: 'SEO Optimization',
          description: 'Schema markup, sitemaps, internal linking.',
          estimatedHours: '15-20h',
          difficulty: 'Medium',
          toolsNeeded: ['Next.js', 'Node.js'],
          knowledgeAreas: ['Frontend/React', 'External APIs'],
          aiPotential: 'High',
          aiAssistDescription: 'Can help with SEO implementation',
          dependsOnTasks: ['psp-4'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'pvpc-savings-widget',
      totalEstimatedHours: '15-25h',
      criticalPath: ['psw-1', 'psw-2', 'psw-3'],
      subTasks: [
        {
          id: 'psw-1',
          title: 'ESIOS API Integration',
          description: 'Fetch real-time PVPC electricity prices.',
          estimatedHours: '6-10h',
          difficulty: 'Medium',
          toolsNeeded: ['ESIOS API', 'Node.js'],
          knowledgeAreas: ['External APIs'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can help with API integration',
          dependsOnTasks: [],
          blockedBy: [],
          sharedWithProjects: ['programmatic-seo-pages', 'unified-quote-api'],
          isFoundational: true,
          status: 'Not Started',
        },
        {
          id: 'psw-2',
          title: 'Savings Calculator Component',
          description: 'Interactive widget showing potential savings.',
          estimatedHours: '6-10h',
          difficulty: 'Medium',
          toolsNeeded: ['React'],
          knowledgeAreas: ['Frontend/React'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate widget components',
          dependsOnTasks: ['psw-1'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'psw-3',
          title: 'Embed Script',
          description: 'Embeddable script for partner websites.',
          estimatedHours: '4-6h',
          difficulty: 'Easy',
          toolsNeeded: ['JavaScript'],
          knowledgeAreas: ['Frontend/React'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate embed script',
          dependsOnTasks: ['psw-2'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'irpf-calculator',
      totalEstimatedHours: '10-15h',
      criticalPath: ['irc-1', 'irc-2', 'irc-3'],
      subTasks: [
        {
          id: 'irc-1',
          title: 'Tax Rules Implementation',
          description: 'Implement Spanish IRPF deduction rules for solar.',
          estimatedHours: '4-6h',
          difficulty: 'Medium',
          toolsNeeded: ['Node.js'],
          knowledgeAreas: ['Business Logic', 'Compliance/Legal'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can help implement rules but needs legal verification',
          dependsOnTasks: [],
          blockedBy: ['Tax rules documentation'],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'irc-2',
          title: 'Interactive Calculator UI',
          description: 'User-friendly form to calculate deductions.',
          estimatedHours: '4-6h',
          difficulty: 'Easy',
          toolsNeeded: ['React'],
          knowledgeAreas: ['Frontend/React'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate calculator components',
          dependsOnTasks: ['irc-1'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'irc-3',
          title: 'PDF Export',
          description: 'Export calculation results as PDF.',
          estimatedHours: '2-4h',
          difficulty: 'Easy',
          toolsNeeded: ['React-PDF'],
          knowledgeAreas: ['Frontend/React'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate PDF template',
          dependsOnTasks: ['irc-2'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'gmb-automation',
      totalEstimatedHours: '30-40h',
      criticalPath: ['gmb-1', 'gmb-2', 'gmb-3', 'gmb-4'],
      subTasks: [
        {
          id: 'gmb-1',
          title: 'Google Business Profile API Setup',
          description: 'Connect to GMB API for multi-location management.',
          estimatedHours: '10-12h',
          difficulty: 'Hard',
          toolsNeeded: ['Google Business API', 'Node.js'],
          knowledgeAreas: ['External APIs', 'Security/Auth'],
          aiPotential: 'Low',
          aiAssistDescription: 'Complex OAuth - needs human expertise',
          dependsOnTasks: [],
          blockedBy: ['Google API approval'],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'gmb-2',
          title: 'Automated Post Scheduler',
          description: 'Schedule and publish posts across locations.',
          estimatedHours: '8-12h',
          difficulty: 'Medium',
          toolsNeeded: ['Node.js', 'Cron'],
          knowledgeAreas: ['API Integration', 'DevOps'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate scheduling logic',
          dependsOnTasks: ['gmb-1'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'gmb-3',
          title: 'AI Review Responses',
          description: 'Generate appropriate responses to reviews with LLM.',
          estimatedHours: '6-10h',
          difficulty: 'Medium',
          toolsNeeded: ['Claude API', 'Node.js'],
          knowledgeAreas: ['LLM/Prompt Engineering'],
          aiPotential: 'High',
          aiAssistDescription: 'Core AI task - can design response prompts',
          dependsOnTasks: ['gmb-1'],
          blockedBy: [],
          sharedWithProjects: ['ai-cortex'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'gmb-4',
          title: 'GMB Dashboard',
          description: 'Manage all locations, reviews, and posts.',
          estimatedHours: '6-10h',
          difficulty: 'Medium',
          toolsNeeded: ['React'],
          knowledgeAreas: ['Frontend/React'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate dashboard components',
          dependsOnTasks: ['gmb-2', 'gmb-3'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'review-generation-system',
      totalEstimatedHours: '15-25h',
      criticalPath: ['rgs-1', 'rgs-2', 'rgs-3'],
      subTasks: [
        {
          id: 'rgs-1',
          title: 'Review Trigger System',
          description: 'Trigger review requests after successful installations.',
          estimatedHours: '5-8h',
          difficulty: 'Medium',
          toolsNeeded: ['Node.js', 'Zoho API'],
          knowledgeAreas: ['API Integration', 'Business Logic'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate trigger logic',
          dependsOnTasks: [],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'rgs-2',
          title: 'Review Request Sequences',
          description: 'Multi-channel sequences (email, SMS, WhatsApp).',
          estimatedHours: '6-10h',
          difficulty: 'Medium',
          toolsNeeded: ['SendGrid', 'Twilio', 'Woztell API'],
          knowledgeAreas: ['API Integration'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate sequence logic',
          dependsOnTasks: ['rgs-1'],
          blockedBy: [],
          sharedWithProjects: ['funnel-automation-os'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'rgs-3',
          title: 'Review Tracking Dashboard',
          description: 'Track review request success rates.',
          estimatedHours: '4-6h',
          difficulty: 'Easy',
          toolsNeeded: ['React'],
          knowledgeAreas: ['Frontend/React'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate dashboard components',
          dependsOnTasks: ['rgs-2'],
          blockedBy: [],
          sharedWithProjects: ['reporting-hub'],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'competitor-intel-agent',
      totalEstimatedHours: '20-30h',
      criticalPath: ['cia-1', 'cia-2', 'cia-3', 'cia-4'],
      subTasks: [
        {
          id: 'cia-1',
          title: 'Ad Library Scraper',
          description: 'Scrape Meta/Google ad libraries for competitor ads.',
          estimatedHours: '8-12h',
          difficulty: 'Hard',
          toolsNeeded: ['Puppeteer', 'Node.js'],
          knowledgeAreas: ['External APIs'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can help with scraping logic',
          dependsOnTasks: [],
          blockedBy: ['Platform TOS considerations'],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'cia-2',
          title: 'AI Analysis Engine',
          description: 'Use LLM to analyze ad copy and trends.',
          estimatedHours: '6-10h',
          difficulty: 'Medium',
          toolsNeeded: ['Claude API', 'Node.js'],
          knowledgeAreas: ['LLM/Prompt Engineering'],
          aiPotential: 'High',
          aiAssistDescription: 'Core AI task - can design analysis prompts',
          dependsOnTasks: ['cia-1'],
          blockedBy: [],
          sharedWithProjects: ['ai-cortex'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'cia-3',
          title: 'Competitor Database',
          description: 'Store and track competitor ads over time.',
          estimatedHours: '4-6h',
          difficulty: 'Easy',
          toolsNeeded: ['PostgreSQL'],
          knowledgeAreas: ['Database/SQL'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate schema and queries',
          dependsOnTasks: ['cia-1'],
          blockedBy: [],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'cia-4',
          title: 'Intel Reports',
          description: 'Automated weekly competitor intelligence reports.',
          estimatedHours: '4-6h',
          difficulty: 'Easy',
          toolsNeeded: ['Node.js', 'React-PDF'],
          knowledgeAreas: ['Frontend/React', 'LLM/Prompt Engineering'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate report templates',
          dependsOnTasks: ['cia-2', 'cia-3'],
          blockedBy: [],
          sharedWithProjects: ['reporting-hub'],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'robinson-suppressor',
      totalEstimatedHours: '15-25h',
      criticalPath: ['rs-1', 'rs-2', 'rs-3'],
      subTasks: [
        {
          id: 'rs-1',
          title: 'Robinson List Integration',
          description: 'Access and sync Robinson list data.',
          estimatedHours: '6-10h',
          difficulty: 'Medium',
          toolsNeeded: ['Node.js', 'PostgreSQL'],
          knowledgeAreas: ['External APIs', 'Compliance/Legal'],
          aiPotential: 'Low',
          aiAssistDescription: 'Compliance-critical, needs legal review',
          dependsOnTasks: [],
          blockedBy: ['Robinson list access'],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'rs-2',
          title: 'Suppression Engine',
          description: 'Filter leads and contacts against Robinson list.',
          estimatedHours: '5-8h',
          difficulty: 'Easy',
          toolsNeeded: ['Node.js', 'PostgreSQL'],
          knowledgeAreas: ['Business Logic', 'Compliance/Legal'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate filtering logic',
          dependsOnTasks: ['rs-1'],
          blockedBy: [],
          sharedWithProjects: ['funnel-automation-os'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'rs-3',
          title: 'Compliance Reporting',
          description: 'Track suppression rates and maintain audit logs.',
          estimatedHours: '4-6h',
          difficulty: 'Easy',
          toolsNeeded: ['React', 'PostgreSQL'],
          knowledgeAreas: ['Frontend/React', 'Compliance/Legal'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate reporting components',
          dependsOnTasks: ['rs-2'],
          blockedBy: [],
          sharedWithProjects: ['gdpr-compliance-tracker'],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
    {
      projectId: 'unified-quote-api',
      totalEstimatedHours: '30-40h',
      criticalPath: ['uqa-1', 'uqa-2', 'uqa-3', 'uqa-4'],
      subTasks: [
        {
          id: 'uqa-1',
          title: 'Equipment Pricing Database',
          description: 'Centralized database of solar equipment prices.',
          estimatedHours: '8-10h',
          difficulty: 'Medium',
          toolsNeeded: ['PostgreSQL', 'Node.js'],
          knowledgeAreas: ['Database/SQL', 'Business Logic'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can help with schema design',
          dependsOnTasks: [],
          blockedBy: ['Pricing data from suppliers'],
          sharedWithProjects: [],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'uqa-2',
          title: 'Quote Generation Engine',
          description: 'Calculate quotes based on location, consumption, roof size.',
          estimatedHours: '10-15h',
          difficulty: 'Medium',
          toolsNeeded: ['Node.js', 'PVGIS API'],
          knowledgeAreas: ['Business Logic', 'External APIs'],
          aiPotential: 'Medium',
          aiAssistDescription: 'Can help with calculation logic',
          dependsOnTasks: ['uqa-1'],
          blockedBy: [],
          sharedWithProjects: ['programmatic-seo-pages'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'uqa-3',
          title: 'Quote API Endpoint',
          description: 'Public API for generating instant quotes.',
          estimatedHours: '5-8h',
          difficulty: 'Easy',
          toolsNeeded: ['Node.js'],
          knowledgeAreas: ['API Integration'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate API endpoints',
          dependsOnTasks: ['uqa-2'],
          blockedBy: [],
          sharedWithProjects: ['api-self-service-portal'],
          isFoundational: false,
          status: 'Not Started',
        },
        {
          id: 'uqa-4',
          title: 'Quote Widget',
          description: 'Embeddable quote widget for partner websites.',
          estimatedHours: '6-10h',
          difficulty: 'Medium',
          toolsNeeded: ['React', 'JavaScript'],
          knowledgeAreas: ['Frontend/React'],
          aiPotential: 'High',
          aiAssistDescription: 'Can generate widget components',
          dependsOnTasks: ['uqa-3'],
          blockedBy: [],
          sharedWithProjects: ['pvpc-savings-widget'],
          isFoundational: false,
          status: 'Not Started',
        },
      ],
    },
  ];
}

export function generateProjectProposals(data: DashboardData): ProjectProposal[] {
  // All projects are now defined in getExistingProducts() with the new structure
  // This function adds default values and ranking

  const allProjects = getExistingProducts();

  // Enrich projects with defaults and ranks
  const enrichedProjects = allProjects.map((p, index) => ({
    ...p,
    // Ensure all optional fields have values
    stage: p.stage || 'Idea' as ProjectStage,
    primaryUsers: p.primaryUsers || ['Ops'],
    integrationsNeeded: p.integrationsNeeded || [],
    dataStatus: p.dataStatus || 'None' as const,
    nextMilestone: p.nextMilestone || '',
    pillar: p.pillar || 'Human Empowerment' as ProjectPillar,
    pillarOrder: p.pillarOrder || 99,
    whyItMatters: p.whyItMatters || p.description,
    humanRole: p.humanRole || {
      before: 'Manual process',
      after: 'AI-assisted process',
      whoIsEmpowered: p.primaryUsers || ['Ops'],
      newCapabilities: p.benefits || [],
    },
    dependsOn: p.dependsOn || [],
    enables: p.enables || [],
    relatedTo: p.relatedTo || [],
    dataRequirements: p.dataRequirements || {
      required: p.missingApiData || [],
      generates: [],
      improves: [],
    },
    // Sort by pillar order first, then by pillarOrder within each pillar
    rank: index + 1,
  }));

  // Sort by pillar (Data Foundation = 1, Data Generation = 2, Human Empowerment = 3)
  // Then by pillarOrder within each pillar
  const pillarRank = { 'Data Foundation': 1, 'Knowledge Generation': 2, 'Human Empowerment': 3 };

  return enrichedProjects.sort((a, b) => {
    const pillarA = pillarRank[a.pillar as keyof typeof pillarRank] || 99;
    const pillarB = pillarRank[b.pillar as keyof typeof pillarRank] || 99;
    if (pillarA !== pillarB) return pillarA - pillarB;
    return (a.pillarOrder || 99) - (b.pillarOrder || 99);
  });

  // The old proposals below are replaced by the new unified structure in getExistingProducts()
  // keeping this as documentation of what was consolidated:
  //
  // Consolidated into unified-data-layer:
  // - API health monitoring
  // - Data access endpoints
  //
  // Consolidated into reporting-hub:
  // - Weekly performance digest
  // - Provider ROI dashboard
  //
  // Consolidated into data-quality-monitor:
  // - Data freshness alerts
  // - Quality scoring
  //
  // Consolidated into campaign-os:
  // - Lead provider ROI dashboard
  // - Lead validation automation
  //
  // Consolidated into partner-expansion-tool:
  // - Partner pipeline CRM
  // - Outreach automation
  //
  // Consolidated into funnel-automation-os:
  // - WhatsApp automation
  // - Chatbot optimization
  // - Lead recycling workflow
  //
  // Consolidated into sdr-portal:
  // - Contact prioritization
  // - WhatsApp conversation summary
  // - AI qualification notes
  //
  // Consolidated into installer-portal-product:
  // - Installer feedback dashboard
  // - Installer quote sync
  //
  // Consolidated into installer-performance-tracking:
  // - SLA monitoring
  // - Conversion tracking
  //
  // Consolidated into dynamic-allocation-engine:
  // - Scoring algorithm
  // - Quota balancing
  //
  // Consolidated into ai-cortex:
  // - Lead temperature predictor
  // - Lost deal pattern analyzer
  // - Optimal contact time model
  //
  // Remaining ideas for future consideration:
  // - GDPR compliance tracker
  // - Answer rate monitoring
  // - API self-service portal for providers
  // - Automated invoicing
}
