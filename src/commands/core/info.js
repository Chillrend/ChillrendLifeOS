const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { name, version, description } = require('../../../package.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('info')
        .setDescription('Displays information about the bot.'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('Application Information')
            .setColor('#0099ff')
            .addFields(
                { name: 'Name', value: name, inline: true },
                { name: 'Version', value: version, inline: true },
                { name: 'Description', value: description, inline: false }
            );
        await interaction.reply({ embeds: [embed] });
    },
};
