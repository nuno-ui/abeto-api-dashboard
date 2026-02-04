import { NextResponse } from 'next/server';
import { fetchDashboardData, generateProjectProposals, getExistingProducts } from '@/lib/api';
import { getProjectsInLegacyFormat, hasSupabaseData } from '@/lib/supabase-projects';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const dashboardData = await fetchDashboardData();

    // Get static data for rich fields
    const staticProjects = generateProjectProposals(dashboardData);
    const staticProjectsMap = new Map(staticProjects.map(p => [p.id, p]));

    // Try to get projects from Supabase
    let projects;
    const useSupabase = await hasSupabaseData();

    if (useSupabase) {
      // Use Supabase data but MERGE with static rich data
      console.log('Using Supabase data merged with static rich fields');
      const supabaseProjects = await getProjectsInLegacyFormat();

      // Merge Supabase projects with static rich data
      projects = supabaseProjects.map(supabaseProject => {
        // Find matching static project by id (slug)
        const staticProject = staticProjectsMap.get(supabaseProject.id);

        if (staticProject) {
          // Merge: Supabase data takes priority for live fields,
          // but static data fills in the rich content fields
          return {
            ...staticProject,  // Start with all static rich data
            ...supabaseProject,  // Override with Supabase live data
            // Preserve rich fields from static if Supabase has empty values
            humanRole: supabaseProject.humanRole?.before ? supabaseProject.humanRole : staticProject.humanRole,
            dataRequirements: (supabaseProject.dataRequirements?.required?.length > 0)
              ? supabaseProject.dataRequirements
              : staticProject.dataRequirements,
            benefits: supabaseProject.benefits?.length > 0 ? supabaseProject.benefits : staticProject.benefits,
            prerequisites: supabaseProject.prerequisites?.length > 0 ? supabaseProject.prerequisites : staticProject.prerequisites,
            opsProcess: supabaseProject.opsProcess || staticProject.opsProcess,
            currentLOA: supabaseProject.currentLOA || staticProject.currentLOA,
            potentialLOA: supabaseProject.potentialLOA || staticProject.potentialLOA,
            resourcesUsed: supabaseProject.resourcesUsed?.length > 0 ? supabaseProject.resourcesUsed : staticProject.resourcesUsed,
            apiEndpoints: supabaseProject.apiEndpoints?.length > 0 ? supabaseProject.apiEndpoints : staticProject.apiEndpoints,
            dependsOn: supabaseProject.dependsOn?.length > 0 ? supabaseProject.dependsOn : staticProject.dependsOn,
            enables: supabaseProject.enables?.length > 0 ? supabaseProject.enables : staticProject.enables,
            relatedTo: supabaseProject.relatedTo?.length > 0 ? supabaseProject.relatedTo : staticProject.relatedTo,
            missingApiData: supabaseProject.missingApiData?.length > 0 ? supabaseProject.missingApiData : staticProject.missingApiData,
            integrationsNeeded: supabaseProject.integrationsNeeded?.length > 0 ? supabaseProject.integrationsNeeded : staticProject.integrationsNeeded,
            primaryUsers: supabaseProject.primaryUsers?.length > 0 ? supabaseProject.primaryUsers : staticProject.primaryUsers,
            dataStatus: supabaseProject.dataStatus || staticProject.dataStatus,
            nextMilestone: supabaseProject.nextMilestone || staticProject.nextMilestone,
            prototypeUrl: supabaseProject.prototypeUrl || staticProject.prototypeUrl,
            notionUrl: supabaseProject.notionUrl || staticProject.notionUrl,
            // Keep tasks from Supabase (live data)
            tasks: supabaseProject.tasks,
            subTaskCount: supabaseProject.subTaskCount,
            completedSubTasks: supabaseProject.completedSubTasks,
          };
        }

        // No matching static project - return Supabase data as-is (new project)
        return supabaseProject;
      });

      // Also include static projects that aren't in Supabase yet
      const supabaseIds = new Set(supabaseProjects.map(p => p.id));
      const missingStaticProjects = staticProjects.filter(p => !supabaseIds.has(p.id));
      projects = [...projects, ...missingStaticProjects];

    } else {
      // Fall back to static data only
      console.log('Using static data for projects (Supabase empty or unavailable)');
      projects = staticProjects;
    }

    return NextResponse.json({
      success: true,
      data: dashboardData,
      projects,
      dataSource: useSupabase ? 'supabase+static' : 'static',
    });
  } catch (error) {
    console.error('Dashboard API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch dashboard data'
      },
      { status: 500 }
    );
  }
}
