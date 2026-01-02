const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../models/User');
const PlaneService = require('../../services/planeService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('summary')
        .setDescription('Get a summary of your tasks from Plane'),
    async execute(interaction) {
        await interaction.deferReply();

        try {
            const user = await User.findOne({ discordId: interaction.user.id });

            if (!user || !user.planeApiKey) {
                return interaction.editReply('You need to link your Plane API key first! Use the `/link` command.');
            }

            const plane = new PlaneService(user.planeApiKey);
            const tasks = await plane.getTasks();

            if (tasks.length === 0) {
                return await interaction.editReply('🎉 No tasks found in Plane!');
            }

            const embed = new EmbedBuilder()
                .setTitle(`📅 Your Plane Summary (${tasks.length} tasks)`)
                .setColor(0xFFA500)
                .setTimestamp();

            const displayTasks = tasks.slice(0, 20);

            displayTasks.forEach(task => {
                embed.addFields({
                    name: task.title,
                    value: ' ',
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
