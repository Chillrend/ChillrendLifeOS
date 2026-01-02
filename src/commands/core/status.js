const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const os = require('node:os');
const process = require('node:process');

// Helper function to format bytes into a readable string
const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Helper function to format seconds into a readable uptime string
const formatUptime = (seconds) => {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor(seconds % (3600 * 24) / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    const s = Math.floor(seconds % 60);
    return `${d}d ${h}h ${m}m ${s}s`;
};

// Helper function to find the primary non-internal IPv4 address
const getIpAddress = () => {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip over internal (e.g., 127.0.0.1) and non-IPv4 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'Not Found';
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Displays runtime information about the bot.'),
    async execute(interaction) {
        // Get CPU load average (1, 5, and 15 minutes)
        const cpuLoad = os.loadavg().map(load => load.toFixed(2)).join(', ');

        // Get memory usage
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const memUsagePercent = Math.round((usedMem / totalMem) * 100);

        const embed = new EmbedBuilder()
            .setTitle('Bot Status & Runtime Info')
            .setColor('#0099ff')
            .addFields(
                { name: 'Hostname', value: `\`${os.hostname()}\``, inline: true },
                { name: 'IP Address', value: `\`${getIpAddress()}\``, inline: true },
                { name: 'Node.js Version', value: `\`${process.version}\``, inline: true },
                { name: 'Platform', value: `\`${os.platform()} ${os.release()}\``, inline: false },
                { name: 'CPU Load (1m, 5m, 15m)', value: `\`${cpuLoad}\``, inline: false },
                { name: 'Memory Usage', value: `\`${formatBytes(usedMem)} / ${formatBytes(totalMem)} (${memUsagePercent}%)\``, inline: false },
                { name: 'Bot Uptime', value: `\`${formatUptime(process.uptime())}\``, inline: true },
                { name: 'System Uptime', value: `\`${formatUptime(os.uptime())}\``, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'Disk usage information is not available via standard Node.js modules.' });

        await interaction.reply({ embeds: [embed] });
    },
};
