import jwt from 'jsonwebtoken';
import { redisClient } from '../utils/redis';

const BLOCKLIST_KEY_PREFIX = 'blocklist:';

export class TokenBlocklist {
  /**
   * Add a token to the blocklist. TTL is derived from the token's
   * remaining lifetime so the entry self-cleans when the token
   * would have expired anyway.
   */
  static async blocklist(token: string): Promise<void> {
    try {
      const decoded = jwt.decode(token) as { exp?: number } | null;
      if (!decoded?.exp) return;

      const ttl = decoded.exp - Math.floor(Date.now() / 1000);
      if (ttl <= 0) return; // already expired

      const key = `${BLOCKLIST_KEY_PREFIX}${token}`;
      await redisClient.set(key, '1', { EX: ttl });
    } catch (err) {
      console.error('Failed to blocklist token:', err);
    }
  }

  /**
   * Check whether a token has been blocklisted.
   */
  static async isBlocklisted(token: string): Promise<boolean> {
    try {
      const key = `${BLOCKLIST_KEY_PREFIX}${token}`;
      const result = await redisClient.get(key);
      return result !== null;
    } catch (err) {
      console.error('Failed to check token blocklist:', err);
      return false; // fail open — Redis down shouldn't lock everyone out
    }
  }
}
