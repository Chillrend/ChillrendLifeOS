const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { parseTransaction } = require('../../services/geminiService');
const { addTransaction } = require('../../services/actualService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('expense')
        .setDescription('Log an expense to Actual Budget')
        .addStringOption(option =>
            option.setName('details')
                .setDescription('Expense details e.g., "$15 lunch at Burger King"')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('account')
                .setDescription('Optional: Account name to charge (e.g., "Amex", "Cash")')
                .setRequired(false)),
    async execute(interaction) {
        await interaction.deferReply();

        try {
            const rawInput = interaction.options.getString('details');
            const accountOverride = interaction.options.getString('account');

            // 1. AI Parse
            const details = await parseTransaction(rawInput, 'expense');
            if (!details) throw new Error("Failed to parse transaction details.");

            if (accountOverride) details.account = accountOverride;

            // Ensure amount is negative for expense
            // parseTransaction usually returns absolute value
            details.amount = -Math.abs(details.amount);

            // 2. Submit to Actual
            await addTransaction(details);

            const embed = new EmbedBuilder()
                .setTitle('💸 Expense Logged')
                .addFields(
                    { name: 'Amount', value: `$${Math.abs(details.amount)}`, inline: true },
                    { name: 'Payee', value: details.payee || 'Unknown', inline: true },
                    { name: 'Category', value: details.category || 'Uncategorized', inline: true },
                    { name: 'Account', value: details.account || 'Default', inline: true },
                    { name: 'Date', value: details.date, inline: true }
                )
                .setColor(0xFF0000);

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Expense Command Error:', error);
            await interaction.editReply({ content: `❌ Error: ${error.message}` });
        }
    },
};
