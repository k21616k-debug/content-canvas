export default function handler(req, res) {
  const commit = (process.env.VERCEL_GIT_COMMIT_SHA || '').substring(0, 7) || 'unknown';
  const env = process.env.VERCEL ? 'vercel' : 'local';
  res.status(200).json({ commit, env, time: new Date().toISOString() });
}
