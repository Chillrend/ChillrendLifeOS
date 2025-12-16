const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { processTransfer } = require('../../services/geminiService');
const actualService = require('../../services/actualService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('transfer')
        .setDescription('Log a transfer between accounts using AI parsing.')
        .addStringOption(option =>
            option.setName('details')
                .setDescription('Transfer details e.g., "pindahin 500rb dari bca ke gopay"')
                .setRequired(true)),
    async execute(interaction) {
        await interaction.deferReply();

        try {
            await actualService.init();

            const rawInput = interaction.options.getString('details');

            const accounts = await actualService.getAccounts();
            const accountNames = accounts.map(acc => acc.name);

            const parsedDetails = await processTransfer(rawInput, accountNames);

            if (!parsedDetails) {
                return interaction.editReply({ content: '❌ I could not understand the transfer details. Please try rephrasing.' });
            }

            const sourceAccount = accounts.find(acc => acc.name === parsedDetails.source_account);
            const destinationAccount = accounts.find(acc => acc.name === parsedDetails.destination_account);

            if (!sourceAccount) {
                return interaction.editReply({ content: `❌ Source account "${parsedDetails.source_account}" not found.` });
            }
            if (!destinationAccount) {
                return interaction.editReply({ content: `❌ Destination account "${parsedDetails.destination_account}" not found.` });
            }
            if (sourceAccount.id === destinationAccount.id) {
                return interaction.editReply({ content: '❌ Source and destination accounts cannot be the same.' });
            }

            const payees = await actualService.getPayees();
            const transferPayee = payees.find(p => p.transfer_acct === destinationAccount.id);

            if (!transferPayee) {
                return interaction.editReply({ content: `❌ Could not find the internal transfer payee for account "${destinationAccount.name}". Please ensure it's set up in Actual.` });
            }

            // Convert amount to a negative integer in cents for the expense transaction.
            const amountInCents = actualService.utils.amountToInteger(-Math.abs(parsedDetails.amount));

            const transaction = {
                date: parsedDetails.date,
                amount: amountInCents,
                payee: transferPayee.id,
                notes: parsedDetails.description,
                cleared: false,
            };

            // Call addTransactions with the runTransfers flag in an options object.
            await actualService.addTransactions(sourceAccount.id, [transaction], true);

            const embed = new EmbedBuilder()
                .setTitle('↔️ Transfer Logged')
                .setDescription(parsedDetails.description)
                .addFields(
                    { name: 'Amount', value: actualService.formatToIDR(Math.abs(parsedDetails.amount)), inline: true },
                    { name: 'From', value: parsedDetails.source_account, inline: true },
                    { name: 'To', value: parsedDetails.destination_account, inline: true },
                    { name: 'Date', value: parsedDetails.date, inline: true }
                )
                .setColor(0x0000FF);

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Transfer Command Error:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.editReply({ content: `❌ An error occurred while logging your transfer: ${error.message}` });
            }
        } finally {
            await actualService.shutdown();
        }
    },
};
