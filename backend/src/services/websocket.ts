import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { verifyToken } from '../utils/jwt';
import { PresenceService, PresenceStatus } from './presence';
import { prisma } from '../utils/prisma';

// Extend the base WebSocket type to include our custom properties
interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  isAlive?: boolean;
}

export class WebSocketService {
  private wss: WebSocketServer;
  // Map of userId -> WebSocket connection for fast lookups
  private connections: Map<string, AuthenticatedWebSocket> = new Map();

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
    await PresenceService.clearAll();

    // Now initialize WebSocket handlers
    this.initialize();
  }

  private initialize() {
    this.wss.on('connection', (ws: AuthenticatedWebSocket, req) => {
      console.log('New WebSocket connection attempt');

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
        ws.userId = payload.userId;
        ws.isAlive = true;

        // Store connection for this user
        this.connections.set(payload.userId, ws);

        // Mark user as online in Redis
        PresenceService.setOnline(payload.userId);
        console.log(`User ${payload.userId} connected`);

        // Notify this user's friends that they came online
        this.notifyFriendsPresenceChange(payload.userId, PresenceStatus.ONLINE);

        // Handle incoming messages from this client
        ws.on('message', (message) => {
          this.handleMessage(ws, message.toString());
        });

        // Handle pong responses (part of heartbeat mechanism)
        // When server pings, client responds with pong.
        // We mark the connection as alive so it isn't terminated.
        ws.on('pong', () => {
          ws.isAlive = true;
        });

        // Handle disconnection (clean close or network drop)
        ws.on('close', () => {
          this.handleDisconnect(ws);
        });

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

    const { recipientId, content } = data;

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
      });
      return;
    }

    // Persist message to database
    const savedMessage = await prisma.message.create({
      data: {
        fromUserId: senderId,
        toUserId: recipientId,
        content: content.trim(),
        delivered: false,
        read: false,
      },
      include: {
        sender: {
          select: { id: true, displayName: true },
        },
      },
    });

    // Acknowledge to sender that message was sent
    this.send(ws, {
      type: 'message_sent',
      message: savedMessage,
    });

    // Deliver to recipient in real-time if they have an active connection
    const recipientWs = this.connections.get(recipientId);
    if (recipientWs) {
      this.send(recipientWs, {
        type: 'message_received',
        message: savedMessage,
      });

      // Mark as delivered since recipient received it
      await prisma.message.update({
        where: { id: savedMessage.id },
        data: { delivered: true },
      });
    }
  }

  // Called when a WebSocket connection closes (clean or unclean)
  private async handleDisconnect(ws: AuthenticatedWebSocket) {
    if (ws.userId) {
      // Only clean up presence if this is still the active connection for this user.
      // A newer connection may have already replaced it in the map (e.g. reconnect),
      // in which case we should leave presence alone.
      if (this.connections.get(ws.userId) !== ws) return;

      console.log(`User ${ws.userId} disconnected`);
      this.connections.delete(ws.userId);

      // Remove presence from Redis immediately
      await PresenceService.setOffline(ws.userId);

      // Notify friends this user went offline
      await this.notifyFriendsPresenceChange(ws.userId, PresenceStatus.OFFLINE);
    }
  }

  // Broadcast a presence change (online/away/offline) to all of a user's online friends
  private async notifyFriendsPresenceChange(userId: string, status: PresenceStatus) {
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
      select: { id: true, displayName: true },
    });

    // Send presence update to each friend that is currently connected
    for (const friendship of friendships) {
      const friendId = friendship.userId === userId ? friendship.friendId : friendship.userId;

      const friendWs = this.connections.get(friendId);
      if (friendWs) {
        this.send(friendWs, {
          type: 'presence_change',
          user,
          status,
        });
      }
    }
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
    }, 30000); // 30 seconds

    // Clean up interval when server closes
    this.wss.on('close', () => {
      clearInterval(interval);
    });
  }

  // Public method to send a message to a specific user by ID.
  // Used by other parts of the application (e.g. REST routes)
  // to push real-time events to connected clients.
  sendToUser(userId: string, data: any) {
    const ws = this.connections.get(userId);
    if (ws) this.send(ws, data);
  }
}
