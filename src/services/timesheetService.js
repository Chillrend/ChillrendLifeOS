const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { mapTasksToSKP } = require('./geminiService');
const db = require('../db/database');
const vncDisplayService = require('./vncDisplayService');
const sessionManager = require('./timesheetSessionManager');

puppeteer.use(StealthPlugin());

const DEFAULT_SESSION_TIMEOUT_MS = parseInt(process.env.TIMESHEET_SESSION_TIMEOUT_MS || String(5 * 60 * 1000), 10);

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class TimesheetService {
  constructor() {
    this.url = process.env.TIMESHEET_URL;
    this.username = process.env.TIMESHEET_USERNAME;
    this.password = process.env.TIMESHEET_PASSWORD;
    this.isHeadless = process.env.PUPPETEER_HEADLESS !== 'false';
    this.useXvfb = process.env.TIMESHEET_USE_XVFB !== 'false';
    this.profileDir = process.env.CHROME_PROFILE_DIR
      ? path.resolve(process.env.CHROME_PROFILE_DIR)
      : path.resolve(__dirname, '../../data/chrome-profile');
    this.isRunning = false;
  }

  ensureCleanProfileDir() {
    fs.mkdirSync(this.profileDir, { recursive: true });
    // Remove stale Chromium singleton locks left over from a prior crash/container kill
    for (const lockName of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
      const lockPath = path.join(this.profileDir, lockName);
      try {
        if (fs.existsSync(lockPath) || fs.lstatSync(lockPath)) {
          fs.unlinkSync(lockPath);
        }
      } catch (_) {
        // Ignore if file doesn't exist
      }
    }
  }

  async initBrowser() {
    this.ensureCleanProfileDir();

    const xvfbAvailable = this.useXvfb && vncDisplayService.isSupported();
    const launchEnv = { ...process.env };
    let headlessMode = this.isHeadless;

    if (xvfbAvailable) {
      const display = await vncDisplayService.startDisplay();
      launchEnv.DISPLAY = display;
      headlessMode = false; // Real headful Chrome on Xvfb for Cloudflare compatibility & noVNC viewing
    }

    const launchOptions = {
      headless: headlessMode,
      userDataDir: this.profileDir,
      env: launchEnv,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-position=0,0',
        '--window-size=1280,800',
        '--no-first-run',
        '--no-default-browser-check',
        '--hide-crash-restore-bubble',
        '--disable-infobars',
        '--disable-blink-features=AutomationControlled'
      ],
      defaultViewport: null
    };

    if (!headlessMode && !xvfbAvailable) {
      // Local desktop debugging options (outside Xvfb)
      launchOptions.devtools = true;
      launchOptions.slowMo = 50;
    }

    // Use Edge if running in WSL without headless and explicitly specified
    if (!headlessMode && !xvfbAvailable && process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    console.log(`[Timesheet] Launching browser (Headless: ${headlessMode}, Xvfb: ${xvfbAvailable}, Profile: ${this.profileDir})`);
    const browser = await puppeteer.launch(launchOptions);
    return { browser, xvfbAvailable, headlessMode };
  }

  async isAuthenticatedPortal(page) {
    try {
      const matches = await page.$$('::-p-text(Tambah Log)');
      return matches.length > 0;
    } catch (_) {
      return false;
    }
  }

  async hasCloudflareChallenge(page, response = null) {
    try {
      if (response) {
        const status = response.status();
        if (status === 403 || status === 503) {
          const title = (await page.title()).toLowerCase();
          if (title.includes('just a moment') || title.includes('cloudflare') || title.includes('attention required')) {
            return true;
          }
        }
      }

      const title = (await page.title()).toLowerCase();
      if (title.includes('just a moment') || title.includes('cloudflare') || title.includes('attention required')) {
        return true;
      }

      return await page.evaluate(() => {
        const selectors = [
          '#cf-challenge-running',
          '#challenge-running',
          '#challenge-stage',
          '.cf-turnstile',
          'input[name="cf-turnstile-response"]',
          'iframe[src*="challenges.cloudflare.com"]',
          'iframe[title*="cloudflare" i]'
        ];
        return selectors.some(sel => document.querySelector(sel) !== null);
      });
    } catch (_) {
      return false;
    }
  }

  async isLoginPage(page) {
    try {
      return await page.evaluate(() => document.querySelector('input[type="password"]') !== null);
    } catch (_) {
      return false;
    }
  }

  async prefillLoginFields(page) {
    if (!this.username && !this.password) return false;
    try {
      const result = await page.evaluate((username, password) => {
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
        const userInputs = Array.from(
          document.querySelectorAll('input[type="text"], input[type="email"], input[name*="user" i], input[name*="email" i], input[name*="nip" i]')
        ).filter(el => el.offsetParent !== null);

        let filledAny = false;
        if (userInputs.length > 0 && username && !userInputs[0].value) {
          setNativeValue(userInputs[0], username);
          filledAny = true;
        }
        if (passInput && password && !passInput.value) {
          setNativeValue(passInput, password);
          filledAny = true;
        }
        return filledAny;
      }, this.username || '', this.password || '');

      if (result) {
        console.log('[Timesheet] Auto-prefilled login credentials.');
      }
      return result;
    } catch (_) {
      return false;
    }
  }

  async focusPortalTab(browser, activePage) {
    try {
      const pages = await browser.pages();
      for (const p of pages) {
        if (p !== activePage) {
          await p.close().catch(() => {});
        }
      }
      await activePage.bringToFront().catch(() => {});
    } catch (_) {}
  }

  async performAutomatedLogin(page) {
    console.log('[Timesheet] Login page detected (no Cloudflare widget found), authenticating...');
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    const textInputs = await page.$$('input[type="text"], input[type="email"]');
    if (textInputs.length > 0 && this.username) {
      await textInputs[0].click({ clickCount: 3 });
      await textInputs[0].type(this.username);
    }
    if (this.password) {
      await page.click('input[type="password"]', { clickCount: 3 });
      await page.type('input[type="password"]', this.password);
    }

    const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
    if (submitBtn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
        submitBtn.click()
      ]);
    } else {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
        page.keyboard.press('Enter')
      ]);
    }
    await wait(2000);
  }

  /**
   * Starts an interactive noVNC session so the user can manually complete
   * Cloudflare / login verification in the live server-side browser.
   */
  async waitForHumanVerification({ browser, page, targetDate, reason, xvfbAvailable, headlessMode, onVerificationRequired }) {
    const timeoutMs = DEFAULT_SESSION_TIMEOUT_MS;

    // Make sure the portal tab is the only tab and focused front-and-center
    if (browser) {
      await this.focusPortalTab(browser, page);
    } else {
      await page.bringToFront().catch(() => {});
    }

    if (!xvfbAvailable) {
      if (!headlessMode) {
        console.log(`[Timesheet] Waiting up to ${Math.round(timeoutMs / 1000)}s for manual verification in local browser...`);
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (await this.isAuthenticatedPortal(page)) {
            return { sessionId: null };
          }
          await wait(1500);
        }
        throw new Error('Timed out waiting for manual verification in local browser.');
      }
      throw new Error(`${reason} (Interactive VNC requires Xvfb + x11vnc inside Docker).`);
    }

    const vncPort = await vncDisplayService.startVnc();
    let resumeRequested = false;
    let cancelled = false;
    let prefilledUrl = null;
    let autoLoginAttemptedUrl = null;

    // Pre-fill username/password immediately if a login form is already visible alongside Cloudflare
    if (await this.isLoginPage(page)) {
      const filled = await this.prefillLoginFields(page);
      if (filled) {
        prefilledUrl = page.url();
      }
    }

    const session = sessionManager.createSession({
      targetDate,
      reason,
      vncPort,
      timeoutMs,
      page,
      credentials: {
        username: this.username,
        password: this.password
      },
      onResume: () => {
        resumeRequested = true;
      },
      onCancel: () => {
        cancelled = true;
      }
    });

    if (prefilledUrl) {
      sessionManager.updateSession(session.id, {
        message: 'Login credentials pre-filled. Click the Cloudflare checkbox and click Login.'
      });
    }

    const sessionUrl = sessionManager.buildSessionUrl(session);
    const expiresInSeconds = Math.round(timeoutMs / 1000);

    console.log(`[Timesheet] Interactive verification required (${reason}). URL: ${sessionUrl}`);

    if (typeof onVerificationRequired === 'function') {
      try {
        await onVerificationRequired({
          url: sessionUrl,
          reason,
          expiresInSeconds,
          sessionId: session.id
        });
      } catch (notifyErr) {
        console.error('[Timesheet] Failed to send verification notification:', notifyErr.message);
      }
    }

    while (Date.now() < session.expiresAt) {
      if (cancelled) {
        sessionManager.closeSession(session.id, 'cancelled', 'Verification cancelled by user.');
        await vncDisplayService.stopVnc();
        const err = new Error('Timesheet verification was cancelled.');
        err.isCancelled = true;
        throw err;
      }

      if (await this.isAuthenticatedPortal(page)) {
        console.log('[Timesheet] Authenticated portal detected ("Tambah Log"). Resuming automation...');
        sessionManager.updateSession(session.id, {
          status: 'submitting',
          message: 'Authenticated! Mapping tasks and submitting daily logs...'
        });
        return { sessionId: session.id };
      }

      // Automatically help on login forms once Cloudflare interstitial redirects (or on embedded Turnstile)
      if (await this.isLoginPage(page)) {
        const currentUrl = page.url();
        const cfActive = await this.hasCloudflareChallenge(page);

        if (!cfActive && autoLoginAttemptedUrl !== currentUrl) {
          autoLoginAttemptedUrl = currentUrl;
          sessionManager.updateSession(session.id, {
            message: 'Cloudflare cleared — logging in automatically...'
          });
          await this.performAutomatedLogin(page);
          continue;
        }

        if (cfActive && prefilledUrl !== currentUrl) {
          const filled = await this.prefillLoginFields(page);
          if (filled) {
            prefilledUrl = currentUrl;
            sessionManager.updateSession(session.id, {
              message: 'Login credentials pre-filled. Click the Cloudflare checkbox and click Login.'
            });
          }
        }
      }

      if (resumeRequested) {
        resumeRequested = false;
        const cfActive = await this.hasCloudflareChallenge(page);
        if (cfActive) {
          sessionManager.updateSession(session.id, {
            message: 'Cloudflare challenge is still active on the page. Please complete it in the browser above first.'
          });
        } else if (await this.isLoginPage(page)) {
          sessionManager.updateSession(session.id, {
            message: 'Cloudflare cleared — attempting login...'
          });
          await this.performAutomatedLogin(page);
          if (await this.isAuthenticatedPortal(page)) {
            sessionManager.updateSession(session.id, {
              status: 'submitting',
              message: 'Authenticated! Mapping tasks and submitting daily logs...'
            });
            return { sessionId: session.id };
          }
          sessionManager.updateSession(session.id, {
            message: 'Still waiting for portal calendar ("Tambah Log"). Complete login in the browser above.'
          });
        } else {
          sessionManager.updateSession(session.id, {
            message: 'Portal calendar ("Tambah Log") not visible yet. Finish navigating/logging in, then click Resume.'
          });
        }
      }

      await wait(1500);
    }

    sessionManager.closeSession(session.id, 'expired', 'Timed out waiting for Cloudflare/login verification.');
    await vncDisplayService.stopVnc();
    throw new Error('Timed out waiting for human verification.');
  }

  /**
   * Submits structured daily tasks to the Kemdikbud portal.
   * @param {Array<object>} tasks - The structured tasks.
   * @param {string} targetDate - 'YYYY-MM-DD'
   * @param {object} [options]
   * @param {Function} [options.onVerificationRequired] - Called with { url, reason, expiresInSeconds, sessionId }
   */
  async submitDailyLogs(tasks, targetDate, options = {}) {
    if (!tasks || tasks.length === 0) {
      return { success: false, message: 'No tasks to submit.' };
    }

    if (this.isRunning) {
      return {
        success: false,
        message: 'A timesheet submission session is already in progress. Please finish or cancel it first.'
      };
    }

    this.isRunning = true;
    let browser;
    let xvfbAvailable = false;
    let headlessMode = this.isHeadless;
    let activeSessionId = null;
    let errorOccurred = false;

    try {
      const initResult = await this.initBrowser();
      browser = initResult.browser;
      xvfbAvailable = initResult.xvfbAvailable;
      headlessMode = initResult.headlessMode;

      const existingPages = await browser.pages();
      const page = existingPages.length > 0 ? existingPages[0] : await browser.newPage();
      await this.focusPortalTab(browser, page);

      const userAgent = await page.evaluate(() => navigator.userAgent);
      console.log(`[Timesheet] Browser User-Agent: ${userAgent}`);

      console.log('[Timesheet] Navigating to portal...');
      const response = await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForNetworkIdle({ idleTime: 1000, timeout: 8000 }).catch(() => {});

      // 1. Check whether persistent session is already logged in
      if (await this.isAuthenticatedPortal(page)) {
        console.log('[Timesheet] Persistent browser session is already authenticated!');
      } else {
        const cfDetected = await this.hasCloudflareChallenge(page, response);
        const loginDetected = await this.isLoginPage(page);

        if (cfDetected) {
          const handoff = await this.waitForHumanVerification({
            browser,
            page,
            targetDate,
            reason: 'Cloudflare challenge detected on the portal.',
            xvfbAvailable,
            headlessMode,
            onVerificationRequired: options.onVerificationRequired
          });
          activeSessionId = handoff.sessionId;
        } else if (loginDetected) {
          await this.performAutomatedLogin(page);
          if (!(await this.isAuthenticatedPortal(page))) {
            const postLoginCf = await this.hasCloudflareChallenge(page);
            const handoff = await this.waitForHumanVerification({
              browser,
              page,
              targetDate,
              reason: postLoginCf
                ? 'Cloudflare challenge appeared after login.'
                : 'Manual login / verification required to reach the portal.',
              xvfbAvailable,
              headlessMode,
              onVerificationRequired: options.onVerificationRequired
            });
            activeSessionId = handoff.sessionId;
          }
        } else {
          // Unknown intermediate screen (SSO, redirect, or delayed CF challenge)
          const handoff = await this.waitForHumanVerification({
            browser,
            page,
            targetDate,
            reason: 'Portal requires manual verification or login.',
            xvfbAvailable,
            headlessMode,
            onVerificationRequired: options.onVerificationRequired
          });
          activeSessionId = handoff.sessionId;
        }
      }

      // Ensure we are on the calendar page before proceeding
      await page.waitForSelector('::-p-text(Tambah Log)', { timeout: 30000 });

      // 2. Discover SKP Options
      console.log('[Timesheet] Opening form to discover SKP options...');
      const [tambahBtn] = await page.$$('::-p-text(Tambah Log)');
      if (!tambahBtn) throw new Error('Could not find "Tambah Log" button.');

      await tambahBtn.click();

      // Wait for modal and select input
      await page.waitForSelector('select', { visible: true, timeout: 10000 });
      await wait(1000); // Let the datepicker initialize

      const initialDateValue = await page.evaluate(() => {
        const dateInput = document.getElementById('create_tanggal');
        return dateInput ? dateInput.value : null;
      });
      console.log(`[Timesheet] Captured auto-filled date from portal: ${initialDateValue}`);

      // Extract options from the SKP select element
      const skpOptions = await page.evaluate(() => {
        const select = document.getElementById('create_indikator');
        if (select) {
          return Array.from(select.options)
            .filter(o => o.value && o.value.trim() !== '')
            .map(o => ({ value: o.value, label: o.textContent.trim() }));
        }
        return [];
      });

      console.log(`[Timesheet] Discovered ${skpOptions.length} SKP options.`);

      // Close modal
      await page.keyboard.press('Escape');
      await page.evaluate(() => {
        const closeBtn = document.querySelector('.modal .close, [data-dismiss="modal"]');
        if (closeBtn) closeBtn.click();
      });
      await wait(1000);

      // 3. AI Mapping Phase
      console.log('[Timesheet] Asking Gemini to map tasks to SKPs...');
      if (activeSessionId) {
        sessionManager.updateSession(activeSessionId, {
          message: `Mapping ${tasks.length} task(s) to SKP indicators with Gemini...`
        });
      }
      const mappedTasks = await mapTasksToSKP(tasks, skpOptions);
      console.log(`[Timesheet] AI Mapping complete. Result: ${JSON.stringify(mappedTasks)}`);

      // 4. Data Entry Loop
      let submittedCount = 0;

      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        const mapping = mappedTasks.find(m => m.taskTitle === task.title);
        const skpValue = mapping ? mapping.skpValue : (skpOptions.length > 0 ? skpOptions[0].value : null);

        console.log(`[Timesheet] Submitting task ${i + 1}/${tasks.length}: "${task.title}" (SKP: ${skpValue})`);
        if (activeSessionId) {
          sessionManager.updateSession(activeSessionId, {
            message: `Submitting task ${i + 1}/${tasks.length}: ${task.title}`
          });
        }

        const [tambah] = await page.$$('::-p-text(Tambah Log)');
        await tambah.click();

        await page.waitForSelector('#create_aktivitas, #create_deskripsi', { visible: true, timeout: 10000 }).catch(() => {
          console.warn('[Timesheet] Could not find specific input fields (#create_aktivitas, #create_deskripsi)...');
        });

        await wait(1000);

        await page.evaluate((title, desc, skp, defaultDate) => {
          const activityInput = document.getElementById('create_aktivitas');
          if (activityInput) {
            activityInput.value = title;
            activityInput.dispatchEvent(new Event('input', { bubbles: true }));
          }

          const descTextarea = document.getElementById('create_deskripsi');
          if (descTextarea) {
            let finalDesc = desc && desc.trim() !== '' ? desc : title;
            if (finalDesc.length < 10) {
              finalDesc = finalDesc + ' (Daily Log)';
            }

            if (typeof window.jQuery !== 'undefined' && typeof window.jQuery(descTextarea).summernote === 'function') {
              window.jQuery(descTextarea).summernote('code', finalDesc);
            } else {
              descTextarea.value = finalDesc;
              descTextarea.dispatchEvent(new Event('input', { bubbles: true }));
              const summernoteEditable = document.querySelector('.note-editable');
              if (summernoteEditable) {
                summernoteEditable.innerHTML = `<p>${finalDesc}</p>`;
              }
            }
          }

          const skpSelect = document.getElementById('create_indikator');
          if (skpSelect && skp) {
            skpSelect.value = skp;
            skpSelect.dispatchEvent(new Event('change', { bubbles: true }));
            if (typeof window.jQuery !== 'undefined') {
              window.jQuery(skpSelect).trigger('change');
            }
          }

          const dateInput = document.getElementById('create_tanggal');
          if (dateInput) {
            let dateStr = defaultDate;
            if (!dateStr) {
              const today = new Date();
              const dd = String(today.getDate()).padStart(2, '0');
              const mm = String(today.getMonth() + 1).padStart(2, '0');
              const yyyy = today.getFullYear();
              dateStr = `${dd}-${mm}-${yyyy}`;
            }

            dateInput.value = dateStr;
            dateInput.dispatchEvent(new Event('input', { bubbles: true }));
            dateInput.dispatchEvent(new Event('change', { bubbles: true }));

            if (typeof window.jQuery !== 'undefined') {
              window.jQuery('#create_tanggal').datepicker('update', dateStr);
            }
          }
        }, task.title, task.description ? task.description.replace(/<[^>]*>/g, '').trim() : '', skpValue, initialDateValue);

        console.log(`[Timesheet] Attempting to click "Simpan" for task ${i + 1}...`);
        const [simpanBtn] = await page.$$('::-p-text(Simpan)');
        if (simpanBtn) {
          await simpanBtn.click();
          console.log('[Timesheet] "Simpan" clicked. Waiting for notification...');
          await wait(3000);
          submittedCount++;
          console.log(`[Timesheet] Task ${i + 1} completed successfully.`);
        } else {
          console.warn('[Timesheet] Could not find "Simpan" button.');
          await page.keyboard.press('Escape');
        }
      }

      db.markDailyLogSubmitted(targetDate);

      const successMessage = `Successfully submitted ${submittedCount}/${tasks.length} logs to the Kemdikbud portal.`;
      if (activeSessionId) {
        sessionManager.closeSession(activeSessionId, 'completed', successMessage);
      }

      return {
        success: true,
        message: successMessage,
        submittedCount
      };
    } catch (error) {
      errorOccurred = true;
      console.error('[Timesheet] Error during submission:', error);

      if (activeSessionId) {
        const current = sessionManager.getSession(activeSessionId);
        if (current && ['waiting', 'submitting'].includes(current.status)) {
          sessionManager.closeSession(
            activeSessionId,
            error.isCancelled ? 'cancelled' : 'failed',
            error.message
          );
        }
      }

      if (!headlessMode && !xvfbAvailable && browser) {
        console.log('[Timesheet] Leaving local browser open for 60 seconds for debugging...');
        await wait(60000);
      }

      return {
        success: false,
        message: `Failed to submit logs: ${error.message}`
      };
    } finally {
      if (browser && (headlessMode || xvfbAvailable || !errorOccurred)) {
        console.log('[Timesheet] Closing browser...');
        await browser.close().catch(() => {});
      }
      if (xvfbAvailable) {
        await vncDisplayService.stopAll().catch(() => {});
      }
      this.isRunning = false;
    }
  }
}

module.exports = new TimesheetService();
