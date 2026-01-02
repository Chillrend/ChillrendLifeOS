const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../models/User');
const PlaneService = require('../../services/planeService');
const { refineTask } = require('../../services/geminiService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('todo')
        .setDescription('Add a new task to Plane, refined by AI')
        .addStringOption(option =>
            option.setName('title')
                .setDescription('The title of the task')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('description')
                .setDescription('A detailed description of the task')
                .setRequired(true)),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const initialTitle = interaction.options.getString('title');
            const initialDescription = interaction.options.getString('description');
            const user = await User.findOne({ discordId: interaction.user.id });

            if (!user || !user.planeApiKey) {
                return interaction.editReply('You need to link your Plane API key first! Use the `/link` command.');
            }

            const plane = new PlaneService(user.planeApiKey);

            // 1. Fetch available states and labels from Plane
            const [availableStates, availableLabels] = await Promise.all([
                plane.getStates(),
                plane.getLabels(),
            ]);

            if (!availableStates.length) {
                return interaction.editReply('Could not fetch task states from Plane. Please check the API key and configuration.');
            }

            // 2. Refine the task with Gemini
            const { title, notes, state, priority, labels, startDate } = await refineTask(initialTitle, initialDescription);

            // 3. Find the corresponding state and label IDs
            const stateId = availableStates.find(s => s.name === state)?.id;
            if (!stateId) {
                return interaction.editReply(`Could not find a matching state ID for "${state}". Please check the available states in your Plane project.`);
            }
            
            const labelIds = labels
                .map(labelName => availableLabels.find(l => l.name === labelName)?.id)
                .filter(id => id); // Filter out any undefined IDs

            // 4. Create the task in Plane
            const createdTask = await plane.createTask({
                title: title,
                notes: notes,
                stateId: stateId,
                priority: priority.toLowerCase(),
                labelIds: labelIds,
            });

            // 5. Respond to the user
            const embed = new EmbedBuilder()
                .setTitle('✅ Task Added & Refined')
                .setDescription('Your task has been intelligently refined and added to Plane.')
                .addFields(
                    { name: 'Title', value: createdTask.name },
                    { name: 'Notes', value: notes || 'None' },
                    { name: 'State', value: state, inline: true },
                    { name: 'Priority', value: priority || 'None', inline: true },
                    { name: 'Labels', value: labels.join(', ') || 'None', inline: true },
                    { name: 'Start Date', value: new Date().toISOString().split('T')[0], inline: true }
                )
                .setColor(0x00FF00)
                .setFooter({ text: `Task ID: ${createdTask.id}` });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Todo Command Error:', error);
            await interaction.editReply({
                content: `❌ An error occurred: ${error.message}. Please ensure your Plane API key is correct and you have run /link.`
            });
        }
    },
};
