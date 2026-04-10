import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import authRoutes from './routes/auth';
import friendsRoutes from './routes/friends';
import messagesRoutes from './routes/messages';
import avatarRoutes from './routes/avatar';
import { authenticate } from './middleware/auth';
import { WebSocketService } from './services/websocket';
import { setWsInstance, getWsInstance } from './services/wsInstance';
import { prisma } from './utils/prisma';
import './utils/redis'; // Initialize Redis connection

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Create HTTP server (needed for WebSocket)
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());
// Avatars are served from Cloudflare R2 (no local static file serving)

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth routes (public)
app.use('/api/auth', authRoutes);

// Friends routes (protected)
app.use('/api/friends', friendsRoutes);

// Messages routes (protected)
app.use('/api/messages', messagesRoutes);

// Avatar routes (protected)
app.use('/api/avatar', avatarRoutes);

// Protected route example
app.get('/api/auth/me', authenticate, async (req, res) => {
  res.json({
    user: {
      id: req.user!.id,
      email: req.user!.email,
      displayName: req.user!.displayName,
      avatarUrl: req.user!.avatarUrl,
    },
  });
});

app.patch('/api/auth/profile', authenticate, async (req, res) => {
  const { displayName } = req.body;
  if (typeof displayName !== 'string' || displayName.trim().length < 1 || displayName.trim().length > 50) {
    return res.status(400).json({ error: 'Display name must be 1–50 characters' });
  }
  try {
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { displayName: displayName.trim() },
    });
    const wsService = getWsInstance();
    if (wsService) await wsService.notifyFriendsProfileUpdate(req.user!.id);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Initialize WebSocket server
const wsService = new WebSocketService(server);
setWsInstance(wsService);

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🔌 WebSocket server running on ws://localhost:${PORT}/ws`);
});
