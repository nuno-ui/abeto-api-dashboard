/**
 * Abeto API Client for Dashboard
 * Fetches status information from each API resource
 */

const API_URL = process.env.ABETO_API_URL || 'https://abeto-backend.vercel.app/api';
const API_KEY = process.env.ABETO_API_KEY || '';

interface FetchOptions {
  revalidate?: number;
}

async function fetchApi<T>(path: string, options?: FetchOptions): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    next: {
      revalidate: options?.revalidate ?? 60, // Cache for 60 seconds by default
    },
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// =============================================================================
// Resource Status Types
// =============================================================================

export interface ResourceStatus {
  name: string;
  description: string;
  endpoint: string;
  status: 'healthy' | 'degraded' | 'error';
  totalRecords: number | null;
  lastRecord: {
    id?: string;
    createdAt?: string;
    updatedAt?: string;
    preview?: string;
  } | null;
  availableFields: string[];
  availableFilters: string[];
  supportsSearch: boolean;
  supportsPagination: boolean;
  errorMessage?: string;
  fetchedAt: string;
}

export interface DashboardData {
  apiHealth: {
    status: 'ok' | 'error';
    internal: boolean;
    checkedAt: string;
  };
  resources: ResourceStatus[];
  summary: {
    totalResources: number;
    healthyResources: number;
    totalRecords: number;
    lastUpdated: string;
  };
}

// =============================================================================
// Fetch Functions for Each Resource
// =============================================================================

async function fetchDealsStatus(): Promise<ResourceStatus> {
  const fetchedAt = new Date().toISOString();

  try {
    const [listResponse, statsResponse] = await Promise.all([
      fetchApi<any>('/internal/deals?pageSize=1&sort=-createdAt'),
      fetchApi<any>('/internal/deals/stats'),
    ]);

    const lastDeal = listResponse.data?.[0];

    return {
      name: 'Deals',
      description: 'Sales deals progressing through pipeline stages',
      endpoint: '/internal/deals',
      status: 'healthy',
      totalRecords: statsResponse.data?.total ?? listResponse.meta?.total ?? 0,
      lastRecord: lastDeal ? {
        id: lastDeal.id,
        createdAt: lastDeal.createdAt,
        preview: `${lastDeal.name || 'Unknown'} - ${lastDeal.stage}`,
      } : null,
      availableFields: ['id', 'name', 'phone', 'email', 'stage', 'source', 'city', 'tags', 'contact', 'address', 'attribution', 'leadFormData'],
      availableFilters: ['stages', 'sources', 'search', 'assignedTo', 'createdAfter', 'createdBefore', 'hasConversation', 'lastMessageBy'],
      supportsSearch: true,
      supportsPagination: true,
      fetchedAt,
    };
  } catch (error) {
    return {
      name: 'Deals',
      description: 'Sales deals progressing through pipeline stages',
      endpoint: '/internal/deals',
      status: 'error',
      totalRecords: null,
      lastRecord: null,
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

  try {
    const response = await fetchApi<any>('/internal/regions');
    const regions = response.data || [];
    const lastRegion = regions[regions.length - 1];

    return {
      name: 'Regions',
      description: 'Geographic regions organized by postal code coverage',
      endpoint: '/internal/regions',
      status: 'healthy',
      totalRecords: regions.length,
      lastRecord: lastRegion ? {
        id: lastRegion.id,
        createdAt: lastRegion.createdAt,
        updatedAt: lastRegion.updatedAt,
        preview: `${lastRegion.name} (${lastRegion.postalCodeDigits})`,
      } : null,
      availableFields: ['id', 'name', 'normalizedName', 'postalCodeDigits', 'isActive', 'installers', 'quotas'],
      availableFilters: ['active', 'include'],
      supportsSearch: false,
      supportsPagination: false,
      fetchedAt,
    };
  } catch (error) {
    return {
      name: 'Regions',
      description: 'Geographic regions organized by postal code coverage',
      endpoint: '/internal/regions',
      status: 'error',
      totalRecords: null,
      lastRecord: null,
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

  try {
    const response = await fetchApi<any>('/internal/installers?include=regions');
    const installers = response.data || [];
    const lastInstaller = installers[installers.length - 1];

    return {
      name: 'Installers',
      description: 'Solar panel installation companies',
      endpoint: '/internal/installers',
      status: 'healthy',
      totalRecords: installers.length,
      lastRecord: lastInstaller ? {
        id: lastInstaller.id,
        createdAt: lastInstaller.createdAt,
        updatedAt: lastInstaller.updatedAt,
        preview: `${lastInstaller.installerName} (${lastInstaller.isActive ? 'Active' : 'Inactive'})`,
      } : null,
      availableFields: ['id', 'installerName', 'isActive', 'activatedAt', 'deactivatedAt', 'regions'],
      availableFilters: ['active', 'include'],
      supportsSearch: false,
      supportsPagination: false,
      fetchedAt,
    };
  } catch (error) {
    return {
      name: 'Installers',
      description: 'Solar panel installation companies',
      endpoint: '/internal/installers',
      status: 'error',
      totalRecords: null,
      lastRecord: null,
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

  try {
    const [listResponse, statsResponse] = await Promise.all([
      fetchApi<any>('/internal/opportunities?pageSize=1&sort=-createdAt'),
      fetchApi<any>('/internal/opportunities/stats'),
    ]);

    const lastOpp = listResponse.data?.[0];

    return {
      name: 'Opportunities',
      description: 'Qualified deals sent to installers',
      endpoint: '/internal/opportunities',
      status: 'healthy',
      totalRecords: statsResponse.data?.total ?? listResponse.meta?.total ?? 0,
      lastRecord: lastOpp ? {
        id: lastOpp.id,
        createdAt: lastOpp.createdAt,
        updatedAt: lastOpp.updatedAt,
        preview: `${lastOpp.installerName} - ${lastOpp.stage?.name}`,
      } : null,
      availableFields: ['id', 'installerId', 'installerName', 'dealId', 'stage', 'stageTimestamps', 'amount', 'lostData', 'wonData'],
      availableFilters: ['installerId', 'dealId', 'isOpen', 'stageName', 'search', 'include'],
      supportsSearch: true,
      supportsPagination: true,
      fetchedAt,
    };
  } catch (error) {
    return {
      name: 'Opportunities',
      description: 'Qualified deals sent to installers',
      endpoint: '/internal/opportunities',
      status: 'error',
      totalRecords: null,
      lastRecord: null,
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

  try {
    const [listResponse, statsResponse] = await Promise.all([
      fetchApi<any>('/internal/calls?pageSize=1&sort=-createdAt'),
      fetchApi<any>('/internal/calls/stats'),
    ]);

    const lastCall = listResponse.data?.[0];

    return {
      name: 'Calls',
      description: 'Phone calls for deal follow-up',
      endpoint: '/internal/calls',
      status: 'healthy',
      totalRecords: statsResponse.data?.totalCalls ?? listResponse.meta?.total ?? 0,
      lastRecord: lastCall ? {
        id: lastCall.id,
        createdAt: lastCall.createdAt,
        preview: `${lastCall.callType} - ${lastCall.status}`,
      } : null,
      availableFields: ['id', 'dealId', 'phoneNumber', 'direction', 'status', 'priority', 'callType', 'outcome', 'callDuration', 'timestamps'],
      availableFilters: ['dealId', 'status', 'priority', 'callType', 'outcome', 'dateAfter', 'dateBefore'],
      supportsSearch: false,
      supportsPagination: true,
      fetchedAt,
    };
  } catch (error) {
    return {
      name: 'Calls',
      description: 'Phone calls for deal follow-up',
      endpoint: '/internal/calls',
      status: 'error',
      totalRecords: null,
      lastRecord: null,
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

  try {
    const response = await fetchApi<any>('/internal/qualifications?isLatest=true');
    const qualifications = response.data || [];
    const lastQual = qualifications[0];

    return {
      name: 'Qualifications',
      description: 'Customer qualification records',
      endpoint: '/internal/qualifications',
      status: 'healthy',
      totalRecords: qualifications.length,
      lastRecord: lastQual ? {
        id: lastQual.id,
        createdAt: lastQual.createdAt,
        updatedAt: lastQual.updatedAt,
        preview: `${lastQual.status} - v${lastQual.version}`,
      } : null,
      availableFields: ['id', 'dealId', 'callId', 'status', 'source', 'fullAddress', 'averageEnergyBill', 'decisionStage', 'decisionTimeline', 'primaryMotivation'],
      availableFilters: ['dealId', 'status', 'source', 'isLatest'],
      supportsSearch: false,
      supportsPagination: false,
      fetchedAt,
    };
  } catch (error) {
    return {
      name: 'Qualifications',
      description: 'Customer qualification records',
      endpoint: '/internal/qualifications',
      status: 'error',
      totalRecords: null,
      lastRecord: null,
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

  try {
    const response = await fetchApi<any>('/internal/lost-reasons');
    const reasons = response.data || [];
    const lastReason = reasons[reasons.length - 1];

    return {
      name: 'Lost Reasons',
      description: 'Predefined reasons for lost deals/opportunities',
      endpoint: '/internal/lost-reasons',
      status: 'healthy',
      totalRecords: reasons.length,
      lastRecord: lastReason ? {
        id: lastReason.id,
        createdAt: lastReason.createdAt,
        updatedAt: lastReason.updatedAt,
        preview: `${lastReason.value} (${lastReason.category})`,
      } : null,
      availableFields: ['id', 'value', 'category', 'description', 'typicalCues', 'applicableTo', 'isRecyclable', 'isActive'],
      availableFilters: ['active', 'category', 'domain'],
      supportsSearch: false,
      supportsPagination: false,
      fetchedAt,
    };
  } catch (error) {
    return {
      name: 'Lost Reasons',
      description: 'Predefined reasons for lost deals/opportunities',
      endpoint: '/internal/lost-reasons',
      status: 'error',
      totalRecords: null,
      lastRecord: null,
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

  try {
    const response = await fetchApi<any>('/internal/templates');
    const templates = response.data || [];
    const lastTemplate = templates[templates.length - 1];

    return {
      name: 'Templates',
      description: 'WhatsApp message templates',
      endpoint: '/internal/templates',
      status: 'healthy',
      totalRecords: templates.length,
      lastRecord: lastTemplate ? {
        id: lastTemplate.id,
        createdAt: lastTemplate.createdAt,
        updatedAt: lastTemplate.updatedAt,
        preview: `${lastTemplate.templateName} (${lastTemplate.status})`,
      } : null,
      availableFields: ['id', 'externalId', 'templateName', 'language', 'body', 'status', 'category', 'messageType', 'buttons', 'variables'],
      availableFilters: ['messageType', 'status', 'isEnriched', 'include'],
      supportsSearch: false,
      supportsPagination: false,
      fetchedAt,
    };
  } catch (error) {
    return {
      name: 'Templates',
      description: 'WhatsApp message templates',
      endpoint: '/internal/templates',
      status: 'error',
      totalRecords: null,
      lastRecord: null,
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

  try {
    const response = await fetchApi<any>('/internal/unmatched-calls');
    const data = response.data;
    const calls = data?.unmatchedCalls || [];
    const total = data?.meta?.total ?? calls.length;
    const lastCall = calls[0];

    return {
      name: 'Unmatched Calls',
      description: 'Calls awaiting manual resolution',
      endpoint: '/internal/unmatched-calls',
      status: 'healthy',
      totalRecords: total,
      lastRecord: lastCall ? {
        id: lastCall.id,
        createdAt: lastCall.createdAt,
        updatedAt: lastCall.updatedAt,
        preview: `${lastCall.phoneNumber} (${lastCall.status})`,
      } : null,
      availableFields: ['id', 'telephonyServiceId', 'phoneNumber', 'rawPayload', 'status', 'resolvedToCallId'],
      availableFilters: ['limit', 'offset', 'createdAfter', 'createdBefore'],
      supportsSearch: false,
      supportsPagination: true,
      fetchedAt,
    };
  } catch (error) {
    return {
      name: 'Unmatched Calls',
      description: 'Calls awaiting manual resolution',
      endpoint: '/internal/unmatched-calls',
      status: 'error',
      totalRecords: null,
      lastRecord: null,
      availableFields: [],
      availableFilters: [],
      supportsSearch: false,
      supportsPagination: true,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      fetchedAt,
    };
  }
}

async function fetchHealthStatus(): Promise<{ status: 'ok' | 'error'; internal: boolean; checkedAt: string }> {
  try {
    const response = await fetchApi<any>('/internal/health');
    return {
      status: response.status || 'ok',
      internal: response.internal ?? true,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'error',
      internal: false,
      checkedAt: new Date().toISOString(),
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
  const totalRecords = resources.reduce((sum, r) => sum + (r.totalRecords || 0), 0);

  return {
    apiHealth,
    resources,
    summary: {
      totalResources: resources.length,
      healthyResources,
      totalRecords,
      lastUpdated: new Date().toISOString(),
    },
  };
}
