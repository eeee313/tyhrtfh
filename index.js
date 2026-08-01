require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
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

const PREFIXES = {
  '!values': 'values',
  '!jaces': 'jaces',
};

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
  await guild.setName(profile.guildName).catch((e) => console.error('setName failed:', e.message));

  if (profile.icon) {
    await guild.setIcon(profile.icon).catch((e) => console.error('setIcon failed:', e.message));
  }

  // Guild "description" only applies to Community-enabled servers.
  await guild
    .setDescription(profile.description)
    .catch((e) => console.error('setDescription failed (needs Community feature enabled):', e.message));
}

async function switchProfile(message, key) {
  const profile = config.profiles[key];
  const guild = message.guild;

  const confirmMsg = await message.reply(
    `⚠️ This will **delete every channel/category** in this server and rebuild it as **${profile.guildName}**. React ✅ within 15s to confirm.`
  );
  await confirmMsg.react('✅');

  const collected = await confirmMsg
    .awaitReactions({
      filter: (reaction, user) => reaction.emoji.name === '✅' && user.id === message.author.id,
      max: 1,
      time: 15000,
    })
    .catch(() => null);

  if (!collected || collected.size === 0) {
    await message.channel.send('❌ Switch cancelled (no confirmation).');
    return;
  }

  const status = await message.channel.send(`🔄 Switching to **${profile.guildName}**...`);

  await wipeGuildChannels(guild);
  await buildProfile(guild, profile);
  await applyBranding(guild, profile);

  await status.edit(`✅ Server switched to **${profile.guildName}**.`);
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim().toLowerCase();
  const profileKey = PREFIXES[content];
  if (!profileKey) return;

  if (!isAdmin(message)) {
    await message.reply('You do not have permission to switch the server profile.').catch(() => {});
    return;
  }

  try {
    await switchProfile(message, profileKey);
  } catch (err) {
    console.error(err);
    await message.channel.send('❌ Something went wrong during the switch. Check the console log.');
  }
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
