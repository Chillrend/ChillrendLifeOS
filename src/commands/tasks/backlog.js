const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../models/User');
const PlaneService = require('../../services/planeService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('backlog')
        .setDescription('View your tasks from Plane'),
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
                return await interaction.editReply('📭 Your Plane task list is empty!');
            }

            const embed = new EmbedBuilder()
                .setTitle(`🗃️ Your Plane Tasks (${tasks.length} items)`)
                .setColor(0x808080);

            const displayTasks = tasks.slice(0, 15);
            const listStr = displayTasks.map(t => `• ${t.title}`).join('\n');

            embed.addFields({ name: 'Tasks', value: listStr || 'None' });

            if (tasks.length > 15) {
                embed.setFooter({ text: `...and ${tasks.length - 15} more items.` });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Backlog Command Error:', error);
            await interaction.editReply({ content: `❌ Error: ${error.message}` });
        }
    },
};
