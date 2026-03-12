const fs = require('fs');
const { randomUUID } = require('crypto');
const schedule = require('node-schedule');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  EmbedBuilder,
  AttachmentBuilder,
  MessageFlags,
  ActivityType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const {
  BOT_VERSION,
  MIN_AUTO_CHECK_HOURS,
  MAX_AUTO_CHECK_HOURS,
  PENDING_ACTION_TTL_MS,
} = require('../config');

function createDiscordBot({ service, discordToken }) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages], partials: ['CHANNEL'] });
  const rest = new REST({ version: '10' }).setToken(discordToken);
  const pendingFallbackActions = new Map();
  let autoCheckJob = null;

  function listConnectedGuilds() {
    return Array.from(client.guilds.cache.values())
      .map((guild) => ({
        id: String(guild.id || '').trim(),
        name: String(guild.name || '').trim() || String(guild.id || '').trim(),
      }))
      .filter((guild) => guild.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function resolveUsers(userIds) {
    const ids = Array.from(
      new Set(
        (Array.isArray(userIds) ? userIds : [])
          .map((userId) => String(userId || '').trim())
          .filter((userId) => /^\d+$/.test(userId))
      )
    );
    const resolved = {};

    await Promise.all(
      ids.map(async (userId) => {
        try {
          const user = await client.users.fetch(userId);
          resolved[userId] = String(user?.globalName || user?.username || userId).trim() || userId;
        } catch {
          resolved[userId] = userId;
        }
      })
    );

    return resolved;
  }

  function pruneExpiredPendingFallbacks() {
    const now = Date.now();
    for (const [token, action] of pendingFallbackActions.entries()) {
      if (now - action.createdAt > PENDING_ACTION_TTL_MS) {
        pendingFallbackActions.delete(token);
      }
    }
  }

  function storePendingFallbackAction(action) {
    pruneExpiredPendingFallbacks();
    const token = randomUUID();
    pendingFallbackActions.set(token, { ...action, createdAt: Date.now() });
    return token;
  }

  function getPendingFallbackAction(token) {
    pruneExpiredPendingFallbacks();
    return pendingFallbackActions.get(token) || null;
  }

  function clearPendingFallbackAction(token) {
    pendingFallbackActions.delete(token);
  }

  function buildFallbackActionRow(token) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`fallback_yes:${token}`).setLabel('Search Other Sources').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`fallback_no:${token}`).setLabel('No').setStyle(ButtonStyle.Secondary)
    );
  }

  function buildPreferredSourceSelectRow(userId, preferredSource) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`preferred_source_select:${userId}`)
      .setPlaceholder('Select your preferred source')
      .addOptions(
        service.getSources().sources.map((source) => ({
          label: source.displayName,
          value: source.key,
          default: source.key === preferredSource,
        }))
      );

    return new ActionRowBuilder().addComponents(menu);
  }

  function buildSearchResultsEmbed(query, sourceKey, results) {
    const sourceLabel = service.getSourceDisplayName(sourceKey);
    const lines = results.map((manga, index) => `**${index + 1}.** ${manga.title}\nID: \`${manga.mangaId}\`\n${manga.link}`);

    return new EmbedBuilder()
      .setTitle(`Search Results (${sourceLabel}): ${query}`)
      .setDescription(lines.join('\n\n'))
      .setColor(0x3498db);
  }

  function formatUpdateLine(update, index) {
    const chapterSuffix = update.chapterTitle ? ` - ${update.chapterTitle}` : '';
    const sourceSuffix = update.source ? ` (${service.getSourceDisplayName(update.source)})` : '';
    return `**${index + 1}. [${update.title}](<${update.link}>)**${sourceSuffix} - Chapter ${update.chapter}${chapterSuffix}`;
  }

  function buildUpdatesEmbed(updates, title = '📖 Manga Updates') {
    return new EmbedBuilder()
      .setTitle(title)
      .setColor(0x3498db)
      .setDescription(updates.map(formatUpdateLine).join('\n'))
      .setFooter({ text: `Total updates: ${updates.length}` });
  }

  function buildNoUpdatesEmbed() {
    return new EmbedBuilder()
      .setTitle('No Updates Found')
      .setDescription('No new chapters.')
      .setColor(0xff0000)
      .setFooter({ text: 'Check back later for updates!' });
  }

  async function executeFallbackAction(action) {
    if (action.type === 'search') {
      for (const sourceKey of action.sourceKeys) {
        const results = await service.searchMangaOnSource(sourceKey, action.query, 5);
        if (results.length > 0) {
          return {
            content: `Showing results from ${service.getSourceDisplayName(sourceKey)}.`,
            embeds: [buildSearchResultsEmbed(action.query, sourceKey, results)],
          };
        }
      }

      return { content: `No results found for "${action.query}" in other sources.` };
    }

    if (action.type === 'add') {
      for (const sourceKey of action.sourceKeys) {
        const target = await service.findMangaTargetOnSource(sourceKey, action.input);
        if (!target) continue;

        const result = await service.addTrackedTarget(action.userId, target);
        if (result.status === 'already_tracked') {
          return { content: `This manga is already being tracked on ${service.getSourceDisplayName(sourceKey)}.` };
        }
        if (result.status === 'added') {
          return { content: `Now tracking **${result.title}** from ${service.getSourceDisplayName(result.source)}.` };
        }
      }

      return { content: `No results found for "${action.input}" in other sources.` };
    }

    if (action.type === 'remove') {
      const userData = service.getUserData(action.userId);
      for (const sourceKey of action.sourceKeys) {
        const entry = service.findTrackedEntryByInput(userData, action.input, sourceKey);
        if (!entry) continue;

        userData.tracked = userData.tracked.filter((candidate) => !service.isSameTrackedTarget(candidate, entry));
        service.saveUserData(action.userId, userData);
        return { content: `Removed **${entry.title || entry.mangaId}** from ${service.getSourceDisplayName(entry.source)}.` };
      }

      return { content: 'This manga is not currently tracked in other sources.' };
    }

    if (action.type === 'checkupdates') {
      const updates = await service.buildUserUpdates(action.userId, { sources: action.sourceKeys });
      if (updates.length === 0) {
        return { embeds: [buildNoUpdatesEmbed()], content: 'No updates found in other sources.' };
      }

      return { embeds: [buildUpdatesEmbed(updates, '📖 Manga Updates (Other Sources)')] };
    }

    return { content: 'Unsupported fallback action.' };
  }

  client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    client.user.setPresence({
      activities: [{ name: 'Reading manga', type: ActivityType.Playing }],
      status: 'online',
    });

    const commands = [
      { name: 'checkupdates', description: 'Check for new chapters across your tracked manga.' },
      {
        name: 'setautocheck',
        description: 'Set auto-check interval in hours (6 to 168).',
        options: [{ name: 'hours', type: 4, description: 'Hours between auto checks', required: true }],
      },
      { name: 'preferredsource', description: 'Choose your preferred manga source for searches and fallbacks.' },
      { name: 'version', description: 'Display the current version of the bot.' },
      {
        name: 'searchmanga',
        description: 'Search manga using your preferred source.',
        options: [{ name: 'query', type: 3, description: 'Manga title to search for', required: true }],
      },
      {
        name: 'addmanga',
        description: `Add a manga URL/ID from ${service.getSupportedSourcesLabel()}.`,
        options: [{ name: 'url_or_id', type: 3, description: 'Manga URL or MangaDex UUID', required: true }],
      },
      {
        name: 'removemanga',
        description: `Remove a tracked manga from ${service.getSupportedSourcesLabel()}.`,
        options: [{ name: 'url_or_id', type: 3, description: 'Manga URL or MangaDex UUID', required: true }],
      },
      { name: 'listmanga', description: 'List all manga you are currently tracking.' },
      { name: 'exportmanga', description: 'Export your manga tracking list as JSON.' },
      {
        name: 'importmanga',
        description: 'Import your manga tracking list from a JSON file.',
        options: [{ name: 'file', type: 11, description: 'JSON file to import', required: true }],
      },
    ];

    try {
      console.log('Refreshing application (/) commands...');
      await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
      console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
      console.error('Error registering slash commands:', error.message);
    }

    if (autoCheckJob) {
      autoCheckJob.cancel();
      autoCheckJob = null;
    }

    autoCheckJob = schedule.scheduleJob('*/30 * * * *', async () => {
      console.log('Running scheduled auto-check sweep...');
      await service.runAutoCheckSweep(async (userId, updates) => {
        const user = await client.users.fetch(userId);
        const embed = buildUpdatesEmbed(updates, '📬 Auto Manga Updates');
        await user.send({ embeds: [embed] });
      });
    });
  });

  client.on('interactionCreate', async (interaction) => {
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('preferred_source_select:')) {
      const targetUserId = interaction.customId.split(':')[1];
      if (interaction.user.id !== targetUserId) {
        await interaction.reply({
          content: 'This source picker belongs to another user.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const selectedSource = interaction.values?.[0];
      if (!service.getSources().sources.some((source) => source.key === selectedSource)) {
        await interaction.update({
          content: 'Invalid source selection.',
          components: [],
        });
        return;
      }

      await interaction.deferUpdate();

      try {
        const summary = await service.migrateTrackedEntriesToSource(interaction.user.id, selectedSource);
        const sourceLabel = service.getSourceDisplayName(selectedSource);

        let content = `Preferred source set to **${sourceLabel}**.`;
        if (summary.totalConsidered > 0) {
          content += ` Auto-migration complete: **${summary.migratedCount}** migrated`;
          if (summary.dedupedCount > 0) {
            content += `, **${summary.dedupedCount}** merged as duplicates`;
          }
          if (summary.failedCount > 0) {
            content += `, **${summary.failedCount}** left in their original source`;
          }
          content += '.';
        }

        await interaction.editReply({
          content,
          components: [buildPreferredSourceSelectRow(interaction.user.id, selectedSource)],
        });
      } catch (error) {
        console.error('Error migrating tracked manga during source change:', error.message);
        await interaction.editReply({
          content: 'Could not migrate your manga list right now. Your preferred source was not changed.',
          components: [],
        });
      }
      return;
    }

    if (interaction.isButton() && (interaction.customId.startsWith('fallback_yes:') || interaction.customId.startsWith('fallback_no:'))) {
      const [decision, token] = interaction.customId.split(':');
      const pendingAction = getPendingFallbackAction(token);
      if (!pendingAction) {
        await interaction.update({
          content: 'This fallback prompt has expired. Run the command again.',
          components: [],
        });
        return;
      }

      if (pendingAction.userId !== interaction.user.id) {
        await interaction.reply({
          content: 'This fallback prompt belongs to another user.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      clearPendingFallbackAction(token);

      if (decision === 'fallback_no') {
        await interaction.update({
          content: 'Okay, keeping the search limited to your preferred source.',
          components: [],
        });
        return;
      }

      await interaction.deferUpdate();
      try {
        const result = await executeFallbackAction(pendingAction);
        await interaction.editReply({
          content: result.content || null,
          embeds: result.embeds || [],
          components: [],
        });
      } catch (error) {
        console.error('Error executing fallback action:', error.message);
        await interaction.editReply({
          content: 'Could not search other sources right now. Please try again.',
          components: [],
        });
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const userId = interaction.user.id;
    const username = interaction.user.username;
    service.migrateLegacyUsernameFile(userId, username);

    if (interaction.commandName === 'checkupdates') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const userData = service.getUserData(userId);
        const preferredSource = service.getPreferredSource(userData);
        const otherSources = service.getOtherSources(preferredSource).filter((sourceKey) =>
          userData.tracked.some((entry) => entry.source === sourceKey)
        );
        const updates = await service.buildUserUpdates(userId, { sources: [preferredSource] });
        if (updates.length === 0) {
          if (otherSources.length > 0) {
            const token = storePendingFallbackAction({
              type: 'checkupdates',
              userId,
              sourceKeys: otherSources,
            });
            await interaction.followUp({
              content: `No updates found in your preferred source (${service.getSourceDisplayName(preferredSource)}). Search other sources?`,
              components: [buildFallbackActionRow(token)],
            });
            return;
          }

          await interaction.followUp({ embeds: [buildNoUpdatesEmbed()] });
          return;
        }

        await interaction.followUp({ embeds: [buildUpdatesEmbed(updates)] });
      } catch (error) {
        console.error('Error checking updates:', error.message);
        await interaction.followUp({
          embeds: [
            new EmbedBuilder()
              .setTitle('Error')
              .setDescription('An error occurred while checking updates. Please try again later.')
              .setColor(0xff0000),
          ],
        });
      }
      return;
    }

    if (interaction.commandName === 'setautocheck') {
      const hours = interaction.options.getInteger('hours', true);
      if (hours < MIN_AUTO_CHECK_HOURS || hours > MAX_AUTO_CHECK_HOURS) {
        await interaction.reply({
          content: `Please choose a value between ${MIN_AUTO_CHECK_HOURS} and ${MAX_AUTO_CHECK_HOURS} hours.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const userData = service.getUserData(userId);
      userData.autoCheckIntervalHours = hours;
      userData.lastAutoCheckAt = new Date().toISOString();
      service.saveUserData(userId, userData);

      await interaction.reply({
        content: `Auto-check interval set to every **${hours} hour(s)**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.commandName === 'preferredsource') {
      const userData = service.getUserData(userId);
      const preferredSource = service.getPreferredSource(userData);
      await interaction.reply({
        content: `Your current preferred source is **${service.getSourceDisplayName(preferredSource)}**. Choose a new one:`,
        components: [buildPreferredSourceSelectRow(userId, preferredSource)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.commandName === 'version') {
      await interaction.reply({
        embeds: [new EmbedBuilder().setTitle('Manga Tracker').setDescription(`**${BOT_VERSION}**`).setColor(0x3498db)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.commandName === 'searchmanga') {
      const query = interaction.options.getString('query', true).trim();
      const userData = service.getUserData(userId);
      const preferredSource = service.getPreferredSource(userData);
      const otherSources = service.getOtherSources(preferredSource);

      try {
        const results = await service.searchMangaOnSource(preferredSource, query, 5);
        if (results.length === 0) {
          const token = storePendingFallbackAction({
            type: 'search',
            userId,
            query,
            sourceKeys: otherSources,
          });
          await interaction.reply({
            content: `No results found in ${service.getSourceDisplayName(preferredSource)} for "${query}". Search other sources?`,
            components: [buildFallbackActionRow(token)],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.reply({
          embeds: [buildSearchResultsEmbed(query, preferredSource, results)],
          flags: MessageFlags.Ephemeral,
        });
      } catch (error) {
        console.error('Error searching manga:', error.message);
        await interaction.reply({
          content: `Unable to search ${service.getSourceDisplayName(preferredSource)} right now. Please try again later.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (interaction.commandName === 'addmanga') {
      const input = interaction.options.getString('url_or_id', true);
      const userData = service.getUserData(userId);
      const preferredSource = service.getPreferredSource(userData);
      const otherSources = service.getOtherSources(preferredSource);

      try {
        let target = service.extractMangaTarget(input);
        if (!target) {
          target = await service.findMangaTargetOnSource(preferredSource, input);
        }

        if (!target) {
          const token = storePendingFallbackAction({
            type: 'add',
            userId,
            input,
            sourceKeys: otherSources,
          });
          await interaction.reply({
            content: `No results found in ${service.getSourceDisplayName(preferredSource)}. Search other sources?`,
            components: [buildFallbackActionRow(token)],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const result = await service.addTrackedTarget(userId, target);
        if (result.status === 'already_tracked') {
          await interaction.reply({ content: 'This manga is already being tracked.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (result.status === 'not_found') {
          const token = storePendingFallbackAction({
            type: 'add',
            userId,
            input,
            sourceKeys: otherSources,
          });
          await interaction.reply({
            content: `No results found in ${service.getSourceDisplayName(preferredSource)}. Search other sources?`,
            components: [buildFallbackActionRow(token)],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.reply({
          content: `Now tracking **${result.title}** from ${service.getSourceDisplayName(result.source)}.`,
          flags: MessageFlags.Ephemeral,
        });
      } catch (error) {
        console.error('Error adding manga:', error.message);
        await interaction.reply({
          content: 'Could not add this manga right now. Please try again later.',
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (interaction.commandName === 'removemanga') {
      const input = interaction.options.getString('url_or_id', true);
      const userData = service.getUserData(userId);
      const preferredSource = service.getPreferredSource(userData);
      const otherSources = service.getOtherSources(preferredSource).filter((sourceKey) =>
        userData.tracked.some((entry) => entry.source === sourceKey)
      );
      let entry = service.findTrackedEntryByInput(userData, input, preferredSource);
      if (!entry) {
        const directTarget = service.extractMangaTarget(input);
        if (directTarget) {
          entry = userData.tracked.find((candidate) => service.isSameTrackedTarget(candidate, directTarget)) || null;
        }
      }

      if (!entry) {
        if (otherSources.length > 0) {
          const token = storePendingFallbackAction({
            type: 'remove',
            userId,
            input,
            sourceKeys: otherSources,
          });
          await interaction.reply({
            content: `No tracked match found in ${service.getSourceDisplayName(preferredSource)}. Search other sources?`,
            components: [buildFallbackActionRow(token)],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.reply({ content: 'This manga is not currently tracked.', flags: MessageFlags.Ephemeral });
        return;
      }

      userData.tracked = userData.tracked.filter((candidate) => !service.isSameTrackedTarget(candidate, entry));
      service.saveUserData(userId, userData);

      await interaction.reply({
        content: `Removed **${entry.title || entry.mangaId}** from ${service.getSourceDisplayName(entry.source)}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.commandName === 'listmanga') {
      const userData = service.getUserData(userId);
      const preferredSource = service.getPreferredSource(userData);
      const preferredSourceEntries = userData.tracked.filter((entry) => entry.source === preferredSource);

      if (userData.tracked.length === 0) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle('Tracked Manga')
              .setDescription('You are not tracking any manga.')
              .setColor(0xff0000)
              .setFooter({ text: 'Use /addmanga to start tracking.' }),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (preferredSourceEntries.length === 0) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle('📚 Your Tracked Manga List')
              .setDescription(
                `You are not tracking any manga in **${service.getSourceDisplayName(preferredSource)}**.\nUse /addmanga while this is your preferred source to add entries here.`
              )
              .setColor(0xff9900)
              .setFooter({ text: `Tracked in other sources: ${userData.tracked.length}` }),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      let changed = false;
      const names = [];
      for (const entry of preferredSourceEntries) {
        const hadTitle = Boolean(entry.title);
        const title = await service.resolveTrackedMangaTitle(entry);
        if (!hadTitle && entry.title) changed = true;
        names.push(title);
      }

      if (changed) {
        service.saveUserData(userId, userData);
      }

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('📚 Your Tracked Manga List')
            .setColor(0x3498db)
            .setDescription(
              preferredSourceEntries
                .map((entry, index) => `**${index + 1}.** ${names[index]} (${service.getSourceDisplayName(entry.source)})`)
                .join('\n')
            )
            .setFooter({
              text: `Preferred source: ${service.getSourceDisplayName(preferredSource)} • Total manga: ${names.length}`,
            }),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.commandName === 'exportmanga') {
      const userData = service.getUserData(userId);

      if (userData.tracked.length === 0) {
        await interaction.reply({
          content: 'Your manga tracking list is empty. Nothing to export.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const fileName = `${service.sanitizeUsername(username)}_manga.json`;
      fs.writeFileSync(fileName, JSON.stringify(userData, null, 2));

      const attachment = new AttachmentBuilder(fileName, { name: fileName });
      await interaction.user.send({ files: [attachment] });
      fs.unlinkSync(fileName);

      await interaction.reply({
        content: 'Your manga tracking list has been exported and sent via DM.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.commandName === 'importmanga') {
      const file = interaction.options.getAttachment('file');

      if (!file || !file.name.toLowerCase().endsWith('.json')) {
        await interaction.reply({
          content: 'Please provide a valid JSON file with a .json extension.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      try {
        const importedRaw = await service.downloadImportedJson(file);
        const imported = service.normalizeUserData(importedRaw);

        if (!Array.isArray(imported.tracked)) {
          await interaction.reply({
            content: 'Invalid format. File must contain manga IDs or a tracked object.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const existing = service.getUserData(userId);
        const map = new Map();

        for (const entry of existing.tracked) {
          map.set(service.getTrackedEntryKey(entry), entry);
        }

        for (const entry of imported.tracked) {
          const key = service.getTrackedEntryKey(entry);
          if (!map.has(key)) {
            map.set(key, entry);
          }
        }

        service.saveUserData(userId, {
          version: 3,
          autoCheckIntervalHours: existing.autoCheckIntervalHours,
          lastAutoCheckAt: existing.lastAutoCheckAt,
          preferredSource: existing.preferredSource,
          tracked: Array.from(map.values()),
        });
        await interaction.reply({
          content: 'Your manga tracking list has been successfully imported.',
          flags: MessageFlags.Ephemeral,
        });
      } catch (error) {
        console.error('Error importing file:', error.message);
        await interaction.reply({
          content: 'Could not import that file. Please re-upload the JSON and try again.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  });

  return {
    start: async () => client.login(discordToken),
    listConnectedGuilds,
    resolveUsers,
    stop: async () => {
      if (autoCheckJob) {
        autoCheckJob.cancel();
        autoCheckJob = null;
      }
      client.destroy();
    },
  };
}

module.exports = {
  createDiscordBot,
};
