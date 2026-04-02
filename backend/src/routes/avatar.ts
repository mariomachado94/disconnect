import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../middleware/auth';
import { prisma } from '../utils/prisma';

const router = Router();
router.use(authenticate);

const UPLOAD_DIR = path.join(__dirname, '../../uploads/avatars');

// Ensure directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `${req.user!.id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only jpg, png, gif, and webp files are allowed'));
    }
  },
});

// Upload avatar
router.post('/', upload.single('avatar'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    // Delete old avatar if it has a different filename
    const currentUser = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (currentUser?.avatarUrl && currentUser.avatarUrl !== avatarUrl) {
      const oldPath = path.join(__dirname, '../../', currentUser.avatarUrl);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { avatarUrl },
    });

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
      return res.status(400).json({ error: 'File too large (max 2MB)' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message.includes('Only jpg, png, gif')) {
    return res.status(400).json({ error: err.message });
  }
  return res.status(500).json({ error: 'Upload failed' });
});

export default router;
