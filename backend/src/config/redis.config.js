import IORedis from 'ioredis';
import { REDIS_URL } from './env.js';

const redisConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

redisConnection.on('connect', () => {
  console.log('[Redis] connected');
});

redisConnection.on('ready', () => {
  console.log('[Redis] ready');
});

redisConnection.on('error', (error) => {
  console.error('[Redis] error:', error);
});

redisConnection.on('close', () => {
  console.log('[Redis] connection closed');
});

export default redisConnection;