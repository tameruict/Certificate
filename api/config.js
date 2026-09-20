export default function handler(_request, response) {
  const url = process.env.SUPABASE_URL || 'https://enpwqvojhqiuryhzujrn.supabase.co';
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';

  response.setHeader('Cache-Control', 'no-store, max-age=0');
  if (!anonKey) {
    return response.status(503).json({ error: 'Supabase environment variables are not configured.' });
  }
  return response.status(200).json({ url, anonKey });
}
