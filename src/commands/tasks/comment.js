const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const VikunjaService = require('../../services/vikunjaService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('comment')
        .setDescription('Adds a comment to a Vikunja task.')
        .addStringOption(option =>
            option.setName('task')
                .setDescription('The task to comment on.')
                .setRequired(true)
                .setAutocomplete(true))
        .addStringOption(option =>
            option.setName('comment')
                .setDescription('The content of the comment.')
                .setRequired(true)),
    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        if (focusedOption.name === 'task') {
            try {
                const vikunja = new VikunjaService();
                const tasks = await vikunja.getTasks();
                const activeTasks = tasks.filter(t => !t.done);

                const query = focusedOption.value.toLowerCase();
                const filtered = activeTasks
                    .filter(t => t.title.toLowerCase().includes(query))
                    .slice(0, 25);

                await interaction.respond(
                    filtered.map(task => ({ name: `[#${task.id}] ${task.title.slice(0, 80)}`, value: String(task.id) })),
                );
            } catch (err) {
                console.error('Autocomplete task error:', err);
                await interaction.respond([]);
            }
        }
    },
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const taskId = interaction.options.getString('task');
            const commentText = interaction.options.getString('comment');

            const vikunja = new VikunjaService();
            
            // Fetch the task first to get its name
            const task = await vikunja.getTask(taskId);
            if (!task) {
                return interaction.editReply('Could not find the specified task.');
            }

            await vikunja.addComment(taskId, commentText);

            const embed = new EmbedBuilder()
                .setTitle('💬 Comment Added')
                .setDescription(`Successfully added a comment to task **${task.title}**.`)
                .addFields({ name: 'Comment', value: commentText })
                .setColor(0x0099FF)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Comment Command Error:', error);
            await interaction.editReply({ content: `❌ An error occurred: ${error.message}` });
        }
    },
};
