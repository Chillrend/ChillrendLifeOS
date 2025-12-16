const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { processTransaction } = require('../../services/geminiService');
const actualService = require('../../services/actualService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('income')
        .setDescription('Log an income to Actual Budget using AI parsing.')
        .addStringOption(option =>
            option.setName('details')
                .setDescription('Income details e.g., "gajian 5jt dari kantor"')
                .setRequired(true)),
    async execute(interaction) {
        await interaction.deferReply();

        try {
            await actualService.init();

            const rawInput = interaction.options.getString('details');

            const accounts = await actualService.getAccounts();
            const categories = await actualService.getCategories();
            const accountNames = accounts.map(acc => acc.name);
            const incomeCategoryNames = categories.filter(cat => cat.is_income).map(cat => cat.name);

            const parsedDetails = await processTransaction(rawInput, 'income', accountNames, incomeCategoryNames);

            if (!parsedDetails) {
                return interaction.editReply({ content: '❌ I could not understand the income details. Please try rephrasing.' });
            }

            const targetAccount = accounts.find(acc => acc.name === parsedDetails.account);
            const targetCategory = categories.find(cat => cat.name === parsedDetails.category);

            if (!targetAccount) {
                return interaction.editReply({ content: `❌ Account "${parsedDetails.account}" not found in Actual Budget.` });
            }
            if (!targetCategory) {
                return interaction.editReply({ content: `❌ Category "${parsedDetails.category}" not found in Actual Budget.` });
            }

            const amountInCents = actualService.utils.amountToInteger(Math.abs(parsedDetails.amount));

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
                .setTitle('💰 Income Logged')
                .setDescription(parsedDetails.description)
                .addFields(
                    { name: 'Amount', value: actualService.formatToIDR(Math.abs(parsedDetails.amount)), inline: true },
                    { name: 'Account', value: parsedDetails.account, inline: true },
                    { name: 'Category', value: parsedDetails.category, inline: true },
                    { name: 'Source', value: parsedDetails.payee_name || 'N/A', inline: true },
                    { name: 'Date', value: parsedDetails.date, inline: true }
                )
                .setColor(0x00FF00);

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Income Command Error:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.editReply({ content: `❌ An error occurred while logging your income: ${error.message}` });
            }
        } finally {
            await actualService.shutdown();
        }
    },
};
