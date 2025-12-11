const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('command')
        .setDescription('Lists all available commands.'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('Available Commands')
            .setColor('#0099ff');

        const foldersPath = path.join(__dirname, '..');
        const commandFolders = fs.readdirSync(foldersPath);

        for (const folder of commandFolders) {
            const commandsPath = path.join(foldersPath, folder);
            const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
            
            if (commandFiles.length > 0) {
                const commandList = commandFiles.map(file => {
                    const command = require(path.join(commandsPath, file));
                    return `\`/${command.data.name}\` - ${command.data.description}`;
                }).join('\n');
                embed.addFields({ name: folder.charAt(0).toUpperCase() + folder.slice(1), value: commandList });
            }
        }

        await interaction.reply({ embeds: [embed] });
    },
};
