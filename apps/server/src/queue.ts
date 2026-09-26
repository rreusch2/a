import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { cronMatches } from '@agents/shared';
import { env } from './env.js';

export interface JobData {
  kind: 'run' | 'resume' | 'tick';
  runId?: string;
  approved?: boolean;
  triggerId?: string;
}

type Handler = (job: JobData) => Promise<void>;

const QUEUE_NAME = 'agents';

export async function enqueue(job: JobData, opts?: { delayMs?: number }): Promise<void> {
  if (env.redisUrl) {
    await redisQueue().add('job', job, {
      delay: opts?.delayMs,
      removeOnComplete: 200,
      removeOnFail: 200,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
    return;
  }
  memory.jobs.push({ job, runAt: Date.now() + (opts?.delayMs ?? 0) });
  kickMemory();
}

export async function schedule(id: string, cron: string, job: JobData): Promise<void> {
  if (env.redisUrl) {
    await redisQueue().upsertJobScheduler(id, { pattern: cron }, { name: 'tick', data: job });
    return;
  }
  memory.schedules.set(id, { cron, job, lastMinute: '' });
  kickMemory();
}

export async function unschedule(id: string): Promise<void> {
  if (env.redisUrl) {
    await redisQueue().removeJobScheduler(id);
    return;
  }
  memory.schedules.delete(id);
}

export function startWorker(handler: Handler): void {
  if (env.redisUrl) {
    const worker = new Worker<JobData>(
      QUEUE_NAME,
      async (job) => {
        const data = job.name === 'tick' ? { ...job.data, kind: job.data.kind ?? 'tick' } : job.data;
        await handler(data);
      },
      { connection: new Redis(env.redisUrl, { maxRetriesPerRequest: null }), concurrency: 4 },
    );
    worker.on('failed', (job, error) => {
      console.error(`Job ${job?.id ?? '?'} failed`, error);
    });
    return;
  }
  memory.handler = handler;
  kickMemory();
  console.warn('REDIS_URL is empty. Runs use an in-process queue and stop when this process stops.');
}

let queue: Queue<JobData> | null = null;

function redisQueue(): Queue<JobData> {
  if (!queue) {
    queue = new Queue<JobData>(QUEUE_NAME, {
      connection: new Redis(env.redisUrl, { maxRetriesPerRequest: null }),
    });
  }
  return queue;
}

const memory: {
  jobs: { job: JobData; runAt: number }[];
  schedules: Map<string, { cron: string; job: JobData; lastMinute: string }>;
  handler: Handler | null;
  timer: NodeJS.Timeout | null;
} = {
  jobs: [],
  schedules: new Map(),
  handler: null,
  timer: null,
};

function kickMemory(): void {
  if (memory.timer) return;
  memory.timer = setInterval(() => {
    void drainMemory();
  }, 1000);
  memory.timer.unref?.();
}

async function drainMemory(): Promise<void> {
  if (!memory.handler) return;
  const now = new Date();
  const minuteKey = now.toISOString().slice(0, 16);
  for (const schedule of memory.schedules.values()) {
    if (schedule.lastMinute === minuteKey) continue;
    if (!cronMatches(schedule.cron, now)) continue;
    schedule.lastMinute = minuteKey;
    memory.jobs.push({ job: schedule.job, runAt: Date.now() });
  }
  const ready = memory.jobs.filter((item) => item.runAt <= Date.now());
  memory.jobs = memory.jobs.filter((item) => item.runAt > Date.now());
  for (const item of ready) {
    try {
      await memory.handler(item.job);
    } catch (error) {
      console.error(error);
    }
  }
}
