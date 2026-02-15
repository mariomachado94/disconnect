import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { verifyToken } from '../utils/jwt';
import { PresenceService, PresenceStatus } from './presence';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  isAlive?: boolean;
}

export class WebSocketService {
  private wss: WebSocketServer;
  private connections: Map<string, AuthenticatedWebSocket> = new Map();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.initialize();
  }

  private initialize() {
    this.wss.on('connection', (ws: AuthenticatedWebSocket, req) => {
      console.log('New WebSocket connection attempt');

      // Extract token from query params or headers
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

        // Store connection
        this.connections.set(payload.userId, ws);

        // Set user online
        PresenceService.setOnline(payload.userId);
        console.log(`User ${payload.userId} connected`);

        // Broadcast to friends that user is online
        this.broadcastPresenceChange(payload.userId, PresenceStatus.ONLINE);

        // Handle messages
        ws.on('message', (message) => {
          this.handleMessage(ws, message.toString());
        });

        // Handle pong (for heartbeat)
        ws.on('pong', () => {
          ws.isAlive = true;
        });

        // Handle disconnect
        ws.on('close', () => {
          this.handleDisconnect(ws);
        });

        // Send initial connection success
        this.send(ws, {
          type: 'connected',
          userId: payload.userId,
        });

      } catch (error) {
        console.error('WebSocket auth error:', error);
        ws.close(1008, 'Invalid token');
      }
    });

    // Start heartbeat interval (ping every 30 seconds)
    this.startHeartbeat();

    // Start presence cleanup interval (every minute)
    setInterval(() => {
      PresenceService.cleanupStalePresence();
    }, 60 * 1000);

    console.log('✅ WebSocket server initialized');
  }

  private handleMessage(ws: AuthenticatedWebSocket, message: string) {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'heartbeat':
          // Update activity timestamp
          if (ws.userId) {
            PresenceService.updateActivity(ws.userId);
          }
          this.send(ws, { type: 'heartbeat_ack' });
          break;

        case 'message':
          // Handle chat message (we'll implement this later)
          console.log('Message received:', data);
          break;

        default:
          console.log('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  private handleDisconnect(ws: AuthenticatedWebSocket) {
    if (ws.userId) {
      console.log(`User ${ws.userId} disconnected`);
      this.connections.delete(ws.userId);
      PresenceService.setOffline(ws.userId);
      this.broadcastPresenceChange(ws.userId, PresenceStatus.OFFLINE);
    }
  }

  private async broadcastPresenceChange(userId: string, status: PresenceStatus) {
    // TODO: Get user's friends list and notify them
    // For now, just log it
    console.log(`Broadcasting presence change: ${userId} is now ${status}`);
  }

  private send(ws: WebSocket, data: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  private startHeartbeat() {
    const interval = setInterval(() => {
      this.wss.clients.forEach((ws: AuthenticatedWebSocket) => {
        if (ws.isAlive === false) {
          return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // 30 seconds

    this.wss.on('close', () => {
      clearInterval(interval);
    });
  }

  // Send message to specific user
  sendToUser(userId: string, data: any) {
    const ws = this.connections.get(userId);
    if (ws) {
      this.send(ws, data);
    }
  }
}
