const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const { getAuthenticatedClient } = require('../../services/googleAuth');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('backlog')
        .setDescription('View tasks without a due date or future tasks'),
    async execute(interaction) {
        await interaction.deferReply();

        try {
            const authClient = await getAuthenticatedClient(interaction.user.id);
            const service = google.tasks({ version: 'v1', auth: authClient });

            // List all incomplete tasks
            // Note: Google Tasks API filtering is limited. We fetch incomplete and filter manually.
            const response = await service.tasks.list({
                tasklist: '@default',
                showCompleted: false,
                maxResults: 100
            });

            const tasks = response.data.items || [];

            // Filter for tasks with NO due date (true backlog) or far future
            // Google API 'due' is RFC3339 timestamp string

            const backlogTasks = tasks.filter(t => !t.due);

            if (backlogTasks.length === 0) {
                return await interaction.editReply('📭 Backlog is empty!');
            }

            const embed = new EmbedBuilder()
                .setTitle(`🗃️ Backlog (${backlogTasks.length} items)`)
                .setDescription('Tasks with no specific due date.')
                .setColor(0x808080);

            const displayTasks = backlogTasks.slice(0, 15);
            const listStr = displayTasks.map(t => `• ${t.title}`).join('\n');

            embed.addFields({ name: 'Tasks', value: listStr || 'None' });

            if (backlogTasks.length > 15) {
                embed.setFooter({ text: `...and ${backlogTasks.length - 15} more items.` });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Backlog Command Error:', error);
            await interaction.editReply({ content: `❌ Error: ${error.message}` });
        }
    },
};
