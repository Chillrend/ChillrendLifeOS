const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../models/User');
const PlaneService = require('../../services/planeService');
const { getWeek, format, addWeeks, startOfWeek, endOfWeek, subWeeks, isBefore } = require('date-fns');

// Helper to get the cycle name format
const getCycleName = (date) => `Week ${getWeek(date, { weekStartsOn: 1 })} - ${format(date, 'MMMM yyyy')}`;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wrapup')
        .setDescription('Moves active tasks to the next weekly cycle and archives old cycles.'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const user = await User.findOne({ discordId: interaction.user.id });
            if (!user || !user.planeApiKey) {
                return interaction.editReply('You need to link your Plane API key first! Use the `/link` command.');
            }

            const plane = new PlaneService(user.planeApiKey);
            const embed = new EmbedBuilder().setTitle('Weekly Wrap-up Report').setColor(0x0099FF);
            let description = '';

            // 1. Fetch all necessary data
            const [tasks, states, cycles] = await Promise.all([
                plane.getTasks(),
                plane.getStates(),
                plane.getCycles()
            ]);

            const doneStateId = states.find(s => s.name === 'Done')?.id;
            if (!doneStateId) {
                return interaction.editReply('Could not find the "Done" state in your project.');
            }

            // 2. Find/Create the upcoming cycle
            const nextWeek = addWeeks(new Date(), 1);
            const nextWeekCycleName = getCycleName(nextWeek);
            let upcomingCycle = cycles.find(c => c.name === nextWeekCycleName);

            if (!upcomingCycle) {
                const newCycle = {
                    name: nextWeekCycleName,
                    description: `Cycles for week ${getWeek(nextWeek, { weekStartsOn: 1 })} - ${format(nextWeek, 'MMMM yyyy')}.`,
                    start_date: format(startOfWeek(nextWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
                    end_date: format(endOfWeek(nextWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
                };
                upcomingCycle = await plane.createCycle(newCycle);
                description += `✅ Created upcoming cycle: **${upcomingCycle.name}**\n`;
            } else {
                description += `🔍 Found upcoming cycle: **${upcomingCycle.name}**\n`;
            }

            // 3. Move active tasks to the upcoming cycle
            const activeTasks = tasks.filter(t => t.state !== doneStateId);
            const activeTaskIds = activeTasks.map(t => t.id);

            if (activeTaskIds.length > 0) {
                await plane.addIssuesToCycle(upcomingCycle.id, activeTaskIds);
                description += `🚚 Moved **${activeTaskIds.length}** active task(s) to the new cycle.\n`;
            } else {
                description += 'No active tasks to move.\n';
            }

            // 4. Archive cycles older than 4 weeks
            const fourWeeksAgo = subWeeks(new Date(), 4);
            const cyclesToArchive = cycles.filter(c => c.end_date && isBefore(new Date(c.end_date), fourWeeksAgo));
            
            if (cyclesToArchive.length > 0) {
                const archivePromises = cyclesToArchive.map(c => plane.archiveCycle(c.id));
                const results = await Promise.all(archivePromises);
                const successfulArchives = results.filter(r => r.success).length;
                description += `🗄️ Archived **${successfulArchives}** old cycle(s).\n`;
            } else {
                description += 'No old cycles to archive.\n';
            }

            embed.setDescription(description);
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Wrapup Command Error:', error);
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Wrap-up Failed')
                .setColor(0xFF0000)
                .setDescription(`An error occurred: ${error.message}`);
            await interaction.editReply({ embeds: [errorEmbed] });
        }
    },
};
