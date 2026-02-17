import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { PresenceService, PresenceStatus } from '../services/presence';

const router = Router();

router.use(authenticate);

// Send a message
router.post(
  '/send',
  [
    body('recipientId').notEmpty().isUUID(),
    body('content').trim().notEmpty().isLength({ max: 2000 }),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { recipientId, content } = req.body;
      const senderId = req.user!.id;

      // Can't message yourself
      if (recipientId === senderId) {
        return res.status(400).json({ error: 'Cannot message yourself' });
      }

      // Check they are friends
      const friendship = await prisma.friendship.findFirst({
        where: {
          OR: [
            { userId: senderId, friendId: recipientId, status: 'ACCEPTED' },
            { userId: recipientId, friendId: senderId, status: 'ACCEPTED' },
          ],
        },
      });

      if (!friendship) {
        return res.status(403).json({ error: 'You are not friends with this user' });
      }

      // Check recipient is online
      const recipientPresence = await PresenceService.getPresence(recipientId);

      if (recipientPresence?.status === PresenceStatus.OFFLINE) {
        return res.status(403).json({
          error: 'Cannot send message',
          reason: 'offline',
          message: 'This user is currently offline',
        });
      }

      // Save message to database
      const message = await prisma.message.create({
        data: {
          fromUserId: senderId,
          toUserId: recipientId,
          content,
          delivered: false,
          read: false,
        },
        include: {
          sender: {
            select: {
              id: true,
              displayName: true,
            },
          },
        },
      });

      res.status(201).json({ message });
    } catch (error) {
      console.error('Send message error:', error);
      res.status(500).json({ error: 'Failed to send message' });
    }
  }
);

// Get conversation history between two users
router.get('/conversation/:friendId', async (req: Request, res: Response) => {
  try {
    const { friendId } = req.params;
    const currentUserId = req.user!.id;
    const limit = parseInt(req.query.limit as string) || 50;
    const before = req.query.before as string; // Message ID for pagination

    // Verify friendship
    const friendship = await prisma.friendship.findFirst({
      where: {
        OR: [
          { userId: currentUserId, friendId: friendId, status: 'ACCEPTED' },
          { userId: friendId, friendId: currentUserId, status: 'ACCEPTED' },
        ],
      },
    });

    if (!friendship) {
      return res.status(403).json({ error: 'Not friends with this user' });
    }

    // Fetch messages
    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { fromUserId: currentUserId, toUserId: friendId },
          { fromUserId: friendId, toUserId: currentUserId },
        ],
        ...(before && {
          sentAt: { lt: (await prisma.message.findUnique({ where: { id: before } }))?.sentAt },
        }),
      },
      orderBy: { sentAt: 'desc' },
      take: limit,
      include: {
        sender: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
    });

    // Return in chronological order
    res.json({ messages: messages.reverse() });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Failed to get conversation' });
  }
});

// Mark messages as read
router.post('/read/:friendId', async (req: Request, res: Response) => {
  try {
    const { friendId } = req.params;
    const currentUserId = req.user!.id;

    await prisma.message.updateMany({
      where: {
        fromUserId: friendId,
        toUserId: currentUserId,
        read: false,
      },
      data: { read: true },
    });

    res.json({ message: 'Messages marked as read' });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

export default router;
