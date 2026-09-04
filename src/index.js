require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const crypto = require('crypto');
const actualService = require('./services/actualService');
const db = require('./db/database');

// --- Configuration ---
const PORT = process.env.PORT || 3000;
const app = express();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const isDev = process.env.NODE_ENV === 'development';

// Setup Express view engine and parser middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

client.commands = new Collection();
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        } else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

// Helper to generate secure validation tokens
const generateToken = (id) => {
  return crypto
    .createHmac('sha256', process.env.DISCORD_CLIENT_SECRET || 'fallback_secret')
    .update(id)
    .digest('hex');
};

// --- Security Middleware ---
const isOwner = (interaction) => {
    return interaction.user.id === process.env.OWNER_ID;
};

// --- Discord Events ---
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
    // Initialize the automated task cron job scheduler
    require('./jobs/scheduler')(client);
});

client.on('interactionCreate', async interaction => {
    // Security Check
    if (!isOwner(interaction)) {
        if (interaction.isRepliable()) {
            return interaction.reply({ content: '⛔ Private bot. Access denied.', ephemeral: true });
        }
        return;
    }

    // 1. Handle Slash Commands & Autocomplete
    if (interaction.isChatInputCommand() || interaction.isAutocomplete()) {
        let commandName = interaction.commandName;
        if (isDev && commandName.startsWith('dev-')) commandName = commandName.slice(4);

        const command = client.commands.get(commandName);
        if (!command) return;

        try {
            if (interaction.isAutocomplete()) await command.autocomplete(interaction);
            else await command.execute(interaction);
        } catch (error) {
            console.error(error);
            const msg = { content: 'Error executing command!', ephemeral: true };
            interaction.replied || interaction.deferred ? await interaction.followUp(msg) : await interaction.reply(msg);
        }
        return;
    }

    // 2. Handle Transaction Action Buttons (Accept, Deny, Modify)
    if (interaction.isButton() && interaction.customId.startsWith('tx_')) {
        const parts = interaction.customId.split('_');
        const action = parts[1]; // accept, deny, modify
        const txnId = parts.slice(2).join('_');

        const txn = db.getTransaction(txnId);
        if (!txn) {
            return interaction.reply({ content: '❌ Transaction not found.', ephemeral: true });
        }

        if (txn.status !== 'pending') {
            return interaction.reply({ content: `⚠️ This transaction has already been processed (Status: ${txn.status}).`, ephemeral: true });
        }

        if (action === 'accept') {
            await interaction.deferUpdate();
            try {
                // Log to Actual Budget using our flexible centralized helper
                await actualService.init();
                await actualService.createActualTransaction(txn.payload);

                db.updateTransactionStatus(txnId, 'accepted');

                const embed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0x00FF00) // Green
                    .setTitle('✅ Transaction Accepted & Logged')
                    .setDescription('This transaction has been approved and logged to Actual Budget.');

                await interaction.editReply({ embeds: [embed], components: [] });

            } catch (error) {
                console.error('Accept Error:', error);
                await interaction.followUp({ content: `❌ Error logging transaction: ${error.message}`, ephemeral: true });
            } finally {
                await actualService.shutdown();
            }

        } else if (action === 'deny') {
            await interaction.deferUpdate();
            db.updateTransactionStatus(txnId, 'denied');

            const embed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0xFF0000) // Red
                .setTitle('❌ Transaction Denied')
                .setDescription('This transaction was denied and logged internally in the database.');

            await interaction.editReply({ embeds: [embed], components: [] });

        } else if (action === 'modify') {
            const token = generateToken(txnId);
            const url = `${process.env.APP_BASE_URL || 'http://localhost:3000'}/finance/modify?id=${txnId}&token=${token}`;

            await interaction.reply({
                content: `✏️ Click the link below to modify this transaction in your browser:\n[Modify Transaction](${url})`,
                ephemeral: true
            });
        }
        return;
    }

    // 3. Handle dashboard components (Quick Action, select menu & buttons)
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
        const command = client.commands.get('quick-action');
        if (!command) return;

        try {
            await command.handleComponent(interaction);
        } catch (error) {
            console.error('Component Error:', error);
        }
    }
});

// --- Register Express Routes ---
app.use('/', require('./routes/finance')(client));

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
