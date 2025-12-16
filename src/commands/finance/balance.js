const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { processBalanceQuery } = require('../../services/geminiService');
const actualService = require('../../services/actualService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Check account or category balance using AI.')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Your question, e.g., "how much is in my BCA account?" or "spending on food"')
                .setRequired(true)),
    async execute(interaction) {
        await interaction.deferReply();

        try {
            await actualService.init();
            const query = interaction.options.getString('query');

            const accounts = await actualService.getAccounts();
            const categories = await actualService.getCategories();
            const accountNames = accounts.map(a => a.name);
            const categoryNames = categories.map(c => c.name);

            const parsedQuery = await processBalanceQuery(query, accountNames, categoryNames);
            console.log(parsedQuery);

            if (!parsedQuery) {
                return interaction.editReply({ content: "❌ I couldn't understand your query. Please try rephrasing." });
            }

            const embed = new EmbedBuilder().setTitle('Balance Inquiry').setColor(0x00BFFF);

            if (parsedQuery.query_type === 'account') {
                const targetAccount = accounts.find(a => a.name === parsedQuery.name);
                if (!targetAccount) {
                    return interaction.editReply({ content: `❌ Account "${parsedQuery.name}" not found.` });
                }

                const balanceInCents = await actualService.getAccountBalance(targetAccount.id);
                const balance = balanceInCents / 100;
                embed.addFields(
                    { name: 'Account', value: targetAccount.name },
                    { name: 'Balance', value: actualService.formatToIDR(balance) }
                );
            } else if (parsedQuery.query_type === 'summary') {
                 embed.setTitle('All Account Balances');
                 for (const account of accounts) {
                     if (!account.closed) {
                        const balanceInCents = await actualService.getAccountBalance(account.id);
                        const balance = balanceInCents / 100;
                        embed.addFields({ name: account.name, value: actualService.formatToIDR(balance), inline: true });
                     }
                 }
            } else {
                return interaction.editReply({ content: 'Sorry, querying category spending is not fully implemented yet.' });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Balance Command Error:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.editReply({ content: `❌ An error occurred: ${error.message}` });
            }
        } finally {
            await actualService.shutdown();
        }
    },
};
