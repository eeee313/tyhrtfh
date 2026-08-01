require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags,
} = require('discord.js');
const config = require('./config');
const assetData = require('./assets-data');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers, // needed to pick a random member for !stats
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const SWITCH_PREFIXES = {
  '!values': 'values',
  '!jaces': 'jaces',
};

// Custom IDs of every "for display only" button — always report failure.
const DISPLAY_ONLY_BUTTON_IDS = [
  config.displays.middleman.buttonCustomId,
  ...config.displays.autoCrypto.requests.map((r) => r.customId),
];

function isAdmin(message) {
  if (message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (config.adminUserIds.includes(message.author.id)) return true;
  if (message.member?.roles.cache.some((r) => config.adminRoleIds.includes(r.id))) return true;
  return false;
}

// Allow view but lock sending / threads / reactions for @everyone
function visibleOverwrites(guild) {
  return [
    {
      id: guild.roles.everyone.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
      deny: [
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.CreatePublicThreads,
        PermissionsBitField.Flags.CreatePrivateThreads,
        PermissionsBitField.Flags.SendMessagesInThreads,
        PermissionsBitField.Flags.AddReactions,
      ],
    },
  ];
}

// Hide from @everyone
function hiddenOverwrites(guild) {
  return [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
  ];
}

async function syncProfile(guild, profile) {
  const desiredCategories = new Set(profile.categories.map((c) => c.name));
  const desiredChannels = new Set();
  for (const cat of profile.categories) {
    for (const ch of cat.channels) desiredChannels.add(ch);
  }

  // 1) Hide anything that isn't part of this profile
  for (const ch of guild.channels.cache.values()) {
    if (ch.type === ChannelType.GuildCategory) {
      if (!desiredCategories.has(ch.name)) {
        await ch.permissionOverwrites.set(hiddenOverwrites(guild)).catch(() => {});
      }
    } else if (ch.type === ChannelType.GuildText) {
      if (!desiredChannels.has(ch.name)) {
        await ch.permissionOverwrites.set(hiddenOverwrites(guild)).catch(() => {});
      }
    }
  }

  // 2) Create or unhide categories & channels for this profile
  for (const cat of profile.categories) {
    let category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === cat.name
    );

    if (!category) {
      category = await guild.channels.create({
        name: cat.name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: visibleOverwrites(guild),
      });
    } else {
      await category.permissionOverwrites.set(visibleOverwrites(guild)).catch(() => {});
    }

    for (const chName of cat.channels) {
      let channel = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildText && c.name === chName
      );

      if (!channel) {
        await guild.channels.create({
          name: chName,
          type: ChannelType.GuildText,
          parent: category.id,
          permissionOverwrites: visibleOverwrites(guild),
        });
      } else {
        await channel.permissionOverwrites.set(visibleOverwrites(guild)).catch(() => {});
        if (channel.parentId !== category.id) {
          await channel.setParent(category.id).catch(() => {});
        }
      }
    }
  }
}

async function applyBranding(guild, profile, notifyUser) {
  await guild
    .setName(profile.guildName)
    .catch((e) => console.error('setName failed:', e.message));

  if (profile.icon) {
    const iconData = assetData[profile.icon];
    await guild.setIcon(iconData).catch(async (e) => {
      console.error('setIcon failed:', e.message);
      await notify(notifyUser, `⚠️ Couldn't set the server icon (${e.message}).`);
    });
  }

  await guild.edit({ description: profile.description }).catch(async (e) => {
    console.error('description update failed:', e.message);
    await notify(
      notifyUser,
      `⚠️ Couldn't set the server description (${e.message}). If this server doesn't have "Community" enabled in Server Settings, Discord may block description changes — try enabling Community and running the switch again.`
    );
  });
}

// Changes the BOT'S NICKNAME in this server only (autonick)
async function applyBotNickname(guild, profile, notifyUser) {
  if (!config.botIdentitySwitch || !profile.botName) return;

  const me = guild.members.me;
  if (!me) {
    console.error('guild.members.me not available');
    return;
  }

  await me.setNickname(profile.botName).catch(async (e) => {
    console.error('setNickname failed:', e.message);
    await notify(notifyUser, `⚠️ Couldn't change bot nickname to "${profile.botName}" (${e.message}).`);
  });
}

async function notify(user, text) {
  await user.send(text).catch((e) => console.error('DM to user failed:', e.message));
}

function findChannel(guild, match) {
  return guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name.includes(match)
  );
}

// Prefer an exact channel ID (avoids substring collisions, e.g. '🛒' matching
// both the actual 🛒 channel AND '🛒〢sell-your-items' from the other profile).
// Falls back to name-substring matching if no ID is given or it's not found.
function resolveChannel(guild, spec) {
  if (spec.channelId) {
    const byId = guild.channels.cache.get(spec.channelId);
    if (byId) return byId;
  }
  if (spec.channelMatch) return findChannel(guild, spec.channelMatch);
  return null;
}

async function runJacesAutoPost(guild) {
  const cfg = config.profiles.jaces.autoPost;
  if (!cfg) return;

  const mmChannel = findChannel(guild, cfg.middleman.channelMatch);
  if (mmChannel) await postMiddlemanPanel(mmChannel);

  const autoChannel = findChannel(guild, cfg.autoCrypto.channelMatch);
  if (autoChannel) await postAutoCryptoPanel(autoChannel);

  const tosCryptoChannel = findChannel(guild, cfg.tosCrypto.channelMatch);
  if (tosCryptoChannel) await postMessages(tosCryptoChannel, config.tosCryptoMessages, config.tosUrl);

  const mmTosChannel = findChannel(guild, cfg.mmTos.channelMatch);
  if (mmTosChannel) await postMessages(mmTosChannel, config.mmTosMessages, config.tosUrl);

  const shopChannel = resolveChannel(guild, cfg.shop);
  if (shopChannel) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel(cfg.shop.buttonLabel).setStyle(ButtonStyle.Link).setURL(cfg.shop.inviteUrl)
    );
    await shopChannel.send({ components: [row] }).catch(() => {});
  }

  const serversChannel = findChannel(guild, cfg.serverLinks.channelMatch);
  if (serversChannel) {
    const text = `${cfg.serverLinks.links.join('\n')}\n\n${cfg.serverLinks.note}`;
    await serversChannel.send(text).catch(() => {});
  }
}

async function switchProfile(message, key) {
  const profile = config.profiles[key];
  const guild = message.guild;
  const author = message.author;

  const confirmMsg = await message.reply(
    `⚠️ This will **hide/show channels** to switch this server to **${profile.guildName}**. React ✅ within 15s to confirm.`
  );
  await confirmMsg.react('✅');

  const collected = await confirmMsg
    .awaitReactions({
      filter: (reaction, user) => reaction.emoji.name === '✅' && user.id === author.id,
      max: 1,
      time: 15000,
    })
    .catch(() => null);

  if (!collected || collected.size === 0) {
    await confirmMsg.edit('❌ Switch cancelled (no confirmation).').catch(() => {});
    return;
  }

  await notify(author, `🔄 Switching this server to **${profile.guildName}**... (this may take a bit)`);

  await syncProfile(guild, profile);
  await applyBranding(guild, profile, author);
  await applyBotNickname(guild, profile, author);

  if (key === 'jaces') {
    await runJacesAutoPost(guild);
  }

  await notify(author, `✅ Server switched to **${profile.guildName}**.`);
}

async function postMiddlemanPanel(channel) {
  const d = config.displays.middleman;
  const embed = new EmbedBuilder().setTitle(d.title).setDescription(d.description).setColor(d.color);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(d.buttonCustomId).setLabel(d.buttonLabel).setStyle(ButtonStyle.Primary)
  );
  await channel.send({ embeds: [embed], components: [row] }).catch((e) => console.error('postMiddlemanPanel failed:', e.message));
}

async function postAutoCryptoPanel(channel) {
  const d = config.displays.autoCrypto;
  const feesText = d.fees.map((f) => `• ${f}`).join('\n');

  const infoContainer = new ContainerBuilder().setAccentColor(0x5865f2);

  if (d.tutorialUrl) {
    infoContainer.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${d.title}**`))
        .setButtonAccessory(
          new ButtonBuilder().setLabel('Tutorial').setStyle(ButtonStyle.Link).setURL(d.tutorialUrl)
        )
    );
  } else {
    infoContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${d.title}**`));
  }

  infoContainer
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(d.description))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Fees:**\n${feesText}`));

  const requestContainers = d.requests.map((r) => {
    const accent = r.style === 'success' ? 0x57f287 : 0x5865f2;
    const text = r.note ? `**${r.label}**\n${r.note}` : `**${r.label}**`;
    return new ContainerBuilder()
      .setAccentColor(accent)
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
          .setButtonAccessory(
            new ButtonBuilder()
              .setCustomId(r.customId)
              .setLabel(r.buttonLabel)
              .setStyle(r.style === 'success' ? ButtonStyle.Success : ButtonStyle.Primary)
          )
      );
  });

  const footer = new TextDisplayBuilder().setContent(
    `-# Biggest Trade: #${d.footerChannel} · ${d.footerAmount}`
  );

  await channel
    .send({
      flags: MessageFlags.IsComponentsV2,
      components: [infoContainer, ...requestContainers, footer],
    })
    .catch((e) => console.error('postAutoCryptoPanel failed:', e.message));
}

// Posts a sequence of plain content (+ optional link button) messages, in order.
async function postMessages(channel, messages, fallbackUrl) {
  for (const m of messages) {
    const payload = { content: m.content };
    if (m.button) {
      payload.components = [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel(m.button.label)
            .setStyle(ButtonStyle.Link)
            .setURL(m.button.url || fallbackUrl)
        ),
      ];
    }
    await channel.send(payload).catch(() => {});
  }
}

function rankFor(volume, ranks) {
  let current = ranks[0];
  let next = null;
  for (let i = 0; i < ranks.length; i++) {
    if (volume >= ranks[i].threshold) {
      current = ranks[i];
      next = ranks[i + 1] || null;
    }
  }
  return { current, next };
}

async function postStats(channel, user) {
  const s = config.stats;
  const deals = Math.floor(Math.random() * (s.dealsMax - s.dealsMin + 1)) + s.dealsMin;
  const volume = Math.random() * (s.volumeMax - s.volumeMin) + s.volumeMin;
  const { current, next } = rankFor(volume, s.ranks);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
    .addFields(
      { name: 'Current Rank', value: `${s.emoji} ${current.name} ($${current.threshold.toLocaleString()})` },
      {
        name: 'Next Rank',
        value: next ? `${s.emoji} ${next.name} ($${next.threshold.toLocaleString()})` : 'Max Rank',
      },
      { name: 'Deals Completed', value: `${deals}`, inline: true },
      { name: 'Total USD Volume', value: `$${volume.toFixed(2)}`, inline: true }
    );

  await channel.send({ embeds: [embed] }).catch((e) => console.error('postStats failed:', e.message));
}

async function getStatsPool(guild) {
  const id = config.stats.randomPoolId;

  try {
    await guild.members.fetch();
  } catch (e) {
    console.error('members.fetch failed (check Server Members Intent is enabled):', e.message);
  }

  if (id) {
    const role = guild.roles.cache.get(id);
    if (role && role.members.size > 0) return [...role.members.values()];

    const member = guild.members.cache.get(id);
    if (member) return [member];
  }

  return [...guild.members.cache.values()].filter((m) => !m.user.bot);
}

function randomBetween(min, max, decimals) {
  const val = Math.random() * (max - min) + min;
  return val.toFixed(decimals);
}

function fakeTxId() {
  const hex = () =>
    Array.from({ length: 9 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex()}...${hex()}`;
}

async function postFakeTrade(channel) {
  const currency = config.autopost.currencies[Math.floor(Math.random() * config.autopost.currencies.length)];
  const amount = randomBetween(currency.min, currency.max, 8);
  const usd = randomBetween(currency.usdMin, currency.usdMax, 2);

  const embed = new EmbedBuilder()
    .setTitle('Trade Completed')
    .setColor(0x57f287)
    .addFields(
      { name: `${currency.icon} ${amount} ${currency.symbol} ($${usd} USD)`, value: '\u200b' },
      { name: 'Sender', value: 'Anonymous', inline: true },
      { name: 'Receiver', value: 'Anonymous', inline: true },
      { name: 'Transaction ID', value: fakeTxId() }
    );

  await channel.send({ embeds: [embed] }).catch(() => {});
}

function startAutopostLoop() {
  setInterval(() => {
    for (const guild of client.guilds.cache.values()) {
      const channel = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildText && c.name === config.autopost.channelName
      );
      if (channel) postFakeTrade(channel);
    }
  }, config.autopost.intervalMs);
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const raw = message.content.trim();
  const lower = raw.toLowerCase();

  const switchKey = SWITCH_PREFIXES[lower];
  if (switchKey) {
    if (!isAdmin(message)) {
      await message.reply('You do not have permission to switch the server profile.').catch(() => {});
      return;
    }
    try {
      await switchProfile(message, switchKey);
    } catch (err) {
      console.error(err);
      await notify(message.author, '❌ Something went wrong during the switch. Check the console log.');
    }
    return;
  }

  if (lower.startsWith('+embed')) {
    if (!isAdmin(message)) {
      await message.reply('You do not have permission to do that.').catch(() => {});
      return;
    }
    const text = raw.slice('+embed'.length).trim();
    if (!text) {
      await message.reply('Usage: `+embed <text>`').catch(() => {});
      return;
    }
    const embed = new EmbedBuilder().setDescription(text).setColor(config.embed.color);
    await message.channel.send({ embeds: [embed] }).catch(() => {});
    await message.delete().catch(() => {});
    return;
  }

  if (lower === '!middleman') {
    if (!isAdmin(message)) {
      await message.reply('You do not have permission to do that.').catch(() => {});
      return;
    }
    await postMiddlemanPanel(message.channel);
    return;
  }

  if (lower === '!auto') {
    if (!isAdmin(message)) {
      await message.reply('You do not have permission to do that.').catch(() => {});
      return;
    }
    await postAutoCryptoPanel(message.channel);
    return;
  }

  if (lower === '!send') {
    if (!isAdmin(message)) {
      await message.reply('You do not have permission to do that.').catch(() => {});
      return;
    }
    await postFakeTrade(message.channel);
    return;
  }

  if (lower.startsWith('+say')) {
    if (!isAdmin(message)) {
      await message.reply('You do not have permission to do that.').catch(() => {});
      return;
    }
    const text = raw.slice('+say'.length).trim();
    if (!text) {
      await message.reply('Usage: `+say <text>`').catch(() => {});
      return;
    }
    await message.channel.send(text).catch(() => {});
    await message.delete().catch(() => {});
    return;
  }

  if (lower === '!stats') {
    const target = findChannel(message.guild, config.stats.postChannelMatch);
    if (!target) {
      await message.reply("Couldn't find a #commands channel to post stats in.").catch(() => {});
      return;
    }
    const pool = await getStatsPool(message.guild);
    const member = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    const user = member ? member.user : message.author;
    await postStats(target, user);
    return;
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  if (DISPLAY_ONLY_BUTTON_IDS.includes(interaction.customId)) {
    await interaction
      .reply({ content: '❌ Failed. Please try again later.', ephemeral: true })
      .catch(() => {});
  }
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  startAutopostLoop();
});

client.login(process.env.DISCORD_TOKEN);
