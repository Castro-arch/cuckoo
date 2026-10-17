import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { loadEnv } from './env.js';
import { createHealthServer } from './health-server.js';

const env = loadEnv();

// BullMQ workers need maxRetriesPerRequest: null so blocking commands are not aborted.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', (error) => {
  console.error(`redis connection error: ${error.message}`);
});

// Placeholder queue: calendar sync, reminders and emails get their own queues later.
const worker = new Worker(
  'default',
  async (job) => {
    console.log(`processing job ${job.id} (${job.name})`);
  },
  { connection },
);
worker.on('failed', (job, error) => {
  console.error(`job ${job?.id} failed: ${error.message}`);
});

const healthServer = createHealthServer(() => ({
  redis: connection.status === 'ready' ? 'up' : 'down',
  worker: worker.isRunning() ? 'up' : 'down',
}));
healthServer.listen(env.WORKER_PORT, env.WORKER_HOST, () => {
  console.log(`worker health server listening on http://localhost:${env.WORKER_PORT}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`received ${signal}, shutting down`);
  healthServer.close();
  await worker.close();
  await connection.quit();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
