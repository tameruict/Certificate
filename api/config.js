export default function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD');
    return response.status(405).json({ error: 'Method not allowed.' });
  }

  const url = process.env.SUPABASE_URL || 'https://enpwqvojhqiuryhzujrn.supabase.co';
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';

  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) || !isBrowserSafeKey(anonKey)) {
    return response.status(503).json({ error: 'Supabase environment variables are not configured.' });
  }
  return response.status(200).json({ url, anonKey });
}

function isBrowserSafeKey(key) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  if (!/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return false;
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    return payload.role === 'anon';
  } catch {
    return false;
  }
}
