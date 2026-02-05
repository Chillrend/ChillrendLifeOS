const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('quick-action')
        .setDescription('Spawns a persistent dashboard for one-tap action.'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('⚡ LifeOS Quick Action')
            .setDescription('Select a category to swap between Finance and Task shortcuts.')
            .setColor('#2ecc71') // Finance Green
            .setFooter({ text: 'Tip: Pin this message for zero-friction access!' });

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('dashboard_selector')
                .setPlaceholder('Choose a category...')
                .addOptions([
                    { label: 'Finance', value: 'mode_finance', emoji: '💰' },
                    { label: 'Tasks', value: 'mode_task', emoji: '✅' },
                ]),
        );

        await interaction.reply({ embeds: [embed], components: [row] });
    },

    // This is the new function called by index.js
    async handleComponent(interaction) {
        // Handle Dropdown Updates
        if (interaction.isStringSelectMenu() && interaction.customId === 'dashboard_selector') {
            const selection = interaction.values[0];
            const buttonRow = new ActionRowBuilder();

            if (selection === 'mode_finance') {
                buttonRow.addComponents(
                    new ButtonBuilder().setCustomId('fin_commute').setLabel('Commute (15k)').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('fin_lunch').setLabel('Lunch (30k)').setStyle(ButtonStyle.Success),
                );
            }
            // Add your 'mode_task' logic here too

            await interaction.update({ components: [interaction.message.components[0], buttonRow] });
        }

        // Handle Button Clicks
        if (interaction.isButton()) {
            await interaction.deferReply({ ephemeral: true });

            if (interaction.customId === 'fin_commute') {
                // log to Actual Budget here
                await interaction.editReply('✅ Logged 15k for Commute!');
            }
        }
    }
};