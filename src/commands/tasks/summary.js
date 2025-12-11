const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const { getAuthenticatedClient } = require('../../services/googleAuth');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('summary')
        .setDescription('Get a summary of tasks due today or overdue'),
    async execute(interaction) {
        await interaction.deferReply();

        try {
            const authClient = await getAuthenticatedClient(interaction.user.id);
            const service = google.tasks({ version: 'v1', auth: authClient });

            // List tasks from default list
            const response = await service.tasks.list({
                tasklist: '@default',
                showCompleted: false,
                dueMax: new Date(new Date().setHours(23, 59, 59, 999)).toISOString() // End of today
            });

            const tasks = response.data.items || [];

            if (tasks.length === 0) {
                return await interaction.editReply('🎉 No tasks due today!');
            }

            const embed = new EmbedBuilder()
                .setTitle(`📅 Daily Summary (${tasks.length} tasks)`)
                .setColor(0xFFA500)
                .setTimestamp();

            // Limit fields to avoid Discord limits (25 fields)
            const displayTasks = tasks.slice(0, 20);

            displayTasks.forEach(task => {
                const dueText = task.due ? new Date(task.due).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Today';
                embed.addFields({
                    name: task.title,
                    value: `🕒 ${dueText}`,
                    inline: false
                });
            });

            if (tasks.length > 20) {
                embed.setFooter({ text: `...and ${tasks.length - 20} more tasks.` });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Summary Command Error:', error);
            await interaction.editReply({ content: `❌ Error: ${error.message}` });
        }
    },
};
