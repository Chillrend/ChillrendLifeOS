const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../models/User');
const PlaneService = require('../../services/planeService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('comment')
        .setDescription('Adds a comment to a task.')
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
            const user = await User.findOne({ discordId: interaction.user.id });
            if (!user || !user.planeApiKey) {
                return;
            }

            const plane = new PlaneService(user.planeApiKey);
            const [tasks, states] = await Promise.all([
                plane.getTasks(),
                plane.getStates()
            ]);
            const doneStateId = states.find(s => s.name === 'Done')?.id;
            const activeTasks = tasks.filter(t => t.state !== doneStateId);

            await interaction.respond(
                activeTasks.map(task => ({ name: `[CHL-${task.sequence_id}] ${task.name}`, value: task.id })),
            );
        }
    },
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const user = await User.findOne({ discordId: interaction.user.id });
            if (!user || !user.planeApiKey) {
                return interaction.editReply('You need to link your Plane API key first! Use the `/link` command.');
            }

            const taskId = interaction.options.getString('task');
            const commentText = interaction.options.getString('comment');

            const plane = new PlaneService(user.planeApiKey);
            
            // Fetch the task first to get its name
            const task = await plane.getTask(taskId);
            if (!task) {
                return interaction.editReply('Could not find the specified task.');
            }

            const comment = await plane.addComment(taskId, commentText);

            const embed = new EmbedBuilder()
                .setTitle('💬 Comment Added')
                .setDescription(`Successfully added a comment to task **${task.name}**.`)
                .addFields({ name: 'Comment', value: comment.comment_html })
                .setColor(0x0099FF)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Comment Command Error:', error);
            await interaction.editReply({ content: `❌ An error occurred: ${error.message}` });
        }
    },
};
