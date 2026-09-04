const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const VikunjaService = require('../../services/vikunjaService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('backlog')
        .setDescription('View your active tasks from Vikunja (Todo/Backlog & In Progress)'),
    async execute(interaction) {
        await interaction.deferReply();

        try {
            const vikunja = new VikunjaService();

            // Fetch tasks for the project
            const tasks = await vikunja.getTasks();

            const backlogBucketId = parseInt(process.env.VIKUNJA_BUCKET_BACKLOG_ID, 10);
            const inProgressBucketId = parseInt(process.env.VIKUNJA_BUCKET_INPROGRESS_ID, 10);

            // Filter tasks by bucket (treat bucket_id: 0 / unassigned as Backlog/Todo as per Vikunja's UI default)
            const todoTasks = tasks.filter(t => (t.bucket_id === backlogBucketId || t.bucket_id === 0 || !t.bucket_id) && !t.done);
            const inProgressTasks = tasks.filter(t => t.bucket_id === inProgressBucketId && !t.done);

            if (todoTasks.length === 0 && inProgressTasks.length === 0) {
                return await interaction.editReply('🎉 No active tasks in your backlog!');
            }

            const embed = new EmbedBuilder()
                .setTitle('🗃️ Your Active Backlog')
                .setColor(0x808080);

            if (inProgressTasks.length > 0) {
                const listStr = inProgressTasks
                    .slice(0, 15)
                    .map(t => `• \`#${t.id}\` ${t.title}`)
                    .join('\n');
                embed.addFields({ name: `🚀 In Progress (${inProgressTasks.length})`, value: listStr });
            }

            if (todoTasks.length > 0) {
                const listStr = todoTasks
                    .slice(0, 15)
                    .map(t => `• \`#${t.id}\` ${t.title}`)
                    .join('\n');
                embed.addFields({ name: `📥 Todo / Backlog (${todoTasks.length})`, value: listStr });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Backlog Command Error:', error);
            await interaction.editReply({ content: `❌ Error: ${error.message}` });
        }
    },
};
