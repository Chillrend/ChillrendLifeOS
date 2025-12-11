const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const { getAuthenticatedClient } = require('../../services/googleAuth');
const { parseTodo } = require('../../services/geminiService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('todo')
        .setDescription('Add a new task to user Default List')
        .addStringOption(option =>
            option.setName('task')
                .setDescription('The task description (e.g. "Buy milk tomorrow")')
                .setRequired(true)),
    async execute(interaction) {
        await interaction.deferReply();

        try {
            const rawInput = interaction.options.getString('task');

            // 1. Authenticate
            const authClient = await getAuthenticatedClient(interaction.user.id);
            const service = google.tasks({ version: 'v1', auth: authClient });

            // 2. Parse with AI
            const taskDetails = await parseTodo(rawInput);

            // 3. Insert into Default List ('@default')
            const response = await service.tasks.insert({
                tasklist: '@default',
                requestBody: {
                    title: taskDetails.title,
                    notes: taskDetails.notes,
                    due: taskDetails.due
                }
            });

            const task = response.data;

            const embed = new EmbedBuilder()
                .setTitle('✅ Task Added')
                .addFields(
                    { name: 'Title', value: task.title },
                    { name: 'Due', value: task.due ? new Date(task.due).toLocaleString() : 'No due date' },
                    { name: 'Notes', value: task.notes || 'None' }
                )
                .setColor(0x00FF00)
                .setFooter({ text: `Task ID: ${task.id}` });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Todo Command Error:', error);
            await interaction.editReply({
                content: `❌ Error: ${error.message}. Make sure you have run /link.`
            });
        }
    },
};
