const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../models/User');
const PlaneService = require('../../services/planeService');
const { parseTodo } = require('../../services/geminiService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('todo')
        .setDescription('Add a new task to Plane using natural language')
        .addStringOption(option =>
            option.setName('task')
                .setDescription('The task description (e.g., "Fix server A now")')
                .setRequired(true)),
    async execute(interaction) {
        await interaction.deferReply();

        try {
            const rawInput = interaction.options.getString('task');
            const user = await User.findOne({ discordId: interaction.user.id });

            if (!user || !user.planeApiKey) {
                return interaction.editReply('You need to link your Plane API key first! Use the `/link` command.');
            }

            // 1. Parse the input with Gemini
            const taskDetails = await parseTodo(rawInput);
            if (!taskDetails) {
                return interaction.editReply('❌ Could not understand the task. Please try again with a clearer description.');
            }

            // 2. Create the task in Plane
            const plane = new PlaneService(user.planeApiKey);
            const createdTask = await plane.createTask(taskDetails);

            // 3. Respond to the user
            const embed = new EmbedBuilder()
                .setTitle('✅ Task Added to Plane')
                .addFields(
                    { name: 'Title', value: createdTask.name },
                    { name: 'Due', value: createdTask.target_date ? new Date(createdTask.target_date).toLocaleDateString() : 'No due date' },
                    { name: 'Notes', value: createdTask.description || 'None' }
                )
                .setColor(0x00FF00)
                .setFooter({ text: `Task ID: ${createdTask.id}` });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Todo Command Error:', error);
            await interaction.editReply({
                content: `❌ Error: ${error.message}. Make sure you have run /link.`
            });
        }
    },
};
