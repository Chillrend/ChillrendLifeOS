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
            const availableLabels = await vikunja.getLabels();
            const labelNames = availableLabels.map(l => l.title);

            let refined;
            let isRefinedSufficient = false;

            // 1. Refine the task with Gemini, utilizing a Grill-Me loop
            while (!isRefinedSufficient) {
                refined = await refineTask(initialTitle, currentDescription, labelNames);
                
                if (refined.isSufficient === false && refined.questions && refined.questions.length > 0) {
                    const questionText = refined.questions.map(q => `- ${q}`).join('\n');
                    

                    // Use Discord's built-in awaiting component system instead of raw text messages
                    // We will send a button that opens a modal for the user to type their answer.
                    // This bypasses the need for the Message Content intent entirely!
                    const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
                    
                    const answerButton = new ButtonBuilder()
                        .setCustomId('answer_grill_question')
                        .setLabel('Answer Question')
                        .setStyle(ButtonStyle.Primary);
                        
                    const row = new ActionRowBuilder().addComponents(answerButton);

                    const message = await interaction.editReply({ 
                        content: `🤔 **I need more details to make this a good task.**\n\n${questionText}\n\n*(Click the button below to answer)*`,
                        components: [row]
                    });

                    try {
                        // Wait for button click
                        const buttonInteraction = await message.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id, time: 900000 }); // 15 minutes
                        
                        // Create and show modal
                        const modal = new ModalBuilder()
                            .setCustomId('grill_modal')
                            .setTitle('Task Clarification');

                        const textInput = new TextInputBuilder()
                            .setCustomId('clarification_input')
                            .setLabel('Your Answer')
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(true);

                        const modalRow = new ActionRowBuilder().addComponents(textInput);
                        modal.addComponents(modalRow);

                        await buttonInteraction.showModal(modal);

                        // Wait for modal submit
                        const modalSubmit = await buttonInteraction.awaitModalSubmit({ filter: i => i.user.id === interaction.user.id, time: 900000 }); // 15 minutes
                        
                        const userReplyContent = modalSubmit.fields.getTextInputValue('clarification_input');
                        
                        // Defer the modal update to keep the interaction alive
                        await modalSubmit.deferUpdate();

                        // Append the new info
                        currentDescription += `\n\n**User Clarification:** ${userReplyContent}`;

                    } catch (e) {
                        console.log('[TODO] Interaction timed out or failed:', e.message);
                        return await interaction.editReply({ content: '⏳ Task creation cancelled due to timeout (no response).', components: [], embeds: [] });
                    }

                    // Remove the lingering modal button components
                    await interaction.editReply({ content: '🔄 Refining task with new information...', components: [], embeds: [] });
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

            await interaction.editReply({ content: '', embeds: [embed], components: [] });

        } catch (error) {
            console.error('Todo Command Error:', error);
            await interaction.editReply({
                content: `❌ An error occurred: ${error.message}`
            });
        }
    },
};
