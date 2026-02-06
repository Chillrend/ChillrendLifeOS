const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const actualService = require('../../services/actualService');

const financeButtonsPath = path.join(__dirname, '..', '..', 'data', 'finance_buttons.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('quick-action')
        .setDescription('Spawns a persistent dashboard for one-tap action.'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('⚡ LifeOS Quick Action')
            .setDescription('Select a category to swap between Finance and Task shortcuts.')
            .setColor('#2ecc71') // Finance Green
            .setFooter({ text: 'Tip: Pin this message for zero-friction access!' });

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('dashboard_selector')
                .setPlaceholder('Choose a category...')
                .addOptions([
                    { label: 'Finance', value: 'mode_finance', emoji: '💰' },
                    { label: 'Tasks', value: 'mode_task', emoji: '✅' },
                ]),
        );

        await interaction.reply({ embeds: [embed], components: [row] });
    },

    async handleComponent(interaction) {
        if (interaction.isStringSelectMenu() && interaction.customId === 'dashboard_selector') {
            const selection = interaction.values[0];
            const components = [interaction.message.components[0]]; // Keep the original select menu

            if (selection === 'mode_finance') {
                const financeButtons = JSON.parse(fs.readFileSync(financeButtonsPath, 'utf-8'));
                if (financeButtons.length > 0) {
                    const buttonRows = [];
                    let currentRow = new ActionRowBuilder();
                    buttonRows.push(currentRow);

                    financeButtons.forEach(buttonInfo => {
                        // If the current row is full (5 buttons), create a new one
                        if (currentRow.components.length === 5) {
                            currentRow = new ActionRowBuilder();
                            buttonRows.push(currentRow);
                        }
                        currentRow.addComponents(
                            new ButtonBuilder()
                                .setCustomId(buttonInfo.custom_id)
                                .setLabel(`${buttonInfo.label} (${actualService.formatToIDR(buttonInfo.amount)})`)
                                .setStyle(ButtonStyle[buttonInfo.style])
                        );
                    });
                    components.push(...buttonRows);
                }
            } else if (selection === 'mode_task') {
                // Placeholder for task buttons. Currently, this will result in no button rows being added,
                // effectively clearing the finance buttons, which is the desired behavior.
            }

            await interaction.update({ components });
        }

        if (interaction.isButton()) {
            await interaction.deferReply({ ephemeral: true });

            try {
                await actualService.init();
                const financeButtons = JSON.parse(fs.readFileSync(financeButtonsPath, 'utf-8'));
                const buttonInfo = financeButtons.find(b => b.custom_id === interaction.customId);

                if (!buttonInfo) {
                    return interaction.editReply({ content: '❌ Button action not found.' });
                }

                const { type, amount, label } = buttonInfo;
                const today = new Date().toISOString().slice(0, 10);

                if (type === 'Expense') {
                    const { account: accountName, category: categoryName } = buttonInfo;

                    const accounts = await actualService.getAccounts();
                    const categories = await actualService.getCategories();

                    const targetAccount = accounts.find(acc => acc.name === accountName);
                    const targetCategory = categories.find(cat => cat.name === categoryName);

                    if (!targetAccount) throw new Error(`Account "${accountName}" not found.`);
                    if (!targetCategory) throw new Error(`Category "${categoryName}" not found.`);

                    const amountInCents = actualService.utils.amountToInteger(-Math.abs(amount));
                    await actualService.addTransactions(targetAccount.id, [{
                        date: today,
                        amount: amountInCents,
                        payee_name: label,
                        category: targetCategory.id,
                        cleared: false,
                    }]);

                    const embed = new EmbedBuilder()
                        .setTitle('💸 Expense Logged')
                        .setDescription(label)
                        .addFields(
                            { name: 'Amount', value: actualService.formatToIDR(Math.abs(amount)), inline: true },
                            { name: 'Account', value: accountName, inline: true },
                            { name: 'Category', value: categoryName, inline: true },
                            { name: 'Date', value: today, inline: true }
                        )
                        .setColor(0xFF0000);
                    await interaction.editReply({ embeds: [embed] });

                } else if (type === 'Transfer') {
                    const { accountFrom, accountTo } = buttonInfo;
                    const accounts = await actualService.getAccounts();

                    const sourceAccount = accounts.find(acc => acc.name === accountFrom);
                    const destinationAccount = accounts.find(acc => acc.name === accountTo);

                    if (!sourceAccount) throw new Error(`Source account "${accountFrom}" not found.`);
                    if (!destinationAccount) throw new Error(`Destination account "${accountTo}" not found.`);

                    const payees = await actualService.getPayees();
                    const transferPayee = payees.find(p => p.transfer_acct === destinationAccount.id);
                    if (!transferPayee) throw new Error(`Transfer payee for "${accountTo}" not found.`);

                    const amountInCents = actualService.utils.amountToInteger(-Math.abs(amount));
                    await actualService.addTransactions(sourceAccount.id, [{
                        date: today,
                        amount: amountInCents,
                        payee: transferPayee.id,
                        notes: label,
                    }], true);

                     const embed = new EmbedBuilder()
                        .setTitle('↔️ Transfer Logged')
                        .setDescription(label)
                        .addFields(
                            { name: 'Amount', value: actualService.formatToIDR(Math.abs(amount)), inline: true },
                            { name: 'From', value: accountFrom, inline: true },
                            { name: 'To', value: accountTo, inline: true },
                            { name: 'Date', value: today, inline: true }
                        )
                        .setColor(0x0000FF);
                    await interaction.editReply({ embeds: [embed] });
                }

            } catch (error) {
                console.error('Quick Action Error:', error);
                await interaction.editReply({ content: `❌ An error occurred: ${error.message}` });
            } finally {
                await actualService.shutdown();
            }
        }
    }
};