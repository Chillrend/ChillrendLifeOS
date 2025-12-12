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

            const sourceAccount = accounts.find(acc => acc.name === parsedDetails.source_account_name);
            const destinationAccount = accounts.find(acc => acc.name === parsedDetails.destination_account_name);

            if (!sourceAccount) {
                return interaction.editReply({ content: `❌ Source account "${parsedDetails.source_account_name}" not found.` });
            }
            if (!destinationAccount) {
                return interaction.editReply({ content: `❌ Destination account "${parsedDetails.destination_account_name}" not found.` });
            }

            // In Actual, a transfer is a single transaction where the payee is the other account.
            const payees = await actualService.getPayees();
            const transferPayee = payees.find(p => p.transfer_acct === destinationAccount.id);

            if (!transferPayee) {
                return interaction.editReply({ content: `❌ Could not find the internal transfer payee for account "${destinationAccount.name}". Please ensure it's set up in Actual.` });
            }

            const amountMilliunits = actualService.utils.amountToMilliunits(-Math.abs(parsedDetails.amount));

            const transaction = {
                date: parsedDetails.transaction_date,
                amount: amountMilliunits,
                payee: transferPayee.id,
                notes: parsedDetails.description,
                cleared: false,
            };

            await actualService.addTransactions(sourceAccount.id, [transaction]);

            const embed = new EmbedBuilder()
                .setTitle('↔️ Transfer Logged')
                .setDescription(parsedDetails.description)
                .addFields(
                    { name: 'Amount', value: `$${Math.abs(parsedDetails.amount).toFixed(2)}`, inline: true },
                    { name: 'From', value: parsedDetails.source_account_name, inline: true },
                    { name: 'To', value: parsedDetails.destination_account_name, inline: true },
                    { name: 'Date', value: parsedDetails.transaction_date, inline: true }
                )
                .setColor(0x0000FF);

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Transfer Command Error:', error);
            await interaction.editReply({ content: `❌ An error occurred while logging your transfer: ${error.message}` });
        }
    },
};
