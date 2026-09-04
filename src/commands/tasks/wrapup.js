const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { generateWeeklyWrapup } = require('../../services/taskSummarizer');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wrapup')
        .setDescription('Runs weekly retrospective, extends active tasks, and clears the Done column.'),
    async execute(interaction) {
        await interaction.deferReply();

        try {
            const result = await generateWeeklyWrapup();

            const embed = new EmbedBuilder()
                .setTitle('📊 Weekly Retrospective & Kanban Rollover')
                .setColor(0x00FF00)
                .setTimestamp()
                .setFooter({ text: 'Automated weekly wrapup via Gemini' });

            if (result.noTasks) {
                embed.setDescription('📭 No tasks were marked completed in the last 7 days.');
            } else {
                embed.setDescription(result.summary.slice(0, 3500)); // Safely slice to prevent exceeding Discord limits
            }

            // Append standard rollover actions report
            embed.addFields({
                name: '🔄 Kanban Rollover & Board Cleanup',
                value: `• Extended **${result.extendedCount}** active task(s) to next Friday at 6:00 PM.\n• Cleared **${result.archivedCount}** completed task(s) from your active **Done** Kanban column (kept safely in lists).`
            });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Wrapup Command Error:', error);
            await interaction.editReply({ content: `❌ Error generating wrap-up: ${error.message}` });
        }
    },
};
