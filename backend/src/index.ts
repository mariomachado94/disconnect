import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import path from 'path';
import authRoutes from './routes/auth';
import friendsRoutes from './routes/friends';
import messagesRoutes from './routes/messages';
import avatarRoutes from './routes/avatar';
import { authenticate } from './middleware/auth';
import { WebSocketService } from './services/websocket';
import { setWsInstance } from './services/wsInstance';
import './utils/redis'; // Initialize Redis connection

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Create HTTP server (needed for WebSocket)
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

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

// Initialize WebSocket server
const wsService = new WebSocketService(server);
setWsInstance(wsService);

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🔌 WebSocket server running on ws://localhost:${PORT}/ws`);
});
