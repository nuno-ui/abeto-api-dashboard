import { NextResponse } from 'next/server';
import { fetchDashboardData, generateProjectProposals } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const dashboardData = await fetchDashboardData();
    const projects = generateProjectProposals(dashboardData);

    return NextResponse.json({
      success: true,
      data: dashboardData,
      projects,
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
