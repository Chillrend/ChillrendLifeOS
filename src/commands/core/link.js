const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getAuthUrl } = require('../../services/googleAuth');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Google Account to manage tasks'),
    async execute(interaction) {
        const authUrl = getAuthUrl();

        const embed = new EmbedBuilder()
            .setTitle('Link Google Account')
            .setDescription('Click the button below to authorize the bot to access your Google Tasks.')
            .setColor(0x0099FF);

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Connect Google Account')
                    .setStyle(ButtonStyle.Link)
                    .setURL(authUrl),
            );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    },
};
