import { createAdminClient } from './db.js';

export async function notifyUser(userId: string, title: string, body: string, data: Record<string, unknown>): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: profile } = await admin.from('profiles').select('expo_push_token').eq('id', userId).maybeSingle();
    const token = profile?.expo_push_token;
    if (!token || typeof token !== 'string') return;
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        to: token,
        title,
        body: body.slice(0, 180),
        data,
        sound: 'default',
      }),
    });
  } catch (error) {
    console.error('Push notification failed', error);
  }
}
