const express = require('express');
const fs = require('fs');
const net = require('net');
const { URL } = require('url');
const { WebSocketServer, WebSocket } = require('ws');
const sessionManager = require('../services/timesheetSessionManager');

const NOVNC_DIR = process.env.NOVNC_DIR || '/usr/share/novnc';
const router = express.Router();

function requireValidSession(req, res) {
  const id = req.params.id || req.query.id;
  const token = req.query.token || req.body?.token;

  if (!id || !token || !sessionManager.verifyToken(id, token)) {
    res.status(403).send('Invalid or unauthorized session token.');
    return null;
  }

  const session = sessionManager.getSession(id);
  if (!session) {
    res.status(404).send(`
      <html>
        <body style="background:#111827;color:#f3f4f6;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;text-align:center;padding:1rem;">
          <h2 style="color:#f59e0b;margin-bottom:0.5rem;">Session Expired or Closed</h2>
          <p style="color:#9ca3af;">This interactive timesheet browser session is no longer active. You can close this tab.</p>
        </body>
      </html>
    `);
    return null;
  }

  return session;
}

// Serve noVNC static assets (core/rfb.js, etc.)
if (fs.existsSync(NOVNC_DIR)) {
  router.use('/timesheet/novnc', express.static(NOVNC_DIR, { index: false }));
} else {
  console.warn(`[Timesheet Route] noVNC directory not found at ${NOVNC_DIR}. Interactive VNC iframe requires Docker/noVNC.`);
}

// 1. Main wrapper page with toolbar + live browser iframe
router.get('/timesheet/session', (req, res) => {
  const session = requireValidSession(req, res);
  if (!session) return;

  return res.render('timesheet-session', {
    session: sessionManager.getPublicState(session),
    token: req.query.token,
    hasCredentials: Boolean(session.credentials && (session.credentials.username || session.credentials.password))
  });
});

// 2. Iframe content: connects noVNC RFB client to our authenticated WebSocket proxy
router.get('/timesheet/vnc-frame', (req, res) => {
  const session = requireValidSession(req, res);
  if (!session) return;

  return res.render('timesheet-vnc-frame', {
    sessionId: session.id,
    token: req.query.token
  });
});

// 3. Status polling endpoint
router.get('/timesheet/session/:id/status', (req, res) => {
  const { id } = req.params;
  const { token } = req.query;

  if (!sessionManager.verifyToken(id, token)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const session = sessionManager.getSession(id);
  if (!session) {
    return res.status(404).json({ status: 'expired', vncActive: false, message: 'Session no longer exists.' });
  }

  return res.json(sessionManager.getPublicState(session));
});

// 4. Fill credentials helper (types username/password into login fields without submitting)
router.post('/timesheet/session/:id/fill-credentials', async (req, res) => {
  const { id } = req.params;
  const token = req.query.token || req.body?.token;

  if (!sessionManager.verifyToken(id, token)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const session = sessionManager.getSession(id);
  if (!session || session.status !== 'waiting' || !session.page) {
    return res.status(400).json({ error: 'Session is not waiting for input.' });
  }

  try {
    const creds = session.credentials || {};
    const filled = await session.page.evaluate((username, password) => {
      const setNativeValue = (el, value) => {
        const proto = Object.getPrototypeOf(el);
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor && descriptor.set) {
          descriptor.set.call(el, value);
        } else {
          el.value = value;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const passInput = document.querySelector('input[type="password"]');
      const userInputs = Array.from(document.querySelectorAll('input[type="text"], input[type="email"], input[name*="user" i], input[name*="email" i], input[name*="nip" i]'))
        .filter(el => el.offsetParent !== null);

      let didUser = false;
      let didPass = false;

      if (userInputs.length > 0 && username) {
        setNativeValue(userInputs[0], username);
        didUser = true;
      }
      if (passInput && password) {
        setNativeValue(passInput, password);
        didPass = true;
      }

      return { didUser, didPass };
    }, creds.username || '', creds.password || '');

    if (!filled.didUser && !filled.didPass) {
      return res.status(200).json({
        ok: false,
        message: 'No visible login inputs found on the current page yet.'
      });
    }

    return res.json({
      ok: true,
      message: 'Credentials filled. Complete any Cloudflare checkbox and click Login.'
    });
  } catch (err) {
    console.error('[Timesheet Route] Fill credentials error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// 5. Reload the current Puppeteer page
router.post('/timesheet/session/:id/reload', async (req, res) => {
  const { id } = req.params;
  const token = req.query.token || req.body?.token;

  if (!sessionManager.verifyToken(id, token)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const session = sessionManager.getSession(id);
  if (!session || session.status !== 'waiting' || !session.page) {
    return res.status(400).json({ error: 'Session is not active.' });
  }

  try {
    await session.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    return res.json({ ok: true, message: 'Page reloaded.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 6. Resume automation manually
router.post('/timesheet/session/:id/resume', (req, res) => {
  const { id } = req.params;
  const token = req.query.token || req.body?.token;

  if (!sessionManager.verifyToken(id, token)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const session = sessionManager.getSession(id);
  if (!session || session.status !== 'waiting') {
    return res.status(400).json({ error: 'Session is not waiting.' });
  }

  if (typeof session.onResume === 'function') {
    session.onResume();
  }
  return res.json({ ok: true, message: 'Checking portal status and resuming automation...' });
});

// 7. Cancel session
router.post('/timesheet/session/:id/cancel', (req, res) => {
  const { id } = req.params;
  const token = req.query.token || req.body?.token;

  if (!sessionManager.verifyToken(id, token)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const session = sessionManager.getSession(id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  if (typeof session.onCancel === 'function') {
    session.onCancel();
  }
  return res.json({ ok: true, message: 'Session cancelled.' });
});

/**
 * Attaches an HMAC-authenticated WebSocket <-> TCP proxy for noVNC onto the HTTP server.
 * Works over a single port behind reverse proxies (Nginx, Traefik, Caddy, Cloudflare Tunnel).
 */
function attachWebSocketProxy(server) {
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols(protocols) {
      if (protocols.has('binary')) return 'binary';
      return false;
    }
  });

  server.on('upgrade', (req, socket, head) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(req.url, 'http://localhost');
    } catch (_) {
      socket.destroy();
      return;
    }

    if (!parsedUrl.pathname.endsWith('/timesheet/vnc-ws')) {
      socket.destroy();
      return;
    }

    const id = parsedUrl.searchParams.get('id');
    const token = parsedUrl.searchParams.get('token');

    if (!sessionManager.verifyToken(id, token)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const session = sessionManager.getSession(id);
    if (!session || !session.vncActive || !session.vncPort) {
      socket.write('HTTP/1.1 410 Gone\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const tcp = net.createConnection({ host: '127.0.0.1', port: session.vncPort });

      // Keep WebSocket alive through reverse proxies (e.g., Nginx 60s idle timeout)
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, 25000);

      const cleanup = () => {
        clearInterval(pingInterval);
        if (!tcp.destroyed) tcp.destroy();
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };

      tcp.on('data', (chunk) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(chunk, { binary: true }, (err) => {
            if (err) cleanup();
          });
        }
      });

      tcp.on('end', cleanup);
      tcp.on('close', cleanup);
      tcp.on('error', (err) => {
        console.warn('[VNC Proxy] TCP error:', err.message);
        cleanup();
      });

      ws.on('message', (data) => {
        if (!tcp.destroyed) {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
          const ok = tcp.write(buf);
          if (!ok) {
            ws.pause();
            tcp.once('drain', () => ws.resume());
          }
        }
      });

      ws.on('close', cleanup);
      ws.on('error', cleanup);
    });
  });
}

module.exports = {
  router,
  attachWebSocketProxy
};
