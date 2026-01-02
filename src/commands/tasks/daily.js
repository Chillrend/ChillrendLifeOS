const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../models/User');
const PlaneService = require('../../services/planeService');
const { createDailyLog } = require('../../services/geminiService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Generates a daily work log based on your Plane tasks and comments.'),
    async execute(interaction) {
        await interaction.deferReply();

        try {
            const user = await User.findOne({ discordId: interaction.user.id });

            if (!user || !user.planeApiKey) {
                return interaction.editReply('You need to link your Plane API key first! Use the `/link` command.');
            }

            const plane = new PlaneService(user.planeApiKey);

            // 1. Fetch tasks
            const tasks = await plane.getTasks();
            const relevantTasks = tasks.filter(t => t.state.name === 'Done' || t.state.name === 'In Progress');

            // 2. Fetch comments for today
            let comments = [];
            for (const task of relevantTasks) {
                const taskComments = await plane.getComments(task.id);
                const todayComments = taskComments.filter(c => new Date(c.created_at).toDateString() === new Date().toDateString());
                if (todayComments.length > 0) {
                    comments.push({ task: task.name, comments: todayComments.map(c => c.comment_raw) });
                }
            }

            // 3. Generate daily log with Gemini
            const dailyLog = await createDailyLog(relevantTasks, comments);

            if (!dailyLog) {
                return interaction.editReply('Could not generate a daily log. There might be no activity today.');
            }

            // 4. Send the log
            const embed = new EmbedBuilder()
                .setTitle('📅 Daily Work Log')
                .setDescription(dailyLog)
                .setColor(0x00BFFF)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Daily Command Error:', error);
            await interaction.editReply({ content: `❌ Error: ${error.message}` });
        }
    },
};
