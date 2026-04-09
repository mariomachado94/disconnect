import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { verifyToken } from '../utils/jwt';
import { PresenceService, PresenceStatus } from './presence';
import { TokenBlocklist } from './tokenBlocklist';
import { prisma } from '../utils/prisma';

// Debug logging — enabled with DEBUG_WS=1 (or any truthy value).
// Verbose lifecycle logs (connect/disconnect/timers/monitor) go through this.
// Important operational events (presence notifications, force_logout, errors) stay as console.log.
const debugWs = (...args: any[]) => {
  if (process.env.DEBUG_WS) console.log(...args);
};

// Extend the base WebSocket type to include our custom properties
interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  token?: string;
  isAlive?: boolean;
  presenceStatus?: PresenceStatus; // last state we notified friends about
  established?: boolean; // true after addConnection — guards handleDisconnect
}

export class WebSocketService {
  private wss: WebSocketServer;
  // Map of userId -> set of active WebSocket connections.
  // A user may have multiple tabs open, each with its own socket.
  private connections: Map<string, Set<AuthenticatedWebSocket>> = new Map();
  // Cached display names for readable logs (populated on connect)
  private displayNames: Map<string, string> = new Map();
  // If the user doesn't reconnect within 90s of their last tab closing,
  // their token is blocklisted — forcing a fresh login. Cancelled on reconnect.
  private forceReloginTimers: Map<string, NodeJS.Timeout> = new Map();
  // Short grace period before marking a user offline. Absorbs page refreshes
  // and brief network blips so friends never see a false offline→online flap.
  private disconnectGraceTimers: Map<string, NodeJS.Timeout> = new Map();
  // Tracks whether friends have been notified that this user is online.
  // Set when the ONLINE notification fires; cleared when OFFLINE fires.
  // Used to suppress duplicate ONLINE notifications (e.g. page refresh —
  // friends already know you're online, no need to tell them again).
  private notifiedOnline: Set<string> = new Set();
  // Pending ONLINE notification timers. A short delay (300ms) lets React
  // StrictMode's double-mount settle before we decide whether to notify.
  // Cancelled if the user disconnects before it fires.
  private onlineNotifyTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    // Can't use async constructors in TypeScript, so we delegate
    // to an async method. This means initialize() runs slightly
    // after construction, but that's fine for our use case.
    this.initializeAsync();
  }

  private async initializeAsync() {
    // Clear all presence on startup.
    // If the server restarted, all WebSocket connections were dropped,
    // meaning no one is connected. Clear stale Redis presence keys
    // so users don't appear online when they're not.
    try {
      await PresenceService.clearAll();
    } catch (err) {
      // Redis may not be ready yet or unavailable. Log and continue —
      // stale presence keys are cosmetic; failing here would crash the
      // process and break HTTP routes that don't touch Redis at all.
      console.error('Failed to clear presence on startup:', err);
    }

    // Now initialize WebSocket handlers
    this.initialize();
  }

  // Returns the number of live connections for a user
  private connectionCount(userId: string): number {
    return this.connections.get(userId)?.size ?? 0;
  }

  // Add a connection for a user, returns the new count
  private addConnection(userId: string, ws: AuthenticatedWebSocket): number {
    let set = this.connections.get(userId);
    if (!set) {
      set = new Set();
      this.connections.set(userId, set);
    }
    set.add(ws);
    return set.size;
  }

  // Remove a connection for a user, returns the remaining count
  private removeConnection(userId: string, ws: AuthenticatedWebSocket): number {
    const set = this.connections.get(userId);
    if (!set) return 0;
    set.delete(ws);
    if (set.size === 0) {
      this.connections.delete(userId);
      return 0;
    }
    return set.size;
  }

  // Readable label for logs: "Alice (e86f)" instead of raw UUIDs
  private tag(userId: string): string {
    const name = this.displayNames.get(userId) ?? '??';
    return `${name} (${userId.slice(0, 4)})`;
  }

  // Send a message to all of a user's active connections
  private sendToAllConnections(userId: string, data: any) {
    const set = this.connections.get(userId);
    if (!set) return;
    for (const ws of set) {
      this.send(ws, data);
    }
  }

  private initialize() {
    this.wss.on('connection', async (ws: AuthenticatedWebSocket, req) => {
      debugWs('New WebSocket connection attempt');

      // Extract token from query params (?token=...)
      // e.g. ws://localhost:3001/ws?token=JWT_TOKEN
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const token = url.searchParams.get('token');

      if (!token) {
        ws.close(1008, 'No token provided');
        return;
      }

      try {
        const payload = verifyToken(token);

        // Set identity and register event handlers BEFORE any async work.
        // If we await first, the socket could close during the yield and
        // the 'close' event would be lost (no listener registered yet),
        // leaving a zombie connection in the set forever.
        ws.userId = payload.userId;
        ws.token = token;
        ws.isAlive = true;
        ws.presenceStatus = PresenceStatus.ONLINE;

        ws.on('close', () => this.handleDisconnect(ws));
        ws.on('pong', () => { ws.isAlive = true; });
        ws.on('message', (message) => {
          if (ws.established) this.handleMessage(ws, message.toString());
        });

        // Async auth checks — safe to yield now, close handler is registered
        const blocked = await TokenBlocklist.isBlocklisted(token);
        if (blocked) {
          ws.close(1008, 'Token revoked');
          return;
        }

        // Cache display name for readable logs
        if (!this.displayNames.has(payload.userId)) {
          const u = await prisma.user.findUnique({ where: { id: payload.userId }, select: { displayName: true } });
          if (u) this.displayNames.set(payload.userId, u.displayName);
        }

        // Cancel any pending relogin timer — user reconnected in time
        const pendingTimer = this.forceReloginTimers.get(payload.userId);
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          this.forceReloginTimers.delete(payload.userId);
          debugWs(`[connect] ${this.tag(payload.userId)} — cancelled forceReloginTimer (reconnected before 90s)`);
        }

        // Cancel any pending grace timer so it doesn't mark the user offline
        // while they're connected.
        const graceTimer = this.disconnectGraceTimers.get(payload.userId);
        if (graceTimer) {
          clearTimeout(graceTimer);
          this.disconnectGraceTimers.delete(payload.userId);
          debugWs(`[connect] ${this.tag(payload.userId)} — cancelled grace timer (reconnected before 1s)`);
        }

        // If the socket closed during the async gap (e.g. StrictMode cleanup
        // sent a close frame while we were awaiting), don't add it to the
        // connection set — it would become a zombie that never gets removed
        // because the close event already fired and was ignored (established
        // was still false at that point).
        if (ws.readyState !== WebSocket.OPEN) {
          debugWs(`[connect] ${this.tag(payload.userId)} — socket closed during async auth, skipping (zombie prevention)`);
          return;
        }

        // Was the user already connected on another tab?
        const wasConnected = this.connectionCount(payload.userId) > 0;

        // Add this connection to the user's set and mark as established.
        // handleDisconnect checks `established` — any close event that
        // fires before this point is harmlessly ignored.
        const count = this.addConnection(payload.userId, ws);
        ws.established = true;

        // Mark user as online in Redis
        PresenceService.setOnline(payload.userId);
        debugWs(`[connect] ${this.tag(payload.userId)} — tab #${count}, wasConnected=${wasConnected}, notifiedOnline=${this.notifiedOnline.has(payload.userId)}`);

        // Notify friends only on the FIRST connection for this user.
        // Additional tabs don't change presence — user was already online.
        if (!wasConnected) {
          // Schedule the notification with a short delay so React StrictMode's
          // ephemeral mount/unmount/remount cycle settles before we fire.
          // Each new first-connection restarts the timer.
          const existingTimer = this.onlineNotifyTimers.get(payload.userId);
          if (existingTimer) clearTimeout(existingTimer);

          const userId = payload.userId;
          const timer = setTimeout(async () => {
            this.onlineNotifyTimers.delete(userId);
            const connCount = this.connectionCount(userId);
            const alreadyNotified = this.notifiedOnline.has(userId);
            debugWs(`[onlineNotify] ${this.tag(userId)} — 300ms timer fired: connCount=${connCount}, alreadyNotified=${alreadyNotified}`);
            // Only notify if: (a) user is still connected, (b) friends
            // haven't already been told (e.g. page refresh — they already
            // know you're online).
            if (connCount > 0 && !alreadyNotified) {
              this.notifiedOnline.add(userId);
              debugWs(`[onlineNotify] ${this.tag(userId)} — sending ONLINE notify=true to friends`);
              await this.notifyFriendsPresenceChange(userId, PresenceStatus.ONLINE, true);
            }
          }, 300);
          this.onlineNotifyTimers.set(payload.userId, timer);
        }

        // Confirm successful connection to the client
        this.send(ws, {
          type: 'connected',
          userId: payload.userId,
        });
      } catch (error) {
        // Token invalid or expired
        console.error('WebSocket auth error:', error);
        ws.close(1008, 'Invalid token');
      }
    });

    // Start the TCP keep-alive heartbeat loop.
    // This detects dead connections (e.g. network drops, closed laptops)
    // that didn't send a clean WebSocket close frame.
    this.startHeartbeat();

    // Actively poll connected users for inactivity transitions.
    // This is what drives away/offline state changes and force-logout.
    this.startPresenceMonitor();

    // Periodically clean up stale Redis presence keys.
    // Acts as a safety net for edge cases where handleDisconnect
    // didn't run (e.g. server crash).
    setInterval(() => {
      PresenceService.cleanupStalePresence();
    }, 60 * 1000); // Every 60 seconds

    console.log('✅ WebSocket server initialized');
  }

  // Route incoming client messages to the correct handler
  private async handleMessage(ws: AuthenticatedWebSocket, message: string) {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'heartbeat':
          // Client is reporting activity (UI interaction, etc.)
          // Update their lastSeen timestamp in Redis.
          // This is separate from the TCP ping/pong heartbeat:
          // - TCP ping/pong: keeps connection alive, detects dead sockets
          // - Activity heartbeat: tracks user activity for away/auto-logout
          if (ws.userId) {
            await PresenceService.updateActivity(ws.userId);
            // If the presence monitor had already moved them to AWAY, coming
            // back with activity means they're ONLINE again — notify friends
            // (but not as a "notable" event — no toast, just list update).
            // Update ALL sockets for this user, not just the active one —
            // otherwise the monitor may read a stale AWAY from a sibling
            // socket and fire a redundant notification or skip updates.
            if (ws.presenceStatus === PresenceStatus.AWAY) {
              debugWs(`[heartbeat] ${this.tag(ws.userId)} — AWAY→ONLINE (activity detected)`);
              const userSockets = this.connections.get(ws.userId);
              if (userSockets) {
                for (const s of userSockets) {
                  s.presenceStatus = PresenceStatus.ONLINE;
                }
              }
              await this.notifyFriendsPresenceChange(ws.userId, PresenceStatus.ONLINE);
            }
          }
          this.send(ws, { type: 'heartbeat_ack' });
          break;

        case 'message':
          // Client wants to send a chat message
          await this.handleChatMessage(ws, data);
          break;

        default:
          console.log('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  // Handle a chat message sent from one user to another
  private async handleChatMessage(ws: AuthenticatedWebSocket, data: any) {
    const senderId = ws.userId;

    if (!senderId) {
      this.send(ws, { type: 'error', message: 'Not authenticated' });
      return;
    }

    const { recipientId, content, clientId } = data;

    if (!recipientId || !content?.trim()) {
      this.send(ws, { type: 'error', message: 'Invalid message' });
      return;
    }

    // Verify sender and recipient are friends
    const friendship = await prisma.friendship.findFirst({
      where: {
        OR: [
          { userId: senderId, friendId: recipientId, status: 'ACCEPTED' },
          { userId: recipientId, friendId: senderId, status: 'ACCEPTED' },
        ],
      },
    });

    if (!friendship) {
      this.send(ws, { type: 'error', message: 'Not friends with this user' });
      return;
    }

    // Core Disconnect behavior: no messaging offline users.
    // If recipient is offline, reject the message immediately.
    const recipientPresence = await PresenceService.getPresence(recipientId);

    if (recipientPresence?.status === PresenceStatus.OFFLINE) {
      this.send(ws, {
        type: 'message_failed',
        reason: 'offline',
        recipientId,
        message: 'User is offline',
        clientId,
      });
      return;
    }

    // Persist message to database
    const savedMessage = await prisma.message.create({
      data: {
        fromUserId: senderId,
        toUserId: recipientId,
        content: content.trim(),
      },
      include: {
        sender: {
          select: { id: true, displayName: true, avatarUrl: true },
        },
      },
    });

    // Acknowledge to sender that message was sent
    this.send(ws, {
      type: 'message_sent',
      message: savedMessage,
      clientId,
    });

    // Deliver to recipient in real-time — send to all their open tabs
    const recipientSet = this.connections.get(recipientId);
    if (recipientSet && recipientSet.size > 0) {
      for (const recipientWs of recipientSet) {
        this.send(recipientWs, {
          type: 'message_received',
          message: savedMessage,
        });
      }

      // Mark as delivered since recipient received it
      const deliveredAt = new Date();
      await prisma.message.update({
        where: { id: savedMessage.id },
        data: { deliveredAt },
      });

      // Notify sender of delivery (all tabs)
      this.sendToAllConnections(senderId, {
        type: 'message_delivered',
        messageId: savedMessage.id,
        deliveredAt: deliveredAt.toISOString(),
      });
    }
  }

  // Called when a WebSocket connection closes (clean or unclean)
  private async handleDisconnect(ws: AuthenticatedWebSocket) {
    // Ignore close events for sockets that were never fully established
    // (e.g. closed during the async auth check before addConnection ran).
    if (!ws.userId || !ws.established) {
      debugWs(`[disconnect] ignored — userId=${ws.userId ?? 'none'}, established=${ws.established ?? false}`);
      return;
    }

    const userId = ws.userId;
    const remaining = this.removeConnection(userId, ws);

    // If the user still has other tabs open, nothing to do —
    // they're still online, no presence change needed.
    if (remaining > 0) {
      debugWs(`[disconnect] ${this.tag(userId)} — closed a tab (${remaining} remaining)`);
      return;
    }

    // Last connection closed
    debugWs(`[disconnect] ${this.tag(userId)} — last tab closed. Starting 1s grace timer. notifiedOnline=${this.notifiedOnline.has(userId)}`);

    // Cancel any pending ONLINE notification — user disconnected before
    // the stabilization delay fired.
    const notifyTimer = this.onlineNotifyTimers.get(userId);
    if (notifyTimer) {
      clearTimeout(notifyTimer);
      this.onlineNotifyTimers.delete(userId);
      debugWs(`[disconnect] ${this.tag(userId)} — cancelled pending onlineNotify timer`);
    }

    // Don't mark offline immediately — give a 1s grace period for page
    // refreshes and brief network blips. If the user reconnects within
    // this window, friends never see an offline/online flap.
    const graceTimer = setTimeout(async () => {
      this.disconnectGraceTimers.delete(userId);
      const connCount = this.connectionCount(userId);
      debugWs(`[graceTimer] ${this.tag(userId)} — 1s grace expired. connCount=${connCount}`);
      // Only go offline if they haven't reconnected
      if (connCount === 0) {
        this.notifiedOnline.delete(userId);
        debugWs(`[graceTimer] ${this.tag(userId)} — setting OFFLINE in Redis, notifying friends`);
        await PresenceService.setOffline(userId);
        await this.notifyFriendsPresenceChange(userId, PresenceStatus.OFFLINE);
      } else {
        debugWs(`[graceTimer] ${this.tag(userId)} — reconnected during grace, skipping offline`);
      }
    }, 1_000);
    this.disconnectGraceTimers.set(userId, graceTimer);

    // Start a 90s timer — if the user doesn't reconnect, blocklist their token.
    // This enforces "online means present": closing the browser for more than
    // 90s means you need to log in again.
    if (ws.token) {
      const token = ws.token;
      debugWs(`[disconnect] ${this.tag(userId)} — starting 90s forceReloginTimer`);
      const timer = setTimeout(async () => {
        this.forceReloginTimers.delete(userId);
        await TokenBlocklist.blocklist(token);
        console.log(`[forceRelogin] ${this.tag(userId)} — token blocklisted (90s timeout)`);
      }, 90_000);
      this.forceReloginTimers.set(userId, timer);
    }
  }

  // Broadcast a presence change to all of a user's online friends.
  // `notify` signals whether this is a "notable" transition (e.g. offline → online)
  // that should trigger a toast/sound on the friend's client, vs a quiet status
  // update (e.g. away → online) that only updates the contact list.
  private async notifyFriendsPresenceChange(userId: string, status: PresenceStatus, notify = false) {
    // Get all accepted friendships for this user
    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [
          { userId, status: 'ACCEPTED' },
          { friendId: userId, status: 'ACCEPTED' },
        ],
      },
    });

    // Get user info to include in the notification
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true, avatarUrl: true },
    });

    // Send presence update to each friend that is currently connected
    const deliveredTo: string[] = [];
    for (const friendship of friendships) {
      const friendId = friendship.userId === userId ? friendship.friendId : friendship.userId;
      const friendConns = this.connectionCount(friendId);
      if (friendConns > 0) {
        deliveredTo.push(`${this.tag(friendId)}(${friendConns})`);
      }
      this.sendToAllConnections(friendId, {
        type: 'presence_change',
        user,
        status,
        notify,
      });
    }
    console.log(`[presence] ${this.tag(userId)} → ${status}${notify ? ' (NOTIFY)' : ''} — sent to: ${deliveredTo.length > 0 ? deliveredTo.join(', ') : '(no connected friends)'}`);
  }

  // Helper: safely send JSON to a WebSocket client
  private send(ws: WebSocket, data: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // TCP keep-alive heartbeat.
  // Every 30 seconds, ping all connected clients.
  // If a client doesn't respond with a pong before the next ping,
  // its connection is considered dead and terminated.
  // This handles network drops and closed devices that don't
  // send a clean WebSocket close frame.
  private startHeartbeat() {
    const interval = setInterval(() => {
      this.wss.clients.forEach((ws: AuthenticatedWebSocket) => {
        if (ws.isAlive === false) {
          // No pong received since last ping - connection is dead
          return ws.terminate();
        }

        // Mark as not alive until we get a pong back
        ws.isAlive = false;
        ws.ping();
      });
    }, 2_000); // 2 seconds

    // Clean up interval when server closes
    this.wss.on('close', () => {
      clearInterval(interval);
    });
  }

  // Actively monitors all connected users for inactivity.
  // Runs every 10 seconds and transitions users through online -> away -> offline.
  // When offline threshold is crossed:
  //   - sends a force_logout message to ALL of the user's connections
  //   - closes all WebSocket connections
  //   - notifies the user's friends
  // When away threshold is crossed:
  //   - notifies friends (status_change: away)
  // Avoids duplicate notifications by tracking presenceStatus per connection.
  private startPresenceMonitor() {
    const interval = setInterval(async () => {
      // Iterate unique userIds (not individual sockets)
      for (const [userId, wsSet] of this.connections) {
        const presence = await PresenceService.getPresence(userId);
        const newStatus = presence?.status ?? PresenceStatus.OFFLINE;

        // Use the first socket's presenceStatus as the canonical previous status.
        // All sockets for the same user share the same logical presence state.
        const firstWs = wsSet.values().next().value;
        if (!firstWs) continue;
        const prevStatus = firstWs.presenceStatus ?? PresenceStatus.ONLINE;

        if (newStatus === prevStatus) continue;

        debugWs(`[monitor] ${this.tag(userId)} — ${prevStatus}→${newStatus} (sockets: ${wsSet.size})`);

        // Update presenceStatus on ALL sockets for this user
        for (const ws of wsSet) {
          ws.presenceStatus = newStatus;
        }

        if (newStatus === PresenceStatus.OFFLINE) {
          console.log(`[monitor] ${this.tag(userId)} — forcing logout (inactivity)`);
          // Tell all tabs to sign out, then close them
          for (const ws of wsSet) {
            this.send(ws, { type: 'force_logout', reason: 'inactivity' });
            // Blocklist this tab's token
            if (ws.token) {
              await TokenBlocklist.blocklist(ws.token);
            }
            ws.close();
          }
          // Remove all connections so handleDisconnect won't double-fire
          this.connections.delete(userId);
          this.notifiedOnline.delete(userId);
          // Cancel any pending disconnect timer (defensive cleanup)
          const timer = this.forceReloginTimers.get(userId);
          if (timer) {
            clearTimeout(timer);
            this.forceReloginTimers.delete(userId);
          }
          // Notify friends
          await this.notifyFriendsPresenceChange(userId, PresenceStatus.OFFLINE);
        } else if (newStatus === PresenceStatus.AWAY) {
          debugWs(`[monitor] ${this.tag(userId)} — transitioning to AWAY`);
          await this.notifyFriendsPresenceChange(userId, PresenceStatus.AWAY);
        }
      }
    }, 1_000); // check every 1 second

    this.wss.on('close', () => clearInterval(interval));
  }

  // Public method to send a message to a specific user by ID.
  // Used by other parts of the application (e.g. REST routes)
  // to push real-time events to connected clients.
  sendToUser(userId: string, data: any) {
    this.sendToAllConnections(userId, data);
  }

  async notifyFriendsProfileUpdate(userId: string) {
    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [
          { userId, status: 'ACCEPTED' },
          { friendId: userId, status: 'ACCEPTED' },
        ],
      },
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true, avatarUrl: true },
    });

    if (!user) return;

    for (const friendship of friendships) {
      const friendId = friendship.userId === userId ? friendship.friendId : friendship.userId;
      this.sendToAllConnections(friendId, { type: 'profile_updated', user });
    }
  }
}
