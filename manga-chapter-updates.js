require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');

const client = new Client({ intents: [GatewayIntentBits.DirectMessages], partials: ['CHANNEL'] });
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// Bot Version
const BOT_VERSION = 'v1.0';

// MangaDex API base URL
const MANGADEX_API = 'https://api.mangadex.org';

// Directory to store individual user manga files
const MANGA_DIR = './manga_data';

// Ensure the directory exists
if (!fs.existsSync(MANGA_DIR)) {
    fs.mkdirSync(MANGA_DIR);
}

// Helper functions for user-specific manga handling
function getUserFilePath(userId) {
    return path.join(MANGA_DIR, `${userId}.json`);
}

function getUserMangaList(userId) {
    const filePath = getUserFilePath(userId);
    if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    return [];
}

function saveUserMangaList(userId, mangaList) {
    const filePath = getUserFilePath(userId);
    fs.writeFileSync(filePath, JSON.stringify(mangaList, null, 2));
}

// Function to fetch manga names for a user
async function fetchUserMangaNames(userId) {
    const mangaList = getUserMangaList(userId);
    const names = [];
    for (const mangaId of mangaList) {
        try {
            const response = await axios.get(`${MANGADEX_API}/manga/${mangaId}`, {
                headers: { Authorization: `Bearer ${process.env.MANGADEX_TOKEN}` },
            });
            names.push(response.data.data.attributes.title.en || 'Unknown Title');
        } catch (error) {
            console.error(`Error fetching name for manga ID ${mangaId}:`, error.message);
            names.push('Unknown Title');
        }
    }
    return names;
}

// Event: On bot ready
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    const commands = [
        {
            name: 'checkupdates',
            description: 'Manually check for manga updates and send them via DM.',
        },
        {
            name: 'version',
            description: 'Display the current version of the bot.',
        },
        {
            name: 'addmanga',
            description: 'Add a new manga URL to track.',
            options: [
                {
                    name: 'url',
                    type: 3,
                    description: 'The MangaDex URL of the manga.',
                    required: true,
                },
            ],
        },
        {
            name: 'removemanga',
            description: 'Remove a manga from tracking.',
            options: [
                {
                    name: 'url',
                    type: 3,
                    description: 'The MangaDex URL of the manga to remove.',
                    required: true,
                },
            ],
        },
        {
            name: 'listmanga',
            description: 'List all tracked manga.',
        },
        {
            name: 'exportmanga',
            description: 'Export your manga tracking list as a file.',
        },
        {
            name: 'importmanga',
            description: 'Import a new manga tracking list from a file.',
            options: [
                {
                    name: 'file',
                    type: 11,
                    description: 'The JSON file to import.',
                    required: true,
                },
            ],
        },
    ];

    try {
        console.log('Refreshing application (/) commands...');
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }
});

// Event: On interaction (for / commands)
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const userId = interaction.user.id;

    if (interaction.commandName === 'checkupdates') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const updates = await fetchUserMangaUpdates(userId);
        if (updates.length === 0) {
            await interaction.followUp('No updates found for your tracked manga.');
            return;
        }
        updates.forEach(async update => {
            await interaction.user.send(
                `**${update.title}** - Chapter ${update.chapter}\nRead here: ${update.link}`
            );
        });
        await interaction.followUp('Checked for updates! Please check your DMs.');
    }

    if (interaction.commandName === 'version') {
        const embed = new EmbedBuilder()
            .setTitle('Manga Tracker')
            .setDescription(`The current version of the bot is **${BOT_VERSION}**.`)
            .setColor(0x3498db);

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (interaction.commandName === 'addmanga') {
        const url = interaction.options.getString('url');
        const mangaIdMatch = url.match(/title\/([a-f0-9-]+)/);

        if (!mangaIdMatch) {
            await interaction.reply({ content: 'Invalid MangaDex URL provided.', flags: MessageFlags.Ephemeral });
            return;
        }

        const mangaId = mangaIdMatch[1];
        const userMangaList = getUserMangaList(userId);

        if (userMangaList.includes(mangaId)) {
            await interaction.reply({ content: 'This manga is already being tracked.', flags: MessageFlags.Ephemeral });
            return;
        }

        userMangaList.push(mangaId);
        saveUserMangaList(userId, userMangaList);

        await interaction.reply({ content: 'Manga added to your tracking list.', flags: MessageFlags.Ephemeral });
    }

    if (interaction.commandName === 'removemanga') {
        const url = interaction.options.getString('url');
        const mangaIdMatch = url.match(/title\/([a-f0-9-]+)/);

        if (!mangaIdMatch) {
            await interaction.reply({ content: 'Invalid MangaDex URL provided.', flags: MessageFlags.Ephemeral });
            return;
        }

        const mangaId = mangaIdMatch[1];
        const userMangaList = getUserMangaList(userId);

        if (!userMangaList.includes(mangaId)) {
            await interaction.reply({ content: 'This manga is not being tracked.', flags: MessageFlags.Ephemeral });
            return;
        }

        const updatedList = userMangaList.filter(id => id !== mangaId);
        saveUserMangaList(userId, updatedList);

        await interaction.reply({ content: 'Manga removed from your tracking list.', flags: MessageFlags.Ephemeral });
    }

    if (interaction.commandName === 'listmanga') {
        const mangaNames = await fetchUserMangaNames(userId);

        if (mangaNames.length === 0) {
            const noMangaEmbed = new EmbedBuilder()
                .setTitle('Tracked Manga')
                .setDescription('You are not tracking any manga.')
                .setColor(0xff0000)
                .setFooter({ text: 'Use /addmanga to start tracking manga!' });

            await interaction.reply({ embeds: [noMangaEmbed], flags: MessageFlags.Ephemeral });
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle('📚 Your Tracked Manga List')
            .setDescription(mangaNames.map((name, index) => `**${index + 1}.** ${name}`).join('\n'))
            .setColor(0x3498db)
            .setFooter({ text: `Total Manga: ${mangaNames.length}` });

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (interaction.commandName === 'exportmanga') {
        const userMangaList = getUserMangaList(userId);

        const fileName = getUserFilePath(userId);
        fs.writeFileSync(fileName, JSON.stringify(userMangaList, null, 2));

        const attachment = new AttachmentBuilder(fileName, { name: 'manga.json' });
        await interaction.user.send({ files: [attachment] });

        await interaction.reply({
            content: 'Your manga tracking list has been exported and sent via DM.',
            flags: MessageFlags.Ephemeral,
        });
    }

    if (interaction.commandName === 'importmanga') {
        const file = interaction.options.getAttachment('file');

        if (!file || !file.name.endsWith('.json')) {
            await interaction.reply({
                content: 'Please provide a valid JSON file with a .json extension.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        try {
            const response = await axios.get(file.url);
            const importedData = response.data;

            if (Array.isArray(importedData) && importedData.every(id => typeof id === 'string')) {
                const userMangaList = getUserMangaList(userId);
                const combinedList = [...new Set([...userMangaList, ...importedData])];
                saveUserMangaList(userId, combinedList);

                await interaction.reply({
                    content: 'Your manga tracking list has been successfully imported!',
                    flags: MessageFlags.Ephemeral,
                });
            } else {
                await interaction.reply({
                    content: 'Invalid file format. Please provide a JSON file containing an array of manga IDs.',
                    flags: MessageFlags.Ephemeral,
                });
            }
        } catch (error) {
            console.error('Error importing file:', error.message);
            await interaction.reply({
                content: 'An error occurred while importing the file. Please try again later.',
                flags: MessageFlags.Ephemeral,
            });
        }
    }
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
