import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { authenticate } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { getWsInstance } from '../services/wsInstance';
import { r2, R2_BUCKET } from '../lib/r2';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only jpg, png, gif, and webp files are allowed'));
    }
  },
});

// Proxy avatar file from storage (public, no auth)
router.get('/file/*key', async (req: Request, res: Response) => {
  const key = req.path.slice('/file/'.length);
  try {
    const { Body, ContentType } = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    const bytes = await Body!.transformToByteArray();
    res.setHeader('Content-Type', ContentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(Buffer.from(bytes));
  } catch {
    res.status(404).end();
  }
});

router.use(authenticate);

// Upload avatar
router.post('/', upload.single('avatar'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const userId = req.user!.id;
    const ext = path.extname(req.file.originalname).toLowerCase() || '.png';
    const key = `avatars/${userId}${ext}`;

    // Delete old avatar from storage if extension changed
    const currentUser = await prisma.user.findUnique({ where: { id: userId } });
    if (currentUser?.avatarUrl) {
      const oldKey = currentUser.avatarUrl.replace('/api/avatar/file/', '');
      if (oldKey !== key) {
        await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: oldKey })).catch(() => {});
      }
    }

    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    }));

    const avatarUrl = `/api/avatar/file/${key}`;

    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });

    const wsService = getWsInstance();
    if (wsService) await wsService.notifyFriendsProfileUpdate(userId);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

// Multer error handler
router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large (max 20MB)' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message.includes('Only jpg, png, gif')) {
    return res.status(400).json({ error: err.message });
  }
  return res.status(500).json({ error: 'Upload failed' });
});

export default router;
