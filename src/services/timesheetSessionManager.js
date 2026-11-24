const crypto = require('crypto');

const SESSION_RETENTION_MS = 10 * 60 * 1000; // Keep completed session summary for 10 min

class TimesheetSessionManager {
  constructor() {
    this.sessions = new Map();
  }

  generateToken(sessionId) {
    return crypto
      .createHmac('sha256', process.env.DISCORD_CLIENT_SECRET || 'fallback_secret')
      .update(`timesheet:${sessionId}`)
      .digest('hex');
  }

  verifyToken(sessionId, token) {
    if (!sessionId || !token || typeof sessionId !== 'string' || typeof token !== 'string') {
      return false;
    }
    const expected = this.generateToken(sessionId);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(token, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  createSession({ targetDate, reason, vncPort, timeoutMs, page, credentials, onResume, onCancel }) {
    const id = 'ts_' + crypto.randomBytes(12).toString('hex');
    const token = this.generateToken(id);
    const now = Date.now();

    const session = {
      id,
      token,
      targetDate,
      reason: reason || 'Cloudflare / Login verification required',
      status: 'waiting', // waiting | submitting | completed | cancelled | failed | expired
      message: 'Waiting for you to complete Cloudflare / login in the browser below.',
      vncPort,
      vncActive: true,
      createdAt: now,
      expiresAt: now + timeoutMs,
      page,
      credentials,
      onResume,
      onCancel
    };

    this.sessions.set(id, session);
    return session;
  }

  getSession(id) {
    return this.sessions.get(id) || null;
  }

  getPublicState(session) {
    if (!session) return null;
    return {
      id: session.id,
      targetDate: session.targetDate,
      reason: session.reason,
      status: session.status,
      message: session.message,
      vncActive: session.vncActive,
      expiresAt: session.expiresAt,
      remainingMs: Math.max(0, session.expiresAt - Date.now())
    };
  }

  updateSession(id, updates) {
    const session = this.sessions.get(id);
    if (!session) return null;
    Object.assign(session, updates);
    return session;
  }

  closeSession(id, finalStatus, finalMessage) {
    const session = this.sessions.get(id);
    if (!session) return;

    session.status = finalStatus;
    if (finalMessage) session.message = finalMessage;
    session.vncActive = false;
    session.page = null;
    session.credentials = null;
    session.onResume = null;
    session.onCancel = null;

    setTimeout(() => {
      this.sessions.delete(id);
    }, SESSION_RETENTION_MS).unref();
  }

  buildSessionUrl(session) {
    const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
    return `${baseUrl}/timesheet/session?id=${encodeURIComponent(session.id)}&token=${encodeURIComponent(session.token)}`;
  }
}

module.exports = new TimesheetSessionManager();
