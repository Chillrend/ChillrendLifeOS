const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { processTransaction } = require('../../services/geminiService');
const actualService = require('../../services/actualService');

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
            await actualService.init();

            const rawInput = interaction.options.getString('details');

            const accounts = await actualService.getAccounts();
            const categories = await actualService.getCategories();
            const accountNames = accounts.map(acc => acc.name);
            const categoryNames = categories.map(cat => cat.name);

            const parsedDetails = await processTransaction(rawInput, 'expense', accountNames, categoryNames);
            console.log(parsedDetails);
            if (!parsedDetails) {
                return interaction.editReply({ content: '❌ I could not understand the expense details. Please try rephrasing.' });
            }

            const targetAccount = accounts.find(acc => acc.name === parsedDetails.account);
            const targetCategory = categories.find(cat => cat.name === parsedDetails.category);
            console.log('parsed: ', parsedDetails,' acc: ', targetAccount, ' cat:' ,targetCategory)
            if (!targetAccount) {
                return interaction.editReply({ content: `❌ Account "${parsedDetails.account}" not found in Actual Budget.` });
            }
            if (!targetCategory) {
                return interaction.editReply({ content: `❌ Category "${parsedDetails.category}" not found in Actual Budget.` });
            }

            // Convert amount to a negative integer in cents for an expense.
            const amountInCents = actualService.utils.amountToInteger(-Math.abs(parsedDetails.amount));

            const transaction = {
                date: parsedDetails.date,
                amount: amountInCents,
                payee_name: parsedDetails.payee_name || 'Unknown',
                notes: parsedDetails.description,
                category: targetCategory.id,
                cleared: false,
            };

            await actualService.addTransactions(targetAccount.id, [transaction]);

            const embed = new EmbedBuilder()
                .setTitle('💸 Expense Logged')
                .setDescription(parsedDetails.description)
                .addFields(
                    { name: 'Amount', value: actualService.formatToIDR(Math.abs(parsedDetails.amount)), inline: true },
                    { name: 'Account', value: parsedDetails.account, inline: true },
                    { name: 'Category', value: parsedDetails.category, inline: true },
                    { name: 'Payee', value: parsedDetails.payee_name || 'N/A', inline: true },
                    { name: 'Date', value: parsedDetails.date, inline: true }
                )
                .setColor(0xFF0000);

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Expense Command Error:', error);
            // Check if the reply has already been sent before trying to edit it
            if (!interaction.replied && !interaction.deferred) {
                await interaction.editReply({ content: `❌ An error occurred while logging your expense: ${error.message}` });
            }
        } finally {
            await actualService.shutdown();
        }
    },
};
