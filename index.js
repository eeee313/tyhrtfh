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
} = require('discord.js');
const config = require('./config');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
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

// Deny talk/react/thread perms for @everyone on a channel
function lockedOverwrites(guild) {
  return [
    {
      id: guild.roles.everyone.id,
      deny: [
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.CreatePublicThreads,
        PermissionsBitField.Flags.CreatePrivateThreads,
        PermissionsBitField.Flags.SendMessagesInThreads,
        PermissionsBitField.Flags.AddReactions,
      ],
      allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
    },
  ];
}

async function wipeGuildChannels(guild) {
  const channels = [...guild.channels.cache.values()];
  for (const ch of channels.filter((c) => c.type !== ChannelType.GuildCategory)) {
    await ch.delete('Server profile switch').catch(() => {});
  }
  for (const ch of channels.filter((c) => c.type === ChannelType.GuildCategory)) {
    await ch.delete('Server profile switch').catch(() => {});
  }
}

async function buildProfile(guild, profile) {
  for (const cat of profile.categories) {
    const category = await guild.channels.create({
      name: cat.name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: cat.locked ? lockedOverwrites(guild) : undefined,
    });

    for (const chName of cat.channels) {
      await guild.channels.create({
        name: chName,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: cat.locked ? lockedOverwrites(guild) : undefined,
      });
    }
  }
}

async function applyBranding(guild, profile, notifyUser) {
  await guild
    .setName(profile.guildName)
    .catch((e) => console.error('setName failed:', e.message));

  if (profile.icon) {
    await guild.setIcon(profile.icon).catch(async (e) => {
      console.error('setIcon failed:', e.message);
      await notify(
        notifyUser,
        `⚠️ Couldn't set the server icon (${e.message}). Make sure \`${profile.icon}\` exists in the repo you deployed.`
      );
    });
  }

  // Guild "description" (Server Settings > Overview) requires the bot to have
  // Manage Server, and on some guilds requires the Community feature to be enabled.
  await guild.edit({ description: profile.description }).catch(async (e) => {
    console.error('description update failed:', e.message);
    await notify(
      notifyUser,
      `⚠️ Couldn't set the server description (${e.message}). If this server doesn't have "Community" enabled in Server Settings, Discord may block description changes — try enabling Community and running the switch again.`
    );
  });
}

// Status updates go to a DM, since the invoking channel gets deleted mid-switch.
async function notify(user, text) {
  await user.send(text).catch((e) => console.error('DM to user failed:', e.message));
}

function findChannel(guild, match) {
  return guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name.includes(match)
  );
}

async function runJacesAutoPost(guild) {
  const cfg = config.profiles.jaces.autoPost;
  if (!cfg) return;

  const mmChannel = findChannel(guild, cfg.middleman.channelMatch);
  if (mmChannel) await postMiddlemanPanel(mmChannel);

  const autoChannel = findChannel(guild, cfg.autoCrypto.channelMatch);
  if (autoChannel) await postAutoCryptoPanel(autoChannel);

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
    `⚠️ This will **delete every channel/category** in this server and rebuild it as **${profile.guildName}**. React ✅ within 15s to confirm.`
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

  await wipeGuildChannels(guild);
  await buildProfile(guild, profile);
  await applyBranding(guild, profile, author);

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
  const requestsText = d.requests
    .map((r) => (r.note ? `**${r.label}**\n${r.note}` : `**${r.label}**`))
    .join('\n\n');

  const embed = new EmbedBuilder()
    .setTitle(d.title)
    .setDescription(`${d.description}\n\n**Fees:**\n${feesText}\n\n${requestsText}`)
    .setColor(d.color)
    .setFooter({ text: `Biggest Trade: #${d.footerChannel} · ${d.footerAmount}` });

  const rows = [];
  if (d.tutorialUrl) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Tutorial').setStyle(ButtonStyle.Link).setURL(d.tutorialUrl)
      )
    );
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      d.requests.map((r) =>
        new ButtonBuilder().setCustomId(r.customId).setLabel(r.buttonLabel).setStyle(ButtonStyle.Success)
      )
    )
  );

  await channel.send({ embeds: [embed], components: rows }).catch((e) => console.error('postAutoCryptoPanel failed:', e.message));
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
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  if (DISPLAY_ONLY_BUTTON_IDS.includes(interaction.customId)) {
    await interaction
      .reply({ content: '❌ Failed. Please try again later.', ephemeral: true })
      .catch(() => {});
  }
});

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
  startAutopostLoop();
});

client.login(process.env.DISCORD_TOKEN);
