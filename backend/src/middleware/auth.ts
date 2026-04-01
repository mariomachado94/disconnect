import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { prisma } from '../utils/prisma';
import { TokenBlocklist } from '../services/tokenBlocklist';

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer '
    const payload = verifyToken(token);

    // Reject tokens that have been blocklisted (e.g. after disconnect timeout)
    const blocked = await TokenBlocklist.isBlocklisted(token);
    if (blocked) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }

    // Fetch user from database
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
