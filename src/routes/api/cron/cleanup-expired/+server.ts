import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
  // Verify this is a legitimate cron request
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Call our existing cleanup endpoint
    const cleanupResponse = await fetch(`${process.env.ORIGIN || 'http://localhost:5173'}/api/cleanup-expired`, {
      method: 'GET'
    });

    if (!cleanupResponse.ok) {
      throw new Error(`Cleanup failed: ${cleanupResponse.status}`);
    }

    const result = await cleanupResponse.json();
    
    console.log('Cron cleanup completed:', {
      timestamp: new Date().toISOString(),
      cleanedUp: result.cleanedUp,
      success: result.success
    });

    return json({
      success: true,
      message: 'Cleanup completed',
      result
    });

  } catch (error) {
    console.error('Cron cleanup error:', error);
    return json({ 
      error: error instanceof Error ? error.message : 'Cleanup failed' 
    }, { status: 500 });
  }
}; 