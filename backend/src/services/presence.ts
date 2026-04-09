import { redisClient } from '../utils/redis';

export enum PresenceStatus {
  ONLINE = 'online',
  AWAY = 'away',
  OFFLINE = 'offline',
}

export interface PresenceData {
  userId: string;
  status: PresenceStatus;
  lastSeen: number; // timestamp
}

const PRESENCE_KEY_PREFIX = 'presence:';
const AWAY_TIMEOUT = 60 * 1000; // 60 seconds
const LOGOUT_TIMEOUT = 120 * 1000; // 120 seconds

export class PresenceService {
  // Set user online
  static async setOnline(userId: string): Promise<void> {
    const key = `${PRESENCE_KEY_PREFIX}${userId}`;
    const data: PresenceData = {
      userId,
      status: PresenceStatus.ONLINE,
      lastSeen: Date.now(),
    };
    await redisClient.set(key, JSON.stringify(data));
  }

  // Update last seen (for activity tracking)
  static async updateActivity(userId: string): Promise<void> {
    const key = `${PRESENCE_KEY_PREFIX}${userId}`;
    const existing = await redisClient.get(key);

    if (existing) {
      const data: PresenceData = JSON.parse(existing);
      data.lastSeen = Date.now();
      data.status = PresenceStatus.ONLINE; // Reset to online if they were away
      await redisClient.set(key, JSON.stringify(data));
    }
  }

  // Set user offline
  static async setOffline(userId: string): Promise<void> {
    const key = `${PRESENCE_KEY_PREFIX}${userId}`;
    await redisClient.del(key);
  }

  // Get user's presence
  static async getPresence(userId: string): Promise<PresenceData | null> {
    const key = `${PRESENCE_KEY_PREFIX}${userId}`;
    const data = await redisClient.get(key);

    if (!data) {
      return {
        userId,
        status: PresenceStatus.OFFLINE,
        lastSeen: 0,
      };
    }

    const presence: PresenceData = JSON.parse(data);
    const now = Date.now();
    const timeSinceActivity = now - presence.lastSeen;

    // Update status based on inactivity
    if (timeSinceActivity > LOGOUT_TIMEOUT) {
      await this.setOffline(userId);
      return {
        userId,
        status: PresenceStatus.OFFLINE,
        lastSeen: presence.lastSeen,
      };
    } else if (timeSinceActivity > AWAY_TIMEOUT) {
      presence.status = PresenceStatus.AWAY;
    }

    return presence;
  }

  // Get presence for multiple users
  static async getMultiplePresence(userIds: string[]): Promise<Map<string, PresenceData>> {
    const presenceMap = new Map<string, PresenceData>();

    for (const userId of userIds) {
      const presence = await this.getPresence(userId);
      if (presence) {
        presenceMap.set(userId, presence);
      }
    }

    return presenceMap;
  }

  // Check all connections and clean up stale ones
  static async cleanupStalePresence(): Promise<void> {
    const keys = await redisClient.keys(`${PRESENCE_KEY_PREFIX}*`);
    const now = Date.now();

    for (const key of keys) {
      const data = await redisClient.get(key);
      if (data) {
        const presence: PresenceData = JSON.parse(data);
        if (now - presence.lastSeen > LOGOUT_TIMEOUT) {
          await redisClient.del(key);
        }
      }
    }
  }

  // Clear all presence data
  static async clearAll(): Promise<void> {
    const keys = await redisClient.keys(`${PRESENCE_KEY_PREFIX}*`);
    if (keys.length > 0) {
      await redisClient.del(keys);
      console.log(`🧹 Cleared ${keys.length} presence keys`);
    }
  }
}
