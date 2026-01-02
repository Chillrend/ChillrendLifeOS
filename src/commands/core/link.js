const { SlashCommandBuilder } = require('discord.js');
const User = require('../../models/User');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Plane API Key')
        .addStringOption(option =>
            option.setName('apikey')
                .setDescription('Your Plane API Key')
                .setRequired(true)),
    async execute(interaction) {
        const apiKey = interaction.options.getString('apikey');
        const userId = interaction.user.id;

        try {
            await User.findOneAndUpdate({ discordId: userId }, { planeApiKey: apiKey }, { upsert: true });
            await interaction.reply({ content: 'Your Plane API Key has been linked successfully!', ephemeral: true });
        } catch (error) {
            console.error('Error linking Plane API Key:', error);
            await interaction.reply({ content: 'There was an error linking your Plane API Key. Please try again later.', ephemeral: true });
        }
    },
};
