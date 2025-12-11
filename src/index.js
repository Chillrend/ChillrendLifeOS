require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, REST, Routes } = require('discord.js');
const mongoose = require('mongoose');
const express = require('express');
const { google } = require('googleapis');
const User = require('./models/User');

// --- Configuration ---
const PORT = 3000;
const app = express();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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

// --- Database Connection ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// --- Security Middleware ---
const isOwner = (interaction) => {
    return interaction.user.id === process.env.OWNER_ID;
};

// --- Discord Events ---
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
    // Security Check
    if (!isOwner(interaction)) {
        if (interaction.isRepliable()) {
            return interaction.reply({ content: '⛔ Sorry, this bot is private. Access denied.', ephemeral: true });
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error executing this command!', ephemeral: true });
        } else {
            await interaction.reply({ content: 'There was an error executing this command!', ephemeral: true });
        }
    }
});

// --- Express Server for Google Auth ---
const { oauth2Client } = require('./services/googleAuth');

app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('No code provided');

    try {
        const { tokens } = await oauth2Client.getToken(code);
        // Assuming single user bot, we can either hardcode ID or pass it via state in the auth url. 
        // For simplicity in this private bot, we update the OWNER_ID's record.

        await User.findOneAndUpdate(
            { discordId: process.env.OWNER_ID },
            { googleTokens: tokens },
            { upsert: true, new: true }
        );

        res.send('Authentication successful! You can close this window.');
    } catch (error) {
        console.error('Error retrieving access token', error);
        res.status(500).send('Authentication failed');
    }
});

app.listen(PORT, () => {
    console.log(`Auth server running on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
