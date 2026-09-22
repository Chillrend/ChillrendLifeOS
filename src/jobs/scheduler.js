const cron = require('node-cron');
const { generateDailyLog, generateWeeklyWrapup } = require('../services/taskSummarizer');
const timesheetService = require('../services/timesheetService');
const { EmbedBuilder } = require('discord.js');

module.exports = (client) => {
  const timezone = process.env.APP_TIMEZONE || 'Asia/Jakarta';
  const cronDaily = process.env.CRON_DAILY || '30 15 * * 1-5'; // default 15:30 Mon-Fri
  const cronWrapup = process.env.CRON_WRAPUP || '0 20 * * 5';   // default 20:00 Friday

  console.log(`[Scheduler] Initializing job scheduler in timezone: "${timezone}"`);
  console.log(`[Scheduler] Daily report scheduled: "${cronDaily}"`);
  console.log(`[Scheduler] Weekly wrap-up scheduled: "${cronWrapup}"`);

  // 1. Automated Daily Report (15:30 on weekdays)
  cron.schedule(cronDaily, async () => {
    console.log('[Scheduler] Running automated daily tasks summary...');
    try {
      const ownerId = process.env.OWNER_ID;
      if (!ownerId) {
        throw new Error('OWNER_ID is not configured.');
      }

      const owner = await client.users.fetch(ownerId);
      if (!owner) {
        throw new Error(`Could not fetch owner user with ID: ${ownerId}`);
      }

      // Generate daily log (null specifies today, ensuring real-time bypass of cache)
      const result = await generateDailyLog(null);

      if (result.noTasks) {
        console.log(`[Scheduler] No relevant tasks found for today (${result.displayDate}). Automated DM skipped.`);
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`📅 Automated Daily Work Log - ${result.displayDate}`)
        .setDescription('Here is your automated end-of-day structured timesheet log:')
        .setColor(0x00FF00)
        .setFooter({ text: 'Automated by LifeOS Scheduler' });

      const tasks = result.log;
      let logText = '';
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        const cleanDesc = t.description ? t.description.replace(/<[^>]*>/g, '').trim().substring(0, 100) : 'No description';
        logText += `**${i+1}. ${t.title}** (${t.statusName})\n*${cleanDesc}*\n\n`;
      }
      if (logText.length > 1024) logText = logText.substring(0, 1020) + '...';
      embed.addFields({ name: 'Tasks', value: logText || 'No tasks found.' });

      await owner.send({ embeds: [embed] });
      console.log('[Scheduler] Automated daily log sent to owner successfully.');

      // Auto-submit if configured
      if (process.env.TIMESHEET_AUTO_SUBMIT === 'true') {
        const submitMsg = await owner.send('⏳ Automatically submitting logs to the Kemdikbud portal...');
        const submitResult = await timesheetService.submitDailyLogs(tasks, result.targetDate);
        if (submitResult.success) {
          await submitMsg.edit(`✅ **Success:** ${submitResult.message}`);
        } else {
          await submitMsg.edit(`❌ **Failed:** ${submitResult.message}`);
        }
      }

    } catch (error) {
      console.error('[Scheduler Error] Daily report automation failed:', error.message);
    }
  }, {
    scheduled: true,
    timezone: timezone
  });

  // 2. Automated Weekly Wrap-up Retrospective & Cleanup (Friday 20:00)
  cron.schedule(cronWrapup, async () => {
    console.log('[Scheduler] Running automated weekly wrap-up retrospective...');
    try {
      const ownerId = process.env.OWNER_ID;
      if (!ownerId) {
        throw new Error('OWNER_ID is not configured.');
      }

      const owner = await client.users.fetch(ownerId);
      if (!owner) {
        throw new Error(`Could not fetch owner user with ID: ${ownerId}`);
      }

      const result = await generateWeeklyWrapup();

      const embed = new EmbedBuilder()
        .setTitle('📊 Automated Weekly Retrospective & Kanban Rollover')
        .setColor(0x00FF00)
        .setTimestamp()
        .setFooter({ text: 'Automated by LifeOS Scheduler' });

      if (result.noTasks) {
        embed.setDescription('📭 No tasks were marked completed in the last 7 days.');
      } else {
        embed.setDescription(result.summary.slice(0, 3500));
      }

      // Append standard rollover actions report
      embed.addFields({
        name: '🔄 Kanban Rollover & Board Cleanup',
        value: `• Extended **${result.extendedCount}** active task(s) to next Friday at 6:00 PM.\n• Cleared **${result.archivedCount}** completed task(s) from your active **Done** Kanban column (kept safely in lists).`
      });

      await owner.send({ embeds: [embed] });
      console.log('[Scheduler] Automated weekly wrap-up retrospective sent to owner successfully.');

    } catch (error) {
      console.error('[Scheduler Error] Weekly wrap-up retrospective automation failed:', error.message);
    }
  }, {
    scheduled: true,
    timezone: timezone
  });
};
