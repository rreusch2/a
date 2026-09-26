import { env } from './env.js';
import { processJob } from './engine/runs.js';
import { startWorker } from './queue.js';
import { seedTemplates } from './seed.js';

if (!env.redisUrl) {
  console.warn('Start the worker with REDIS_URL set. Without Redis, the API process runs the queue itself.');
}

startWorker(processJob);

if (env.supabaseUrl && env.supabaseSecretKey) {
  void seedTemplates();
}
