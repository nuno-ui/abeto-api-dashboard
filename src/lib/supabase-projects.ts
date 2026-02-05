/**
 * Supabase-based project and task functions
 * Replaces static data with live database queries
 */

import { createAdminClient } from './supabase/admin';

// Types that match the Supabase schema
export interface SupabaseProject {
  id: string;
  title: string;
  slug: string;
  description: string;
  why_it_matters: string | null;
  pillar_id: string | null;
  category: string | null;
  status: 'idea' | 'planning' | 'in_progress' | 'testing' | 'deployed' | 'on_hold' | 'cancelled';
  priority: 'critical' | 'high' | 'medium' | 'low';
  difficulty: 'easy' | 'medium' | 'hard';
  owner_team_id: string | null;
  estimated_hours_min: number | null;
  estimated_hours_max: number | null;
  progress: number;
  progress_percentage: number;
  created_at: string;
  updated_at: string;
  // Rich fields (COO Dashboard)
  human_role_before: string | null;
  human_role_after: string | null;
  who_is_empowered: string[] | null;
  new_capabilities: string[] | null;
  data_required: string[] | null;
  data_generates: string[] | null;
  data_improves: string[] | null;
  ops_process: string | null;
  current_loa: string | null;
  potential_loa: string | null;
  resources_used: string[] | null;
  api_endpoints: string[] | null;
  prerequisites: string[] | null;
  benefits: string[] | null;
  missing_api_data: string[] | null;
  integrations_needed: string[] | null;
  depends_on: string[] | null;
  enables: string[] | null;
  related_to: string[] | null;
  primary_users: string[] | null;
  data_status: string | null;
  next_milestone: string | null;
  prototype_url: string | null;
  notion_url: string | null;
  // Joined data
  pillar?: { name: string; color: string } | null;
  owner_team?: { name: string; color: string } | null;
  tasks?: SupabaseTask[];
}

export interface SupabaseTask {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  phase: 'discovery' | 'planning' | 'development' | 'testing' | 'training' | 'rollout' | 'monitoring';
  status: 'not_started' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
  priority: 'critical' | 'high' | 'medium' | 'low';
  difficulty: 'easy' | 'medium' | 'hard';
  owner_team_id: string | null;
  estimated_hours: string | null;
  ai_potential: 'high' | 'medium' | 'low' | 'none' | null;
  ai_assist_description: string | null;
  tools_needed: string[];
  knowledge_areas: string[];
  acceptance_criteria: string[];
  success_metrics: string[];
  risks: string[];
  is_foundational: boolean;
  is_critical_path: boolean;
  order_index: number;
  created_at: string;
  updated_at: string;
  // Joined data
  owner_team?: { name: string; color: string } | null;
}

export interface SupabasePillar {
  id: string;
  name: string;
  description: string | null;
  color: string;
}

export interface SupabaseTeam {
  id: string;
  name: string;
  description: string | null;
  color: string;
}

/**
 * Fetch all projects with their related data
 */
export async function getProjectsFromSupabase(): Promise<SupabaseProject[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('projects')
    .select(`
      *,
      pillar:pillars(name, color),
      owner_team:teams(name, color),
      tasks(
        *,
        owner_team:teams(name, color)
      )
    `)
    .order('priority', { ascending: true })
    .order('title', { ascending: true });

  if (error) {
    console.error('Error fetching projects from Supabase:', error);
    return [];
  }

  return (data || []) as SupabaseProject[];
}

/**
 * Fetch a single project by slug
 */
export async function getProjectBySlug(slug: string): Promise<SupabaseProject | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('projects')
    .select(`
      *,
      pillar:pillars(name, color),
      owner_team:teams(name, color),
      tasks(
        *,
        owner_team:teams(name, color)
      )
    `)
    .eq('slug', slug)
    .single();

  if (error) {
    console.error('Error fetching project from Supabase:', error);
    return null;
  }

  return data as SupabaseProject;
}

/**
 * Fetch all pillars
 */
export async function getPillars(): Promise<SupabasePillar[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('pillars')
    .select('*')
    .order('name');

  if (error) {
    console.error('Error fetching pillars from Supabase:', error);
    return [];
  }

  return data || [];
}

/**
 * Fetch all teams
 */
export async function getTeams(): Promise<SupabaseTeam[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .order('name');

  if (error) {
    console.error('Error fetching teams from Supabase:', error);
    return [];
  }

  return data || [];
}

/**
 * Get project statistics
 */
export async function getProjectStats() {
  const supabase = createAdminClient();

  const { data: projects, error: projectsError } = await supabase
    .from('projects')
    .select('status, priority, pillar_id');

  const { data: tasks, error: tasksError } = await supabase
    .from('tasks')
    .select('status, phase');

  if (projectsError || tasksError) {
    console.error('Error fetching stats:', projectsError || tasksError);
    return null;
  }

  const projectsByStatus = (projects || []).reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const tasksByStatus = (tasks || []).reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const tasksByPhase = (tasks || []).reduce((acc, t) => {
    acc[t.phase] = (acc[t.phase] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return {
    totalProjects: projects?.length || 0,
    totalTasks: tasks?.length || 0,
    projectsByStatus,
    tasksByStatus,
    tasksByPhase,
  };
}

/**
 * Convert Supabase project to the legacy ProjectProposal format
 * This enables backwards compatibility with existing UI components
 */
export function convertToLegacyFormat(project: SupabaseProject): any {
  const pillarMap: Record<string, string> = {
    'Data Foundation': 'Data Foundation',
    'Knowledge Generation': 'Knowledge Generation',
    'Human Empowerment': 'Human Empowerment',
  };

  const pillarOrderMap: Record<string, number> = {
    'Data Foundation': 1,
    'Knowledge Generation': 2,
    'Human Empowerment': 3,
  };

  const statusToStage: Record<string, string> = {
    'idea': 'Idea',
    'planning': 'Planning',
    'in_progress': 'Developing',
    'testing': 'Testing',
    'deployed': 'Deployed',
    'on_hold': 'On Hold',
    'cancelled': 'Cancelled',
  };

  const pillarName = project.pillar?.name || 'Data Foundation';
  const estimatedHours = project.estimated_hours_min && project.estimated_hours_max
    ? `${project.estimated_hours_min}-${project.estimated_hours_max}h`
    : 'TBD';

  // Count tasks by status for sub-task info
  const taskCount = project.tasks?.length || 0;
  const completedTasks = project.tasks?.filter(t => t.status === 'completed').length || 0;

  return {
    id: project.slug,
    title: project.title,
    description: project.description,
    pillar: pillarMap[pillarName] || pillarName,
    pillarOrder: pillarOrderMap[pillarName] || 1,
    whyItMatters: project.why_it_matters || '',
    humanRole: {
      before: project.human_role_before || '',
      after: project.human_role_after || '',
      whoIsEmpowered: project.who_is_empowered?.length ? project.who_is_empowered : [project.owner_team?.name || 'TBD'],
      newCapabilities: project.new_capabilities || [],
    },
    difficulty: (project.difficulty.charAt(0).toUpperCase() + project.difficulty.slice(1)) as 'Easy' | 'Medium' | 'Hard',
    estimatedHours,
    resourcesUsed: project.resources_used || [],
    apiEndpoints: project.api_endpoints || [],
    dependsOn: project.depends_on || [],
    enables: project.enables || [],
    relatedTo: project.related_to || [],
    dataRequirements: {
      required: project.data_required || [],
      generates: project.data_generates || [],
      improves: project.data_improves || [],
    },
    priority: (project.priority.charAt(0).toUpperCase() + project.priority.slice(1)) as 'Critical' | 'High' | 'Medium' | 'Low',
    stage: statusToStage[project.status] || 'Idea',
    benefits: project.benefits || [],
    prerequisites: project.prerequisites || [],
    category: project.category || 'General',
    opsProcess: project.ops_process || '',
    currentLOA: project.current_loa || '',
    potentialLOA: project.potential_loa || '',
    missingApiData: project.missing_api_data || [],
    integrationsNeeded: project.integrations_needed || [],
    primaryUsers: project.primary_users || [],
    dataStatus: project.data_status || 'None',
    nextMilestone: project.next_milestone || '',
    prototypeUrl: project.prototype_url || '',
    notionUrl: project.notion_url || '',
    // New fields from Supabase
    owner: project.owner_team?.name || 'TBD',
    subTaskCount: taskCount,
    completedSubTasks: completedTasks,
    progress: project.progress_percentage || project.progress || 0,
    tasks: project.tasks?.map(t => {
      // Convert Supabase task to SubTask format expected by API Dashboard
      const phaseMap: Record<string, string> = {
        'discovery': 'Discovery',
        'planning': 'Planning',
        'development': 'Development',
        'testing': 'Testing',
        'training': 'Training',
        'rollout': 'Rollout',
        'monitoring': 'Monitoring',
      };
      const statusMap: Record<string, string> = {
        'backlog': 'Not Started',
        'ready': 'Not Started',
        'not_started': 'Not Started',
        'in_progress': 'In Progress',
        'review': 'In Progress',
        'done': 'Done',
        'completed': 'Done',
        'blocked': 'Blocked',
      };
      const difficultyMap: Record<string, string> = {
        'trivial': 'Easy',
        'easy': 'Easy',
        'medium': 'Medium',
        'hard': 'Hard',
        'complex': 'Hard',
      };
      const aiPotentialMap: Record<string, string> = {
        'none': 'None',
        'low': 'Low',
        'medium': 'Medium',
        'high': 'High',
        'full': 'High',
      };

      return {
        id: t.id,
        title: t.title,
        description: t.description || '',
        phase: phaseMap[t.phase] || 'Development',
        status: statusMap[t.status] || 'Not Started',
        difficulty: difficultyMap[t.difficulty] || 'Medium',
        aiPotential: aiPotentialMap[t.ai_potential || 'none'] || 'None',
        aiAssistDescription: t.ai_assist_description || '',
        estimatedHours: t.estimated_hours || 'TBD',
        owner: t.owner_team?.name || 'TBD',
        stakeholders: [],
        toolsNeeded: t.tools_needed || [],
        knowledgeAreas: t.knowledge_areas || [],
        acceptanceCriteria: t.acceptance_criteria || [],
        successMetrics: t.success_metrics || [],
        risks: t.risks || [],
        isFoundational: t.is_foundational || false,
        isCriticalPath: t.is_critical_path || false,
        dependsOnTasks: [],
        blockedBy: [],
        sharedWithProjects: [],
      };
    }) || [],
  };
}

/**
 * Fetch projects in legacy format for backwards compatibility
 */
export async function getProjectsInLegacyFormat(): Promise<any[]> {
  const projects = await getProjectsFromSupabase();
  return projects.map(convertToLegacyFormat);
}

/**
 * Check if Supabase has any projects
 * Used to determine if we should use Supabase or fall back to static data
 */
export async function hasSupabaseData(): Promise<boolean> {
  const supabase = createAdminClient();

  const { count, error } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('Error checking Supabase data:', error);
    return false;
  }

  return (count || 0) > 0;
}
