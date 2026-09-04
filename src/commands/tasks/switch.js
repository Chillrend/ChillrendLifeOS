const { SlashCommandBuilder } = require('discord.js');
const VikunjaService = require('../../services/vikunjaService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('switch')
        .setDescription('Switches a task to a different Kanban bucket / state.')
        .addStringOption(option =>
            option.setName('task')
                .setDescription('The task to switch.')
                .setRequired(true)
                .setAutocomplete(true))
        .addStringOption(option =>
            option.setName('state')
                .setDescription('The state (bucket) to switch the task to.')
                .setRequired(true)
                .setAutocomplete(true)),
    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        const vikunja = new VikunjaService();

        try {
            if (focusedOption.name === 'task') {
                const tasks = await vikunja.getTasks();
                const activeTasks = tasks.filter(t => !t.done);
                const query = focusedOption.value.toLowerCase();
                const filtered = activeTasks
                    .filter(t => t.title.toLowerCase().includes(query))
                    .slice(0, 25);

                await interaction.respond(
                    filtered.map(task => ({ name: `[#${task.id}] ${task.title.slice(0, 80)}`, value: String(task.id) })),
                );
            }

            if (focusedOption.name === 'state') {
                const buckets = [
                    { name: 'Backlog', value: process.env.VIKUNJA_BUCKET_BACKLOG_ID },
                    { name: 'In Progress', value: process.env.VIKUNJA_BUCKET_INPROGRESS_ID },
                    { name: 'Paused', value: process.env.VIKUNJA_BUCKET_PAUSED_ID },
                    { name: 'Done', value: process.env.VIKUNJA_BUCKET_DONE_ID }
                ].filter(b => b.value); // only keep if configured

                const query = focusedOption.value.toLowerCase();
                const filtered = buckets.filter(b => b.name.toLowerCase().includes(query));

                await interaction.respond(
                    filtered.map(b => ({ name: b.name, value: b.value }))
                );
            }
        } catch (err) {
            console.error('Switch Autocomplete Error:', err);
            await interaction.respond([]);
        }
    },
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const taskId = interaction.options.getString('task');
            const bucketId = interaction.options.getString('state');

            const vikunja = new VikunjaService();
            
            // Move task to bucket
            await vikunja.updateTaskBucket(taskId, bucketId);

            // If moving to 'Done' bucket, set done flag to true, otherwise set to false
            const doneBucketId = process.env.VIKUNJA_BUCKET_DONE_ID;
            if (bucketId === doneBucketId) {
                await vikunja.updateTaskDone(taskId, true);
            } else {
                await vikunja.updateTaskDone(taskId, false);
            }

            await interaction.editReply('Task state updated successfully!');
        } catch (error) {
            console.error('Switch Command Error:', error);
            await interaction.editReply({ content: `❌ An error occurred: ${error.message}` });
        }
    },
};
