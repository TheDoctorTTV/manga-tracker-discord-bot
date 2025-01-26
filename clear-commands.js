require('dotenv').config();
const { REST, Routes } = require('discord.js');

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

const clearCommands = async () => {
    try {
        console.log('Deleting all global commands...');
        await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: [] });

        console.log('Deleting all guild-specific commands...');
        const guildId = process.env.DISCORD_GUILD_ID;
        await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId), { body: [] });

        console.log('All commands cleared successfully.');
    } catch (error) {
        console.error('Error clearing commands:', error);
    }
};

clearCommands();
