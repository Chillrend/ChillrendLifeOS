const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../models/User');
const PlaneService = require('../../services/planeService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('backlog')
        .setDescription('View your active tasks from Plane (Todo & In Progress)'),
    async execute(interaction) {
        await interaction.deferReply();

        try {
            const user = await User.findOne({ discordId: interaction.user.id });

            if (!user || !user.planeApiKey) {
                return interaction.editReply('You need to link your Plane API key first! Use the `/link` command.');
            }

            const plane = new PlaneService(user.planeApiKey);
            // 1. Fetch all tasks and all states
            const [tasks, states] = await Promise.all([
                plane.getTasks(), // Fetch all tasks without filters
                plane.getStates()
            ]);

            // 2. Create a map for quick state lookup
            const stateMap = new Map(states.map(s => [s.id, s.name]));

            // 3. Filter tasks manually
            const todoTasks = tasks.filter(t => stateMap.get(t.state) === 'Todo');
            const inProgressTasks = tasks.filter(t => stateMap.get(t.state) === 'In Progress');

            if (todoTasks.length === 0 && inProgressTasks.length === 0) {
                return await interaction.editReply('🎉 No active tasks in your backlog!');
            }

            const embed = new EmbedBuilder()
                .setTitle('🗃️ Your Active Backlog')
                .setColor(0x808080);

            if (inProgressTasks.length > 0) {
                const listStr = inProgressTasks
                    .slice(0, 15)
                    .map(t => `• \`#CHL-${t.sequence_id}\` ${t.name}`)
                    .join('\n');
                embed.addFields({ name: `🚀 In Progress (${inProgressTasks.length})`, value: listStr });
            }

            if (todoTasks.length > 0) {
                const listStr = todoTasks
                    .slice(0, 15)
                    .map(t => `• \`#CHL-${t.sequence_id}\` ${t.name}`)
                    .join('\n');
                embed.addFields({ name: `📥 Todo (${todoTasks.length})`, value: listStr });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Backlog Command Error:', error);
            await interaction.editReply({ content: `❌ Error: ${error.message}` });
        }
    },
};
