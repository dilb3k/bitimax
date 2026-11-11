import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { LoginRequest } from '../models/LoginRequest';
import { User } from '../models/User';
import { audit } from '../models/AuditLog';
import { requireSession, AuthedRequest } from '../middleware/webAuth';
import { signSession } from '../utils/jwt';
import { config } from '../config';
import { randomToken, sha256 } from '../utils/crypto';
import { clientIp } from '../middleware/webProxy';

const router = Router();

/**
 * Passwordless login for the website, paired through the bot.
 *
 * The browser never sees a credential: it asks for a pairing token, opens Telegram, and the
 * account owner approves the request inside a chat that Telegram itself has already
 * authenticated. That removes the entire password surface — no reset flow, no reuse, no
 * database of hashes worth stealing — and keeps the bot as the single source of identity.
 */

// Starting a login is cheap for us and expensive to abuse in bulk; poll is the hot path.
const startLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, message: { error: 'Juda ko‘p urinish. Birozdan so‘ng qayta urinib ko‘ring.' }, standardHeaders: true, legacyHeaders: false, keyGenerator: clientIp });
const pollLimiter = rateLimit({ windowMs: 5 * 60 * 1000, limit: 250, message: { error: 'Juda ko‘p urinish. Birozdan so‘ng qayta urinib ko‘ring.' }, standardHeaders: true, legacyHeaders: false, keyGenerator: clientIp });

/** Human-comparable code shown on both screens. Ambiguous glyphs left out, as with deal codes. */
function generatePairCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[crypto.randomInt(0, alphabet.length)];
  return code;
}

router.post('/start', startLimiter, async (req: Request, res: Response) => {
  try {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + config.loginRequestMinutes * 60_000);

    const request = await LoginRequest.create({
      tokenHash: sha256(token),
      pairCode: generatePairCode(),
      status: 'pending',
      // Only ever displayed back to the person approving, so they can tell their own device
      // from somebody else's. Truncated because there is no reason to keep more.
      ip: clientIp(req).slice(0, 45),
      userAgent: String(req.header('user-agent') || '').slice(0, 120),
      expiresAt,
    });

    res.json({
      token,
      pairCode: request.pairCode,
      deepLink: `https://t.me/${config.botUsername}?start=login_${token}`,
      botUsername: config.botUsername,
      expiresAt,
    });
  } catch (error: any) {
    console.error('[Auth] start failed:', error);
    res.status(500).json({ error: 'Kirish so‘rovini yaratib bo‘lmadi' });
  }
});

router.get('/poll', pollLimiter, async (req: Request, res: Response) => {
  try {
    const token = String(req.query.token || '');
    if (!token || token.length > 200) return res.status(400).json({ error: 'Token noto‘g‘ri' });

    const request = await LoginRequest.findOne({ tokenHash: sha256(token) });
    if (!request || request.expiresAt.getTime() < Date.now()) {
      return res.json({ status: 'expired' });
    }
    if (request.status === 'denied') return res.json({ status: 'denied' });
    // A pairing token is good for exactly one session. Polling again after the browser has
    // already collected it must not mint a second one.
    if (request.status === 'consumed') return res.json({ status: 'expired' });
    if (request.status !== 'approved' || !request.userId) return res.json({ status: 'pending' });

    const claimed = await LoginRequest.findOneAndUpdate(
      { _id: request._id, status: 'approved' },
      { $set: { status: 'consumed', consumedAt: new Date() } },
      { new: true }
    );
    if (!claimed) return res.json({ status: 'expired' });

    const user = await User.findById(request.userId);
    if (!user) return res.json({ status: 'expired' });
    if (user.isBlocked) return res.status(403).json({ status: 'blocked', error: user.blockReason || 'Hisobingiz bloklangan' });

    const ttlSeconds = config.webSessionDays * 24 * 3600;
    const session = signSession(
      { sub: String(user._id), tg: user.telegramId, sid: randomToken(9) },
      ttlSeconds
    );

    await audit({
      actorId: user._id as any,
      actorTelegramId: user.telegramId,
      action: 'web.login',
      targetType: 'User',
      targetId: user._id as any,
      ip: request.ip,
      after: { userAgent: request.userAgent },
    });

    res.json({ status: 'approved', session, expiresIn: ttlSeconds, user: publicUser(user) });
  } catch (error: any) {
    console.error('[Auth] poll failed:', error);
    res.status(500).json({ error: 'Xatolik yuz berdi' });
  }
});

/** Ends every session of this account, not just the calling browser's. */
router.post('/logout', requireSession, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthedRequest).authUser;
    user.webSessionsValidFrom = new Date();
    await user.save();
    await audit({
      actorId: user._id as any,
      actorTelegramId: user.telegramId,
      action: 'web.logout_all',
      targetType: 'User',
      targetId: user._id as any,
    });
    res.json({ ok: true });
  } catch (error: any) {
    // Express 4 does not catch async errors: without this the request hangs.
    console.error('[Auth] logout failed:', error);
    res.status(500).json({ error: 'Chiqishni yakunlab bo‘lmadi' });
  }
});

export function publicUser(user: any) {
  return {
    id: String(user._id),
    telegramId: user.telegramId,
    username: user.username,
    firstName: user.firstName,
    role: user.role,
    trustLevel: user.trustLevel,
    language: user.language,
    balance: user.balance,
    totalEarned: user.totalEarned,
    totalSpent: user.totalSpent,
    sellerStats: user.sellerStats,
    payoutCard: user.payoutCard?.masked
      ? { masked: user.payoutCard.masked, holder: user.payoutCard.holder }
      : null,
    notificationSettings: user.notificationSettings,
    rating: user.averageRating ? user.averageRating() : null,
  };
}

export default router;
