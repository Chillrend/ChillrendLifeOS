const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');

const DEFAULT_DISPLAY = process.env.VNC_DISPLAY || ':99';
const DEFAULT_VNC_PORT = parseInt(process.env.VNC_PORT || '5900', 10);
const DEFAULT_RESOLUTION = process.env.VNC_RESOLUTION || '1280x800x24';

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function commandExists(cmd) {
  const pathDirs = (process.env.PATH || '').split(':');
  for (const dir of pathDirs) {
    if (!dir) continue;
    const full = `${dir}/${cmd}`;
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return true;
    } catch (_) {
      // keep searching
    }
  }
  return false;
}

function waitForFile(filePath, timeoutMs = 5000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (fs.existsSync(filePath)) return resolve();
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Timed out waiting for ${filePath}`));
      }
      setTimeout(check, 100);
    };
    check();
  });
}

function waitForTcpPort(port, host = '127.0.0.1', timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ port, host });
      socket.once('connect', () => {
        socket.end();
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`Timed out waiting for ${host}:${port}`));
        }
        setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}

function killProcessGracefully(proc, name) {
  return new Promise(resolve => {
    if (!proc || proc.killed || proc.exitCode !== null) {
      return resolve();
    }

    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch (_) {}
      resolve();
    }, 3000);

    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });

    try {
      proc.kill('SIGTERM');
    } catch (err) {
      console.warn(`[VNC] Failed to stop ${name}:`, err.message);
      clearTimeout(timer);
      resolve();
    }
  });
}

class VncDisplayService {
  constructor() {
    this.display = DEFAULT_DISPLAY;
    this.vncPort = DEFAULT_VNC_PORT;
    this.resolution = DEFAULT_RESOLUTION;
    this.xvfbProc = null;
    this.wmProc = null;
    this.x11vncProc = null;
  }

  isSupported() {
    return process.platform === 'linux' && commandExists('Xvfb') && commandExists('x11vnc');
  }

  getDisplayNum() {
    return this.display.replace(/^:/, '').split('.')[0] || '99';
  }

  async startDisplay() {
    if (this.xvfbProc && this.xvfbProc.exitCode === null) {
      return this.display;
    }

    const displayNum = this.getDisplayNum();
    const lockFile = `/tmp/.X${displayNum}-lock`;
    const socketFile = `/tmp/.X11-unix/X${displayNum}`;

    // Clean up stale lock/socket if a previous container run crashed
    for (const f of [lockFile, socketFile]) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch (_) {}
    }

    console.log(`[VNC] Starting Xvfb on ${this.display} (${this.resolution})...`);
    this.xvfbProc = spawn(
      'Xvfb',
      [this.display, '-screen', '0', this.resolution, '-ac', '+extension', 'GLX', '+render', '-noreset'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    this.xvfbProc.stderr.on('data', d => {
      const msg = d.toString().trim();
      if (msg && !msg.includes('xkbcomp')) {
        console.log(`[Xvfb] ${msg}`);
      }
    });

    this.xvfbProc.once('exit', (code, signal) => {
      console.log(`[Xvfb] Exited (code=${code}, signal=${signal})`);
      this.xvfbProc = null;
    });

    await waitForFile(socketFile, 6000);

    // Optional lightweight window manager so Chrome fills the screen and dialogs behave properly
    if (commandExists('fluxbox')) {
      this.wmProc = spawn('fluxbox', [], {
        env: { ...process.env, DISPLAY: this.display },
        stdio: 'ignore'
      });
      this.wmProc.once('exit', () => {
        this.wmProc = null;
      });
      await wait(300);
    }

    return this.display;
  }

  async startVnc() {
    if (this.x11vncProc && this.x11vncProc.exitCode === null) {
      return this.vncPort;
    }

    await this.startDisplay();

    console.log(`[VNC] Starting x11vnc on 127.0.0.1:${this.vncPort} for display ${this.display}...`);
    this.x11vncProc = spawn(
      'x11vnc',
      [
        '-display', this.display,
        '-rfbport', String(this.vncPort),
        '-localhost',
        '-nopw',
        '-forever',
        '-shared',
        '-noxdamage',
        '-xkb',
        '-wait', '10',
        '-defer', '10'
      ],
      {
        env: { ...process.env, DISPLAY: this.display },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    this.x11vncProc.stderr.on('data', d => {
      const msg = d.toString().trim();
      if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('failed')) {
        console.warn(`[x11vnc] ${msg}`);
      }
    });

    this.x11vncProc.once('exit', (code, signal) => {
      console.log(`[x11vnc] Exited (code=${code}, signal=${signal})`);
      this.x11vncProc = null;
    });

    await waitForTcpPort(this.vncPort, '127.0.0.1', 8000);
    console.log(`[VNC] x11vnc is listening on 127.0.0.1:${this.vncPort}`);
    return this.vncPort;
  }

  async stopVnc() {
    if (this.x11vncProc) {
      console.log('[VNC] Stopping x11vnc...');
      await killProcessGracefully(this.x11vncProc, 'x11vnc');
      this.x11vncProc = null;
    }
  }

  async stopAll() {
    await this.stopVnc();
    if (this.wmProc) {
      await killProcessGracefully(this.wmProc, 'fluxbox');
      this.wmProc = null;
    }
    if (this.xvfbProc) {
      console.log('[VNC] Stopping Xvfb...');
      await killProcessGracefully(this.xvfbProc, 'Xvfb');
      this.xvfbProc = null;
    }
  }
}

const instance = new VncDisplayService();

process.once('SIGINT', () => { instance.stopAll().catch(() => {}); });
process.once('SIGTERM', () => { instance.stopAll().catch(() => {}); });

module.exports = instance;
