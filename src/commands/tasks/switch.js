const { SlashCommandBuilder } = require('discord.js');
const User = require('../../models/User');
const PlaneService = require('../../services/planeService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('switch')
        .setDescription('Switches a task to the specified state.')
        .addStringOption(option =>
            option.setName('task')
                .setDescription('The task to switch.')
                .setRequired(true)
                .setAutocomplete(true))
        .addStringOption(option =>
            option.setName('state')
                .setDescription('The state to switch the task to.')
                .setRequired(true)
                .setAutocomplete(true)),
    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        const user = await User.findOne({ discordId: interaction.user.id });
        if (!user || !user.planeApiKey) {
            return;
        }

        const plane = new PlaneService(user.planeApiKey);

        if (focusedOption.name === 'task') {
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

        if (focusedOption.name === 'state') {
            const states = await plane.getStates();
            await interaction.respond(
                states.map(state => ({ name: state.name, value: state.id })),
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
            const stateId = interaction.options.getString('state');

            const plane = new PlaneService(user.planeApiKey);
            await plane.updateTaskState(taskId, stateId);

            await interaction.editReply('Task state updated successfully!');
        } catch (error) {
            console.error('Switch Command Error:', error);
            await interaction.editReply({ content: `❌ An error occurred: ${error.message}` });
        }
    },
};
