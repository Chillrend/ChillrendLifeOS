const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const VikunjaService = require('../../services/vikunjaService');
const { refineTask } = require('../../services/geminiService');
const { toZonedTime, fromZonedTime } = require('date-fns-tz');
const { nextFriday, setHours, setMinutes, setSeconds, setMilliseconds, isFriday, getHours } = require('date-fns');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('todo')
        .setDescription('Add a new task to Vikunja, refined by AI with automatic start and due dates.')
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
            let currentDescription = interaction.options.getString('description');

            const vikunja = new VikunjaService();
            let refined;
            let isRefinedSufficient = false;

            // 1. Refine the task with Gemini, utilizing a Grill-Me loop
            while (!isRefinedSufficient) {
                refined = await refineTask(initialTitle, currentDescription);
                
                if (refined.isSufficient === false && refined.questions && refined.questions.length > 0) {
                    const questionText = refined.questions.map(q => `- ${q}`).join('\n');
                    await interaction.editReply({ 
                        content: `🤔 **I need more details to make this a good task.**\n\nPlease answer the following questions in this channel:\n${questionText}\n\n*(I am listening to your next message...)*`,
                        embeds: []
                    });

                    // Wait for the user to reply in the channel
                    const filter = m => m.author.id === interaction.user.id;
                    const collector = interaction.channel.createMessageCollector({ filter, max: 1, time: 60000 });

                    const userReply = await new Promise((resolve, reject) => {
                        collector.on('collect', m => resolve(m));
                        collector.on('end', collected => {
                            if (collected.size === 0) reject(new Error('timeout'));
                        });
                    }).catch(() => null);

                    if (!userReply) {
                        return await interaction.editReply({ content: '⏳ Task creation cancelled due to timeout (no response).', embeds: [] });
                    }

                    // Append the new info
                    currentDescription += `\n\n**User Clarification:** ${userReply.content}`;
                    
                    // Cleanup user's chat message to keep the channel clean
                    try {
                        await userReply.delete();
                    } catch (e) {
                        console.error('Failed to delete user reply message:', e);
                    }

                    await interaction.editReply({ content: '🔄 Refining task with new information...', embeds: [] });
                } else {
                    isRefinedSufficient = true;
                }
            }

            // 2. Calculate dynamic dates based on the configured timezone

            const timezone = process.env.APP_TIMEZONE || 'Asia/Jakarta';
            const nowInTimezone = toZonedTime(new Date(), timezone);

            let targetFriday;
            // If today is Friday, and it is before 6 PM (18:00), this Friday is the due date
            if (isFriday(nowInTimezone) && getHours(nowInTimezone) < 18) {
                targetFriday = nowInTimezone;
            } else {
                targetFriday = nextFriday(nowInTimezone);
            }

            // Set to Friday at 6:00:00 PM local time
            targetFriday = setHours(targetFriday, 18);
            targetFriday = setMinutes(targetFriday, 0);
            targetFriday = setSeconds(targetFriday, 0);
            targetFriday = setMilliseconds(targetFriday, 0);

            // Convert to UTC/ISO standard for API storage
            const startDateISO = new Date().toISOString();
            const dueDateISO = fromZonedTime(targetFriday, timezone).toISOString();

            // 3. Create the task in Vikunja (default to Backlog bucket)
            const backlogBucketId = process.env.VIKUNJA_BUCKET_BACKLOG_ID;

            const createdTask = await vikunja.createTask({
                title: refined.title,
                notes: refined.notes,
                priority: refined.priority,
                bucketId: backlogBucketId,
                tags: refined.tags,
                startDate: startDateISO,
                dueDate: dueDateISO
            });

            // Format displayed dates nicely
            const displayStart = new Date(startDateISO).toLocaleString('en-US', { timeZone: timezone });
            const displayDue = new Date(dueDateISO).toLocaleString('en-US', { timeZone: timezone });

            // 4. Respond to the user
            const embed = new EmbedBuilder()
                .setTitle('✅ Task Added & Refined')
                .setDescription('Your task has been intelligently refined and added to Vikunja with standard work-week dates.')
                .addFields(
                    { name: 'Title', value: createdTask.title },
                    { name: 'Notes', value: refined.notes || 'None' },
                    { name: 'Bucket', value: 'Backlog', inline: true },
                    { name: 'Priority', value: refined.priority || 'None', inline: true },
                    { name: 'Labels / Tags', value: refined.tags.join(', ') || 'None', inline: true },
                    { name: 'Start Date', value: `\`${displayStart}\``, inline: true },
                    { name: 'Due Date (Friday 6pm)', value: `\`${displayDue}\``, inline: true }
                )
                .setColor(0x00FF00)
                .setFooter({ text: `Task ID: ${createdTask.id}` });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Todo Command Error:', error);
            await interaction.editReply({
                content: `❌ An error occurred: ${error.message}`
            });
        }
    },
};
