const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { generateDailyLog } = require('../../services/taskSummarizer');
const timesheetService = require('../../services/timesheetService');
const { buildDailyLogEmbeds } = require('../../utils/dailyLogEmbed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Generates a daily work log from Vikunja tasks on a specific date (and caches it in SQLite).')
        .addStringOption(option =>
            option.setName('date')
                .setDescription('The date to generate the log for (e.g., "yesterday", "last friday"). Defaults to today.')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('submit')
                .setDescription('Automatically submit this log to the Kemdikbud Timesheet portal.')
                .setRequired(false)),
    async execute(interaction) {
        await interaction.deferReply();

        try {
            const dateString = interaction.options.getString('date');
            const shouldSubmit = interaction.options.getBoolean('submit') || false;
            
            // Call the core summarizer service
            const result = await generateDailyLog(dateString);

            if (result.noTasks) {
                return await interaction.editReply(`No relevant completed or in-progress tasks found for ${result.displayDate} in Vikunja.`);
            }

            const tasks = result.log; // This is now an array of objects
            const embeds = buildDailyLogEmbeds({
                title: `✅ Daily Work Log for ${result.displayDate}${result.cached ? ' (Cached)' : ''}`,
                description: result.cached ? 'Here is your cached work log:' : 'Here is your structured summary (saved to local database):',
                footerText: result.cached ? 'Retrieved from local database' : 'Cached in SQLite',
                tasks
            });

            await interaction.editReply({ embeds: [embeds[0]] });
            for (let i = 1; i < embeds.length; i++) {
                await interaction.followUp({ embeds: [embeds[i]] });
            }

            
            if (shouldSubmit) {
                // Send an ephemeral followUp message so only the user sees it, and they can dismiss it
                const msg = await interaction.followUp({ content: '⏳ Submitting logs to the portal via Puppeteer... Please wait.', ephemeral: true });
                const submitResult = await timesheetService.submitDailyLogs(tasks, result.targetDate, {
                    onVerificationRequired: async ({ url, reason, expiresInSeconds }) => {
                        const mins = Math.max(1, Math.round(expiresInSeconds / 60));
                        const row = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setLabel('Open Live Browser')
                                .setStyle(ButtonStyle.Link)
                                .setURL(url)
                        );
                        await interaction.webhook.editMessage(msg.id, {
                            content: `🛡️ **Verification Required:** ${reason}\nOpen the live browser below to click Cloudflare / log in (expires in ~${mins} min). Automation will resume automatically.`,
                            components: [row]
                        });
                    }
                });
                
                if (submitResult.success) {
                    await interaction.webhook.editMessage(msg.id, { content: `✅ **Success:** ${submitResult.message}`, components: [] });
                } else {
                    await interaction.webhook.editMessage(msg.id, { content: `❌ **Failed:** ${submitResult.message}`, components: [] });
                }
            }


        } catch (error) {
            console.error('Daily Command Error:', error);
            await interaction.editReply({ content: `❌ Error: ${error.message}` });
        }
    },
};
