const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { parseTransaction } = require('../../services/geminiService');
const { addTransaction } = require('../../services/actualService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('income')
        .setDescription('Log income to Actual Budget')
        .addStringOption(option =>
            option.setName('details')
                .setDescription('Income details e.g., "Salary $3000"')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('account')
                .setDescription('Optional: Account name')
                .setRequired(false)),
    async execute(interaction) {
        await interaction.deferReply();

        try {
            const rawInput = interaction.options.getString('details');
            const accountOverride = interaction.options.getString('account');

            // 1. AI Parse
            const details = await parseTransaction(rawInput, 'income');
            if (!details) throw new Error("Failed to parse transaction details.");

            if (accountOverride) details.account = accountOverride;

            // Ensure amount is positive for income
            details.amount = Math.abs(details.amount);

            // 2. Submit to Actual
            await addTransaction(details);

            const embed = new EmbedBuilder()
                .setTitle('💰 Income Logged')
                .addFields(
                    { name: 'Amount', value: `$${details.amount}`, inline: true },
                    { name: 'Source', value: details.payee || 'Unknown', inline: true },
                    { name: 'Category', value: details.category || 'Income', inline: true },
                    { name: 'Account', value: details.account || 'Default', inline: true },
                    { name: 'Date', value: details.date, inline: true }
                )
                .setColor(0x00FF00);

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Income Command Error:', error);
            await interaction.editReply({ content: `❌ Error: ${error.message}` });
        }
    },
};
