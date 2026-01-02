const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { processBalanceQuery } = require('../../services/geminiService');
const actualService = require('../../services/actualService');

// --- Helper Functions for Category Display ---

/**
 * Creates a more visually appealing progress bar using emoji.
 * @param {number} remainingPercent - The percentage of the budget remaining (0 to 1).
 * @returns {string} The emoji progress bar string.
 */
const createRemainingBar = (remainingPercent) => {
    const filledCount = Math.round(remainingPercent * 10);
    const emptyCount = 10 - filledCount;
    
    if (remainingPercent < 0) {
        return `🔥 Overspent`;
    }
    
    const filledEmoji = '🟩';
    const emptyEmoji = '🟥';
    
    return `${filledEmoji.repeat(filledCount)}${emptyEmoji.repeat(emptyCount)} ${Math.round(remainingPercent * 100)}%`;
};

/**
 * Determines the embed color based on the percentage of budget remaining.
 * @param {number} remainingPercent - The percentage of the budget remaining (0 to 1).
 * @returns {number} The hex color code for the embed.
 */
const getEmbedColor = (remainingPercent) => {
    if (remainingPercent < 0) return 0xFF0000; // Red for overspent
    if (remainingPercent < 0.25) return 0xFFA500; // Orange for low budget
    if (remainingPercent < 0.5) return 0xFFFF00; // Yellow for caution
    return 0x00BFFF; // Default blue for good
};


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

            const embed = new EmbedBuilder().setColor(0x00BFFF); // Default color

            if (parsedQuery.query_type === 'account') {
                const targetAccount = accounts.find(a => a.name === parsedQuery.name);
                if (!targetAccount) {
                    return interaction.editReply({ content: `❌ Account "${parsedQuery.name}" not found.` });
                }

                const balanceInCents = await actualService.getAccountBalance(targetAccount.id);
                embed.setTitle(`Account Balance: ${targetAccount.name}`)
                     .addFields({ name: 'Balance', value: actualService.formatToIDR(balanceInCents / 100) });

            } else if (parsedQuery.query_type === 'summary') {
                 embed.setTitle('All Account Balances');
                 for (const account of accounts) {
                     if (!account.closed) {
                        const balanceInCents = await actualService.getAccountBalance(account.id);
                        embed.addFields({ name: account.name, value: actualService.formatToIDR(balanceInCents / 100), inline: true });
                     }
                 }
            } else if (parsedQuery.query_type === 'category') {
                const targetCategory = categories.find(c => c.name === parsedQuery.name);
                if (!targetCategory) {
                    return interaction.editReply({ content: `❌ Category "${parsedQuery.name}" not found.` });
                }

                const spendingInCents = await actualService.getCategorySpending(targetCategory.id);
                const budgetedInCents = await actualService.getCategoryBudget(targetCategory.id);
                const remainingInCents = budgetedInCents - spendingInCents;

                const remainingPercent = budgetedInCents > 0 ? remainingInCents / budgetedInCents : 0;

                embed.setTitle(`Spending Report: ${targetCategory.name}`)
                     .setColor(getEmbedColor(remainingPercent))
                     .addFields(
                        { name: 'Spent', value: actualService.formatToIDR(spendingInCents / 100), inline: true },
                        { name: 'Budgeted', value: actualService.formatToIDR(budgetedInCents / 100), inline: true },
                        { name: 'Remaining', value: actualService.formatToIDR(remainingInCents / 100), inline: true },
                        { name: 'Budget Health', value: budgetedInCents > 0 ? createRemainingBar(remainingPercent) : 'Budget not set', inline: false }
                     );
            } else {
                return interaction.editReply({ content: 'Sorry, I can only handle account, category, and summary queries right now.' });
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
