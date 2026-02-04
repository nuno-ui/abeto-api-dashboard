import { NextResponse } from 'next/server';
import { fetchDashboardData, generateProjectProposals, getExistingProducts } from '@/lib/api';
import { getProjectsInLegacyFormat, hasSupabaseData } from '@/lib/supabase-projects';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const dashboardData = await fetchDashboardData();

    // Try to get projects from Supabase first
    let projects;
    const useSupabase = await hasSupabaseData();

    if (useSupabase) {
      // Use Supabase data if available
      console.log('Using Supabase data for projects');
      projects = await getProjectsInLegacyFormat();
    } else {
      // Fall back to static data
      console.log('Using static data for projects (Supabase empty or unavailable)');
      projects = generateProjectProposals(dashboardData);
    }

    return NextResponse.json({
      success: true,
      data: dashboardData,
      projects,
      dataSource: useSupabase ? 'supabase' : 'static',
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
