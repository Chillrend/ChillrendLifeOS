const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { processTransaction } = require('../../services/geminiService');
const actualService = require('../../services/actualService'); // Import the entire service

module.exports = {
    data: new SlashCommandBuilder()
        .setName('expense')
        .setDescription('Log an expense to Actual Budget using AI parsing.')
        .addStringOption(option =>
            option.setName('details')
                .setDescription('Expense details e.g., "beli kopi 20k di starbucks"')
                .setRequired(true)),
    async execute(interaction) {
        await interaction.deferReply();

        try {
            await actualService.init(); // Ensure Actual service is initialized

            const rawInput = interaction.options.getString('details');

            // Fetch accounts and categories for Gemini to use
            const accounts = await actualService.getAccounts();
            const categories = await actualService.getCategories();

            const accountNames = accounts.map(acc => acc.name);
            const categoryNames = categories.map(cat => cat.name);

            // 1. AI Parse
            const parsedDetails = await processTransaction(rawInput, 'expense', accountNames, categoryNames);

            if (!parsedDetails) {
                return interaction.editReply({ content: '❌ I could not understand the expense details. Please try rephrasing.' });
            }

            // Find the actual account and category objects by name
            const targetAccount = accounts.find(acc => acc.name === parsedDetails.account_name);
            const targetCategory = categories.find(cat => cat.name === parsedDetails.category_name);

            if (!targetAccount) {
                return interaction.editReply({ content: `❌ Account "${parsedDetails.account_name}" not found in Actual Budget.` });
            }
            if (!targetCategory) {
                return interaction.editReply({ content: `❌ Category "${parsedDetails.category_name}" not found in Actual Budget.` });
            }

            // Ensure amount is negative for expense and convert to milliunits
            const amountMilliunits = actualService.utils.amountToMilliunits(-Math.abs(parsedDetails.amount));

            // 2. Prepare transaction for Actual Budget
            const transaction = {
                date: parsedDetails.transaction_date,
                amount: amountMilliunits,
                payee_name: parsedDetails.payee_name || 'Unknown',
                notes: parsedDetails.description,
                category: targetCategory.id,
                cleared: false, // Default to uncleared
            };

            // 3. Submit to Actual
            await actualService.addTransactions(targetAccount.id, [transaction]);

            const embed = new EmbedBuilder()
                .setTitle('💸 Expense Logged')
                .setDescription(parsedDetails.description)
                .addFields(
                    { name: 'Amount', value: `$${Math.abs(parsedDetails.amount).toFixed(2)}`, inline: true },
                    { name: 'Account', value: parsedDetails.account_name, inline: true },
                    { name: 'Category', value: parsedDetails.category_name, inline: true },
                    { name: 'Payee', value: parsedDetails.payee_name || 'N/A', inline: true },
                    { name: 'Date', value: parsedDetails.transaction_date, inline: true }
                )
                .setColor(0xFF0000);

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Expense Command Error:', error);
            await interaction.editReply({ content: `❌ An error occurred while logging your expense: ${error.message}` });
        }
    },
};
