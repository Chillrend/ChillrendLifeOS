require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const commands = [];
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

const isDev = process.env.NODE_ENV === 'development';

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            const commandData = command.data.toJSON();
            // Add 'dev-' prefix if in development and deploying to a guild
            if (isDev && process.argv.includes('--guild')) {
                commandData.name = `dev-${commandData.name}`;
            }
            commands.push(commandData);
        } else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        const isGuild = process.argv.includes('--guild');
        const isClear = process.argv.includes('--clear');

        let route;
        if (isGuild) {
            route = Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID);
        } else {
            route = Routes.applicationCommands(process.env.DISCORD_CLIENT_ID);
        }

        if (isClear) {
            console.log('Clearing application (/) commands.');
            await rest.put(route, { body: [] });
            console.log('Successfully cleared application (/) commands.');
        } else {
            console.log(`Started refreshing ${commands.length} application (/) commands.`);
            const data = await rest.put(
                route,
                { body: commands },
            );
            console.log(`Successfully reloaded ${data.length} application (/) commands.`);
        }
    } catch (error) {
        console.error(error);
    }
})();
