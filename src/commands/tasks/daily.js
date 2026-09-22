const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { generateDailyLog } = require('../../services/taskSummarizer');
const timesheetService = require('../../services/timesheetService');

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

            const embed = new EmbedBuilder()
                .setTitle(`✅ Daily Work Log for ${result.displayDate}${result.cached ? ' (Cached)' : ''}`)
                .setDescription(result.cached ? 'Here is your cached work log:' : 'Here is your structured summary (saved to local database):')
                .setColor(0x00FF00)
                .setFooter({ text: result.cached ? 'Retrieved from local database' : 'Cached in SQLite' });

            // Render structured JSON logs into the embed
            const tasks = result.log; // This is now an array of objects
            let logText = '';
            for (let i = 0; i < tasks.length; i++) {
                const t = tasks[i];
                const cleanDesc = t.description ? t.description.replace(/<[^>]*>/g, '').trim().substring(0, 100) : 'No description';
                logText += `**${i+1}. ${t.title}** (${t.statusName})\n*${cleanDesc}*\n\n`;
            }
            
            if (logText.length > 1024) logText = logText.substring(0, 1020) + '...';
            embed.addFields({ name: 'Tasks', value: logText || 'No specific tasks data parsed.' });

            await interaction.editReply({ embeds: [embed] });

            if (shouldSubmit) {
                const msg = await interaction.followUp('⏳ Submitting logs to the Kemdikbud portal via Puppeteer... Please wait.');
                const submitResult = await timesheetService.submitDailyLogs(tasks, result.targetDate);
                
                if (submitResult.success) {
                    await msg.edit(`✅ **Success:** ${submitResult.message}`);
                } else {
                    await msg.edit(`❌ **Failed:** ${submitResult.message}`);
                }
            }

        } catch (error) {
            console.error('Daily Command Error:', error);
            await interaction.editReply({ content: `❌ Error: ${error.message}` });
        }
    },
};
