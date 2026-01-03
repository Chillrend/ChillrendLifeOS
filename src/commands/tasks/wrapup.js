const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../models/User');
const PlaneService = require('../../services/planeService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wrapup')
        .setDescription('Archives all tasks that are in the "Done" state.'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const user = await User.findOne({ discordId: interaction.user.id });
            return interaction.editReply('ON DEVELOPMENT');
            if (!user || !user.planeApiKey) {
                return interaction.editReply('You need to link your Plane API key first! Use the `/link` command.');
            }

            const plane = new PlaneService(user.planeApiKey);
            const [tasks, states] = await Promise.all([
                plane.getTasks(),
                plane.getStates()
            ]);

            const doneStateId = states.find(s => s.name === 'Done')?.id;

            if (!doneStateId) {
                return interaction.editReply('Could not find the "Done" state in your project.');
            }

            const tasksToArchive = tasks.filter(t => t.state === doneStateId);

            if (tasksToArchive.length === 0) {
                return interaction.editReply('No "Done" tasks to archive.');
            }

            // Archive tasks one by one
            const archivePromises = tasksToArchive.map(t => plane.archiveTask(t.id));
            const results = await Promise.all(archivePromises);

            const successfulArchives = results.filter(r => r.success).length;
            const failedArchives = tasksToArchive.length - successfulArchives;

            const embed = new EmbedBuilder()
                .setTitle('✅ Wrap-up Complete!')
                .setColor(0x00FF00)
                .setDescription(`Successfully archived ${successfulArchives} "Done" tasks.`);

            if (failedArchives > 0) {
                embed.addFields({ name: '⚠️ Failures', value: `${failedArchives} tasks could not be archived. Check the logs for details.` });
                embed.setColor(0xFFCC00); // Yellow for partial success
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Wrapup Command Error:', error);
            await interaction.editReply({ content: `❌ An error occurred: ${error.message}` });
        }
    },
};
