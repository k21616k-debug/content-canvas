import { execSync } from 'child_process';

const START_TIME = new Date().toISOString();

const GIT_HASH = (() => {
  // 1. Try Vercel environment variable
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA.substring(0, 7);
  }
  // 2. Try local git command
  try {
    return execSync('git rev-parse --short HEAD', { cwd: import.meta.dirname }).toString().trim();
  } catch {
    return 'unknown';
  }
})();

const ENV = process.env.VERCEL ? 'vercel' : 'local';

export default async function handler(req, res) {
  // Support CORS
  res.status(200).json({
    commit: GIT_HASH,
    env: ENV,
    time: START_TIME
  });
}
