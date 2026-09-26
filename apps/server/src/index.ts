import { createApp } from './app.js';
import { env } from './env.js';
import { processJob } from './engine/runs.js';
import { startWorker } from './queue.js';
import { seedTemplates } from './seed.js';

const app = createApp();
app.listen(env.port, () => {
  console.log(`Agents API listening on ${env.port}`);
});

if (env.runWorker) startWorker(processJob);

if (env.supabaseUrl && env.supabaseSecretKey) {
  void seedTemplates();
}
