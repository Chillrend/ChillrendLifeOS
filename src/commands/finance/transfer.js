const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
// We reuse addTransaction, but transfer usually implies two transactions (out and in).
// However, Actual Budget 'transfers' are often just one transaction with a transfer 'payee' (the other account).
// api.importTransactions handles checking for transfer payees usually.
// Let's rely on basic logic: "Transfer $100 to Savings" -> AI detects Payee="Savings" -> Actual detects Payee is Account -> creates transfer.
const { parseTransaction } = require('../../services/geminiService');
const { addTransaction } = require('../../services/actualService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('transfer')
        .setDescription('Log a transfer between accounts')
        .addStringOption(option =>
            option.setName('details')
                .setDescription('Transfer details e.g., "$500 to Savings"')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('from')
                .setDescription('Account to transfer FROM')
                .setRequired(false)),
    async execute(interaction) {
        await interaction.deferReply();

        try {
            const rawInput = interaction.options.getString('details');
            const accountOverride = interaction.options.getString('from');

            // 1. AI Parse (Treat as expense from source)
            const details = await parseTransaction(rawInput, 'expense');
            if (!details) throw new Error("Failed to parse transfer details.");

            if (accountOverride) details.account = accountOverride;

            // Amount is negative for the sender
            details.amount = -Math.abs(details.amount);

            // Note: Actual API requires the payee_name to EXACTLY match an account name for it to be a transfer.
            // AI might give "Savings", if your account is "Savings Account", it might break.
            // We'll rely on user or AI getting it close enough, or Actual creating a new payee.
            // A more robust solution would verify account names.

            // 2. Submit to Actual
            await addTransaction(details);

            const embed = new EmbedBuilder()
                .setTitle('↔️ Transfer Logged')
                .setDescription('Note: Verify in Actual that this linked correctly.')
                .addFields(
                    { name: 'Amount', value: `$${Math.abs(details.amount)}`, inline: true },
                    { name: 'To (Payee)', value: details.payee || 'Unknown', inline: true },
                    { name: 'From (Account)', value: details.account || 'Default', inline: true },
                    { name: 'Date', value: details.date, inline: true }
                )
                .setColor(0x0000FF);

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Transfer Command Error:', error);
            await interaction.editReply({ content: `❌ Error: ${error.message}` });
        }
    },
};
