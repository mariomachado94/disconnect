import { createClient } from 'redis';

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));
redisClient.on('connect', () => console.log('✅ Redis connected'));

// Connect immediately
redisClient.connect().catch((err) => console.error('Redis initial connection failed:', err));

export { redisClient };
