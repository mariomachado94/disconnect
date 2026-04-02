import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { PresenceService } from '../services/presence';
import { getWsInstance } from '../services/wsInstance';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Send friend request
router.post(
  '/request',
  [body('email').isEmail().normalizeEmail()],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email } = req.body;
      const currentUserId = req.user!.id;

      // Can't add yourself
      if (email === req.user!.email) {
        return res.status(400).json({ error: 'Cannot add yourself as a friend' });
      }

      // Find user by email
      const targetUser = await prisma.user.findUnique({
        where: { email },
      });

      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Check if friendship already exists
      const existingFriendship = await prisma.friendship.findFirst({
        where: {
          OR: [
            { userId: currentUserId, friendId: targetUser.id },
            { userId: targetUser.id, friendId: currentUserId },
          ],
        },
      });

      if (existingFriendship) {
        if (existingFriendship.status === 'ACCEPTED') {
          return res.status(400).json({ error: 'Already friends' });
        }
        if (existingFriendship.status === 'PENDING') {
          return res.status(400).json({ error: 'Friend request already pending' });
        }
        if (existingFriendship.status === 'BLOCKED') {
          return res.status(400).json({ error: 'Cannot send friend request' });
        }
      }

      // Create friend request
      const friendship = await prisma.friendship.create({
        data: {
          userId: currentUserId,
          friendId: targetUser.id,
          status: 'PENDING',
        },
        include: {
          friend: {
            select: {
              id: true,
              email: true,
              displayName: true,
            },
          },
        },
      });

      // Notify the recipient in real-time that they have a new friend request
      const wsService = getWsInstance();
      if (wsService) {
        wsService.sendToUser(targetUser.id, {
          type: 'friend_request_received',
          from: {
            id: req.user!.id,
            displayName: req.user!.displayName,
          },
        });
      }

      res.status(201).json({
        message: 'Friend request sent',
        friendship: {
          id: friendship.id,
          status: friendship.status,
          friend: friendship.friend,
        },
      });
    } catch (error) {
      console.error('Friend request error:', error);
      res.status(500).json({ error: 'Failed to send friend request' });
    }
  }
);

// Accept friend request
router.post('/accept/:friendshipId', async (req: Request, res: Response) => {
  try {
    const { friendshipId } = req.params;
    const currentUserId = req.user!.id;

    // Find the friendship request
    const friendship = await prisma.friendship.findUnique({
      where: { id: friendshipId },
    });

    if (!friendship) {
      return res.status(404).json({ error: 'Friend request not found' });
    }

    // Verify the current user is the recipient
    if (friendship.friendId !== currentUserId) {
      return res.status(403).json({ error: 'Not authorized to accept this request' });
    }

    if (friendship.status !== 'PENDING') {
      return res.status(400).json({ error: 'Friend request is not pending' });
    }

    // Update to accepted, including both sides:
    // - user  → the original requester (Mario) — used in the REST response to Bob
    // - friend → the accepter (Bob)            — used in the WS notification to Mario
    const updatedFriendship = await prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: 'ACCEPTED' },
      include: {
        user: {
          select: { id: true, email: true, displayName: true, avatarUrl: true },
        },
        friend: {
          select: { id: true, email: true, displayName: true, avatarUrl: true },
        },
      },
    });

    // Notify the original requester in real-time that their request was accepted.
    // Include the accepter's current presence so their contact list updates immediately.
    const wsService = getWsInstance();
    if (wsService) {
      const accepterPresence = await PresenceService.getPresence(currentUserId);
      wsService.sendToUser(friendship.userId, {
        type: 'friend_accepted',
        friend: {
          id: updatedFriendship.friend.id,
          email: updatedFriendship.friend.email,
          displayName: updatedFriendship.friend.displayName,
          avatarUrl: updatedFriendship.friend.avatarUrl,
          status: accepterPresence?.status || 'offline',
          lastSeen: accepterPresence?.lastSeen || 0,
        },
      });
    }

    res.json({
      message: 'Friend request accepted',
      friendship: {
        id: updatedFriendship.id,
        status: updatedFriendship.status,
        friend: updatedFriendship.user,
      },
    });
  } catch (error) {
    console.error('Accept friend error:', error);
    res.status(500).json({ error: 'Failed to accept friend request' });
  }
});

// Reject/decline friend request
router.post('/reject/:friendshipId', async (req: Request, res: Response) => {
  try {
    const { friendshipId } = req.params;
    const currentUserId = req.user!.id;

    const friendship = await prisma.friendship.findUnique({
      where: { id: friendshipId },
    });

    if (!friendship) {
      return res.status(404).json({ error: 'Friend request not found' });
    }

    // Verify the current user is the recipient
    if (friendship.friendId !== currentUserId) {
      return res.status(403).json({ error: 'Not authorized to reject this request' });
    }

    // Delete the friendship
    await prisma.friendship.delete({
      where: { id: friendshipId },
    });

    res.json({ message: 'Friend request rejected' });
  } catch (error) {
    console.error('Reject friend error:', error);
    res.status(500).json({ error: 'Failed to reject friend request' });
  }
});

// Get all friends with presence status
router.get('/', async (req: Request, res: Response) => {
  try {
    const currentUserId = req.user!.id;

    // Get all accepted friendships
    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [
          { userId: currentUserId, status: 'ACCEPTED' },
          { friendId: currentUserId, status: 'ACCEPTED' },
        ],
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            avatarUrl: true,
          },
        },
        friend: {
          select: {
            id: true,
            email: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });

    // Extract friend user objects
    const friends = friendships.map((f) => {
      // If current user is the one who sent the request, friend is the recipient
      return f.userId === currentUserId ? f.friend : f.user;
    });

    // Get presence for all friends
    const friendIds = friends.map((f) => f.id);
    const presenceMap = await PresenceService.getMultiplePresence(friendIds);

    // Combine friend data with presence
    const friendsWithPresence = friends.map((friend) => {
      const presence = presenceMap.get(friend.id);
      return {
        id: friend.id,
        email: friend.email,
        displayName: friend.displayName,
        avatarUrl: friend.avatarUrl,
        status: presence?.status || 'offline',
        lastSeen: presence?.lastSeen || 0,
      };
    });

    res.json({ friends: friendsWithPresence });
  } catch (error) {
    console.error('Get friends error:', error);
    res.status(500).json({ error: 'Failed to get friends' });
  }
});

// Get pending friend requests (received)
router.get('/requests/pending', async (req: Request, res: Response) => {
  try {
    const currentUserId = req.user!.id;

    const pendingRequests = await prisma.friendship.findMany({
      where: {
        friendId: currentUserId,
        status: 'PENDING',
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });

    res.json({
      requests: pendingRequests.map((r) => ({
        id: r.id,
        from: r.user,
        createdAt: r.createdAt,
      })),
    });
  } catch (error) {
    console.error('Get pending requests error:', error);
    res.status(500).json({ error: 'Failed to get pending requests' });
  }
});

// Remove friend
router.delete('/:friendId', async (req: Request, res: Response) => {
  try {
    const { friendId } = req.params;
    const currentUserId = req.user!.id;

    // Find and delete the friendship (either direction)
    const deleted = await prisma.friendship.deleteMany({
      where: {
        OR: [
          { userId: currentUserId, friendId: friendId },
          { userId: friendId, friendId: currentUserId },
        ],
      },
    });

    if (deleted.count === 0) {
      return res.status(404).json({ error: 'Friendship not found' });
    }

    res.json({ message: 'Friend removed' });
  } catch (error) {
    console.error('Remove friend error:', error);
    res.status(500).json({ error: 'Failed to remove friend' });
  }
});

export default router;
