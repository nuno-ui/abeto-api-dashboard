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
// Project Proposals Generator
// =============================================================================

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
  category: 'Analytics' | 'Automation' | 'Integration' | 'Reporting' | 'AI/ML' | 'Operations';
}

export function generateProjectProposals(data: DashboardData): ProjectProposal[] {
  const proposals: ProjectProposal[] = [];
  const resources = data.resources;

  const dealsResource = resources.find(r => r.name === 'Deals');
  const callsResource = resources.find(r => r.name === 'Calls');
  const opportunitiesResource = resources.find(r => r.name === 'Opportunities');
  const regionsResource = resources.find(r => r.name === 'Regions');
  const installersResource = resources.find(r => r.name === 'Installers');
  const qualificationsResource = resources.find(r => r.name === 'Qualifications');
  const templatesResource = resources.find(r => r.name === 'Templates');
  const lostReasonsResource = resources.find(r => r.name === 'Lost Reasons');

  // Always suggest these core projects
  proposals.push({
    id: 'sales-dashboard',
    title: 'Real-Time Sales Pipeline Dashboard',
    description: 'Build an interactive dashboard showing deal flow through stages, conversion rates, and revenue forecasts. Visualize the entire sales funnel with drill-down capabilities.',
    difficulty: 'Medium',
    estimatedHours: '20-30 hours',
    resourcesUsed: ['Deals', 'Opportunities', 'Qualifications'],
    benefits: [
      'Real-time visibility into sales performance',
      'Identify bottlenecks in the pipeline',
      'Track team performance metrics',
      'Forecast revenue based on pipeline data',
    ],
    prerequisites: ['React/Next.js knowledge', 'Chart library (Recharts, Chart.js)'],
    apiEndpoints: ['/internal/deals', '/internal/deals/stats', '/internal/opportunities/stats'],
    category: 'Analytics',
  });

  // Project based on Calls data
  if (callsResource && callsResource.status !== 'error') {
    proposals.push({
      id: 'call-analytics',
      title: 'Call Center Analytics & Performance Tracker',
      description: 'Analyze call patterns, answer rates, and agent performance. Track call outcomes and identify best times to reach customers.',
      difficulty: 'Medium',
      estimatedHours: '15-25 hours',
      resourcesUsed: ['Calls', 'Deals'],
      benefits: [
        'Optimize call scheduling for higher answer rates',
        'Track agent performance metrics',
        'Identify peak calling hours',
        'Reduce call backlog with data-driven insights',
      ],
      prerequisites: ['Data visualization experience', 'Basic statistics knowledge'],
      apiEndpoints: ['/internal/calls', '/internal/calls/stats'],
      category: 'Analytics',
    });
  }

  // Project based on Regions + Installers
  if (regionsResource && installersResource) {
    proposals.push({
      id: 'geo-coverage-map',
      title: 'Interactive Geographic Coverage Map',
      description: 'Build a map-based visualization showing installer coverage across Spain by postal code regions. Identify underserved areas and optimize installer assignments.',
      difficulty: 'Medium',
      estimatedHours: '25-35 hours',
      resourcesUsed: ['Regions', 'Installers', 'Deals'],
      benefits: [
        'Visualize market coverage at a glance',
        'Identify expansion opportunities',
        'Optimize lead routing by geography',
        'Balance installer workloads by region',
      ],
      prerequisites: ['Mapbox or Google Maps API', 'GeoJSON knowledge'],
      apiEndpoints: ['/internal/regions', '/internal/installers', '/internal/regions/{id}/quotas'],
      category: 'Analytics',
    });
  }

  // Project based on Templates
  if (templatesResource && templatesResource.status !== 'error') {
    proposals.push({
      id: 'whatsapp-campaign-manager',
      title: 'WhatsApp Campaign Manager',
      description: 'Create a tool to manage and preview WhatsApp templates, schedule campaigns, and track message delivery. Test template variables before sending.',
      difficulty: 'Medium',
      estimatedHours: '20-30 hours',
      resourcesUsed: ['Templates', 'Deals'],
      benefits: [
        'Preview templates with real data before sending',
        'Manage template approval workflow',
        'Track campaign performance',
        'A/B test different message variants',
      ],
      prerequisites: ['WhatsApp Business API familiarity', 'React forms experience'],
      apiEndpoints: ['/internal/templates', '/internal/templates/{id}/variables', '/internal/templates/{id}/buttons'],
      category: 'Operations',
    });
  }

  // AI/ML Projects
  if (dealsResource && qualificationsResource) {
    proposals.push({
      id: 'lead-scoring-ml',
      title: 'AI-Powered Lead Scoring System',
      description: 'Use machine learning to predict which leads are most likely to convert based on historical deal data, qualification answers, and engagement patterns.',
      difficulty: 'Hard',
      estimatedHours: '40-60 hours',
      resourcesUsed: ['Deals', 'Qualifications', 'Calls', 'Opportunities'],
      benefits: [
        'Prioritize high-value leads automatically',
        'Improve sales team efficiency',
        'Predict conversion probability',
        'Identify key conversion factors',
      ],
      prerequisites: ['Python/ML experience', 'scikit-learn or TensorFlow', 'Data preprocessing skills'],
      apiEndpoints: ['/internal/deals', '/internal/qualifications', '/internal/opportunities'],
      category: 'AI/ML',
    });
  }

  // Lost Reasons Analysis
  if (lostReasonsResource && dealsResource) {
    proposals.push({
      id: 'churn-analysis',
      title: 'Lost Deal Analysis & Prevention Tool',
      description: 'Analyze patterns in lost deals to identify common reasons and early warning signs. Build alerts to flag at-risk deals before they\'re lost.',
      difficulty: 'Medium',
      estimatedHours: '20-30 hours',
      resourcesUsed: ['Lost Reasons', 'Deals', 'Calls', 'Qualifications'],
      benefits: [
        'Understand why deals are lost',
        'Identify patterns by region/installer/source',
        'Create early warning alerts',
        'Improve sales process based on insights',
      ],
      prerequisites: ['Data analysis skills', 'Alerting system knowledge'],
      apiEndpoints: ['/internal/lost-reasons', '/internal/deals', '/internal/deals/{id}/stage-changes'],
      category: 'Analytics',
    });
  }

  // Automation Projects
  proposals.push({
    id: 'automated-follow-up',
    title: 'Intelligent Follow-Up Automation',
    description: 'Build an automation system that schedules follow-up calls and WhatsApp messages based on deal stage, last contact, and customer preferences.',
    difficulty: 'Hard',
    estimatedHours: '35-50 hours',
    resourcesUsed: ['Deals', 'Calls', 'Templates', 'Qualifications'],
    benefits: [
      'Never miss a follow-up opportunity',
      'Personalize outreach based on customer data',
      'Reduce manual scheduling work',
      'Improve response rates with optimal timing',
    ],
    prerequisites: ['Cron jobs/scheduling', 'State machine design', 'API integration experience'],
    apiEndpoints: ['/internal/deals', '/internal/calls', '/internal/templates', '/internal/deals/{id}/messages'],
    category: 'Automation',
  });

  // Reporting Project
  proposals.push({
    id: 'executive-reports',
    title: 'Automated Executive Reports Generator',
    description: 'Generate weekly/monthly PDF reports with key metrics, trends, and insights. Auto-send to stakeholders with customizable sections.',
    difficulty: 'Medium',
    estimatedHours: '25-35 hours',
    resourcesUsed: ['Deals', 'Opportunities', 'Calls', 'Regions', 'Installers'],
    benefits: [
      'Save hours of manual report creation',
      'Consistent, professional reporting',
      'Historical trend analysis',
      'Customizable metrics per stakeholder',
    ],
    prerequisites: ['PDF generation (Puppeteer, jsPDF)', 'Email service integration'],
    apiEndpoints: ['/internal/deals/stats', '/internal/opportunities/stats', '/internal/calls/stats'],
    category: 'Reporting',
  });

  // Integration Project
  proposals.push({
    id: 'crm-sync',
    title: 'Bi-Directional CRM Sync Tool',
    description: 'Build a synchronization layer to keep Abeto data in sync with external CRMs (HubSpot, Salesforce, Zoho). Handle conflicts and maintain data integrity.',
    difficulty: 'Hard',
    estimatedHours: '40-60 hours',
    resourcesUsed: ['Deals', 'Opportunities', 'Qualifications', 'Calls'],
    benefits: [
      'Single source of truth across systems',
      'Eliminate manual data entry',
      'Real-time sync with external tools',
      'Audit trail for all changes',
    ],
    prerequisites: ['CRM API experience', 'Webhook handling', 'Conflict resolution strategies'],
    apiEndpoints: ['All deal endpoints', 'All opportunity endpoints'],
    category: 'Integration',
  });

  // Installer Portal
  if (installersResource && opportunitiesResource) {
    proposals.push({
      id: 'installer-portal',
      title: 'Self-Service Installer Portal',
      description: 'Create a dedicated portal for installers to view their assigned opportunities, update statuses, and communicate with the sales team.',
      difficulty: 'Hard',
      estimatedHours: '50-70 hours',
      resourcesUsed: ['Installers', 'Opportunities', 'Deals', 'Regions'],
      benefits: [
        'Reduce back-and-forth communication',
        'Faster opportunity status updates',
        'Installer self-service capabilities',
        'Better installer relationship management',
      ],
      prerequisites: ['Authentication system', 'Role-based access control', 'Real-time updates'],
      apiEndpoints: ['/internal/installers', '/internal/opportunities', '/internal/regions/{id}/quotas'],
      category: 'Operations',
    });
  }

  // Mobile App
  proposals.push({
    id: 'mobile-sales-app',
    title: 'Mobile Sales Companion App',
    description: 'Build a React Native or Flutter app for sales reps to access deals, make calls, and update records on the go. Works offline with sync capabilities.',
    difficulty: 'Hard',
    estimatedHours: '60-80 hours',
    resourcesUsed: ['Deals', 'Calls', 'Qualifications', 'Templates'],
    benefits: [
      'Field sales team productivity',
      'Real-time deal updates from anywhere',
      'Click-to-call integration',
      'Offline capability for poor connectivity',
    ],
    prerequisites: ['React Native or Flutter', 'Mobile development experience', 'Offline-first architecture'],
    apiEndpoints: ['All major endpoints'],
    category: 'Operations',
  });

  return proposals;
}
