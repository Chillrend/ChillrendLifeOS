const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { mapTasksToSKP } = require('./geminiService');
const db = require('../db/database');

puppeteer.use(StealthPlugin());

class TimesheetService {
  constructor() {
    this.url = process.env.TIMESHEET_URL;
    this.username = process.env.TIMESHEET_USERNAME;
    this.password = process.env.TIMESHEET_PASSWORD;
    this.isHeadless = process.env.PUPPETEER_HEADLESS !== 'false';
  }

  async initBrowser() {
    const launchOptions = {
      headless: this.isHeadless,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800'],
      defaultViewport: { width: 1280, height: 800 }
    };

    if (!this.isHeadless) {
      // Add helpful debugging options when running locally
      launchOptions.devtools = true; // Opens devtools automatically
      launchOptions.slowMo = 50; // Slows down Puppeteer operations by 50ms so you can see what's happening
    }

    // Use Edge if running in WSL without headless and explicitly specified
    if (!this.isHeadless && process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    console.log(`[Timesheet] Launching browser (Headless: ${this.isHeadless})`);
    return await puppeteer.launch(launchOptions);
  }

  /**
   * Submits structured daily tasks to the Kemdikbud portal.
   * @param {Array<object>} tasks - The structured tasks.
   * @param {string} targetDate - 'YYYY-MM-DD'
   */
  async submitDailyLogs(tasks, targetDate) {
    if (!tasks || tasks.length === 0) {
      return { success: false, message: 'No tasks to submit.' };
    }

    let browser;
    let errorOccurred = false;
    try {
      browser = await this.initBrowser();
      const page = await browser.newPage();
      
      const userAgent = await page.evaluate(() => navigator.userAgent);
      console.log(`[Timesheet] Browser User-Agent: ${userAgent}`);
      
      console.log('[Timesheet] Navigating to portal...');
      const response = await page.goto(this.url, { waitUntil: 'networkidle2', timeout: 60000 });
      
      // 0. Cloudflare Detection
      const status = response.status();
      const pageTitle = await page.title();
      
      if (status === 403 || pageTitle.toLowerCase().includes('cloudflare') || pageTitle.toLowerCase().includes('just a moment')) {
          console.error(`[Timesheet] Cloudflare blocking detected. Status: ${status}, Title: ${pageTitle}`);
          return { 
            success: false, 
            message: 'Blocked by Cloudflare Challenge. Puppeteer stealth failed to bypass.' 
          };
      }

      // 1. Handle Login Flow
      const isLoginPage = await page.evaluate(() => {
        return document.querySelector('input[type="password"]') !== null;
      });

      if (isLoginPage) {
        console.log('[Timesheet] Login page detected, authenticating...');
        // Wait for username input, assuming a typical 'username' or standard text input near the password
        await page.waitForSelector('input[type="password"]');
        const textInputs = await page.$$('input[type="text"], input[type="email"]');
        if (textInputs.length > 0) {
          await textInputs[0].type(this.username);
        }
        await page.type('input[type="password"]', this.password);
        
        // Find submit button - generic heuristic
        const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
        if (submitBtn) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
            submitBtn.click()
          ]);
        } else {
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
            page.keyboard.press('Enter')
          ]);
        }
        console.log('[Timesheet] Authenticated.');
      } else {
        console.log('[Timesheet] Already authenticated or bypassed login.');
      }

      // Ensure we are on the calendar page before proceeding
      try {
        await page.waitForSelector('::-p-text(Tambah Log)', { timeout: 30000 });
      } catch (err) {
        console.log('[Timesheet] "Tambah Log" button not found. Might be stuck on a captcha or wrong page after login.');
        const currentUrl = page.url();
        const currentTitle = await page.title();
        
        if (currentTitle.toLowerCase().includes('cloudflare') || currentTitle.toLowerCase().includes('just a moment') || await page.$('#cf-challenge-running')) {
            return {
              success: false,
              message: 'Stuck on Cloudflare challenge AFTER login.'
            };
        }
        throw new Error(`Failed to find "Tambah Log" button. Current URL: ${currentUrl}, Title: ${currentTitle}`);
      }

      // 2. Discover SKP Options
      console.log('[Timesheet] Opening form to discover SKP options...');
      const [tambahBtn] = await page.$$('::-p-text(Tambah Log)');
      if (!tambahBtn) throw new Error('Could not find "Tambah Log" button.');
      
      // Let's capture the date that is auto-filled by the portal when the modal opens initially
      await tambahBtn.click();
      
      // Wait for modal and select input
      await page.waitForSelector('select', { visible: true, timeout: 10000 });
      await new Promise(r => setTimeout(r, 1000)); // Let the datepicker initialize

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
      
      // Close modal by clicking cancel or pressing escape (assuming standard bootstrap/custom modal)
      // Pressing Escape is generally safest
      await page.keyboard.press('Escape');
      // Sometimes Escape doesn't work if focus is weird, click the close button if it exists
      await page.evaluate(() => {
         const closeBtn = document.querySelector('.modal .close, [data-dismiss="modal"]');
         if (closeBtn) closeBtn.click();
      });
      await new Promise(r => setTimeout(r, 1000)); // Give it a sec to animate close

      // 3. AI Mapping Phase
      console.log('[Timesheet] Asking Gemini to map tasks to SKPs...');
      const mappedTasks = await mapTasksToSKP(tasks, skpOptions);
      console.log(`[Timesheet] AI Mapping complete. Result: ${JSON.stringify(mappedTasks)}`);

      // 4. Data Entry Loop
      let submittedCount = 0;

      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        // Find mapped SKP value or fallback to default
        const mapping = mappedTasks.find(m => m.taskTitle === task.title);
        const skpValue = mapping ? mapping.skpValue : (skpOptions.length > 0 ? skpOptions[0].value : null);
        
        console.log(`[Timesheet] Submitting task ${i+1}/${tasks.length}: "${task.title}" (SKP: ${skpValue})`);
        
        const [tambah] = await page.$$('::-p-text(Tambah Log)');
        await tambah.click();
        
        // Wait specifically for the activity text input and the textarea
        await page.waitForSelector('#create_aktivitas, #create_deskripsi', { visible: true, timeout: 10000 }).catch(() => {
          console.warn('[Timesheet] Could not find specific input fields (#create_aktivitas, #create_deskripsi)...');
        });
        
        // Small delay to ensure Select2 binds to the DOM
        await new Promise(r => setTimeout(r, 1000));

        // Fill Form
        await page.evaluate((title, desc, skp, defaultDate) => {
          // Identify the exact inputs by ID as provided by the user
          const activityInput = document.getElementById('create_aktivitas');
          if (activityInput) {
            activityInput.value = title;
            activityInput.dispatchEvent(new Event('input', { bubbles: true }));
          }

          const descTextarea = document.getElementById('create_deskripsi');
          if (descTextarea) {
            // Ensure description is never empty and meets minimum 10 chars constraint
            let finalDesc = desc && desc.trim() !== '' ? desc : title;
            if (finalDesc.length < 10) {
              finalDesc = finalDesc + " (Daily Log)"; // Pad it to ensure it hits 10 chars
            }
            
            // Summernote replaces the standard textarea. We must use its API if available.
            if (typeof window.jQuery !== 'undefined' && typeof window.jQuery(descTextarea).summernote === 'function') {
               window.jQuery(descTextarea).summernote('code', finalDesc);
            } else {
               // Fallback for standard textareas
               descTextarea.value = finalDesc;
               descTextarea.dispatchEvent(new Event('input', { bubbles: true }));
               
               // Manual DOM injection fallback if Summernote API isn't registered on that specific element yet
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
            
            // Crucial for Select2 to visually update and register the change!
            if (typeof window.jQuery !== 'undefined') {
              window.jQuery(skpSelect).trigger('change');
            }
          }

          // EXTREMELY IMPORTANT: Re-populate the datepicker just in case a stray click 
          // (or a library initialization bug) cleared it.
          // The form uses bootstrap-datepicker.
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
             
             // If bootstrap-datepicker is active, forcefully update it via jQuery
             if (typeof window.jQuery !== 'undefined') {
                window.jQuery('#create_tanggal').datepicker('update', dateStr);
             }
          }
        }, task.title, task.description ? task.description.replace(/<[^>]*>/g, '').trim() : '', skpValue, initialDateValue);

        // Click Simpan
        console.log(`[Timesheet] Attempting to click "Simpan" for task ${i+1}...`);
        const [simpanBtn] = await page.$$('::-p-text(Simpan)');
        if (simpanBtn) {
          await simpanBtn.click();
          console.log(`[Timesheet] "Simpan" clicked. Waiting for notification...`);
          // Wait for modal to close (or notification to appear)
          await new Promise(r => setTimeout(r, 3000)); 
          submittedCount++;
          console.log(`[Timesheet] Task ${i+1} completed successfully.`);
        } else {
          console.warn('[Timesheet] Could not find "Simpan" button.');
          await page.keyboard.press('Escape');
        }
      }

      // Mark as submitted in DB
      db.markDailyLogSubmitted(targetDate);

      return {
        success: true,
        message: `Successfully submitted ${submittedCount}/${tasks.length} logs to the Kemdikbud portal.`,
        submittedCount
      };

    } catch (error) {
      errorOccurred = true;
      console.error('[Timesheet] Error during submission:', error);
      
      // If we are debugging visually, keep the browser open for 60 seconds to inspect the error
      if (!this.isHeadless && browser) {
        console.log('[Timesheet] Leaving browser open for 60 seconds for debugging...');
        await new Promise(r => setTimeout(r, 60000));
      }

      return {
        success: false,
        message: `Failed to submit logs: ${error.message}`
      };
    } finally {
      if (browser && (this.isHeadless || !errorOccurred)) {
        console.log('[Timesheet] Closing browser...');
        await browser.close();
      } else if (browser && !this.isHeadless && errorOccurred) {
        console.log('[Timesheet] Browser left open due to error (Headless is false).');
      }
    }
  }
}

module.exports = new TimesheetService();