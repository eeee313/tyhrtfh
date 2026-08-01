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
  ...config.displays.autoCrypto.buttons.map((b) => b.customId),
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
  // delete text/voice channels first, then categories, to avoid orphan errors
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

async function applyBranding(guild, profile) {
  await guild
    .setName(profile.guildName)
    .catch((e) => console.error('setName failed:', e.message));

  if (profile.icon) {
    await guild.setIcon(profile.icon).catch((e) => console.error('setIcon failed:', e.message));
  }

  // Description only applies to Community-enabled servers; set via guild.edit(), not a setDescription() method.
  await guild
    .edit({ description: profile.description })
    .catch((e) => console.error('description update failed (needs Community feature enabled):', e.message));
}

// Status updates go to a DM, since the invoking channel gets deleted mid-switch.
async function notify(user, text) {
  await user.send(text).catch((e) => console.error('DM to user failed:', e.message));
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
  await applyBranding(guild, profile);

  await notify(author, `✅ Server switched to **${profile.guildName}**.`);
}

async function postMiddlemanPanel(channel) {
  const d = config.displays.middleman;
  const embed = new EmbedBuilder().setTitle(d.title).setDescription(d.description).setColor(d.color);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(d.buttonCustomId).setLabel(d.buttonLabel).setStyle(ButtonStyle.Primary)
  );
  await channel.send({ embeds: [embed], components: [row] });
}

async function postAutoCryptoPanel(channel) {
  const d = config.displays.autoCrypto;
  const feesText = d.fees.map((f) => `• ${f}`).join('\n');
  const embed = new EmbedBuilder()
    .setTitle(d.title)
    .setDescription(`${d.description}\n\n**Fees:**\n${feesText}`)
    .setColor(d.color)
    .setFooter({ text: `Biggest Trade: #${d.footerChannel} · ${d.footerAmount}` });
  const row = new ActionRowBuilder().addComponents(
    d.buttons.map((b) => new ButtonBuilder().setCustomId(b.customId).setLabel(b.label).setStyle(ButtonStyle.Success))
  );
  await channel.send({ embeds: [embed], components: [row] });
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

  // Server profile switch
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

  // +embed <text> -> posts an embed with that text
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

  // !middleman -> posts the display-only middleman panel
  if (lower === '!middleman') {
    if (!isAdmin(message)) {
      await message.reply('You do not have permission to do that.').catch(() => {});
      return;
    }
    await postMiddlemanPanel(message.channel);
    return;
  }

  // !auto -> posts the display-only auto crypto panel
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
