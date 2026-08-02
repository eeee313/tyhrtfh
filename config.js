module.exports = {
  adminRoleIds: [],
  adminUserIds: [],

  botIdentitySwitch: true,
  // Role that gets renamed to match the active profile's bot name.
  botRoleId: '1527832011505401936',

  profiles: {
    values: {
      key: 'values',
      guildName: 'RoValues',
      icon: 'rovalues',
      botName: 'RoValues BOT',
      botIcon: 'rovalues',
      description:
        'RoValues is your trusted source for accurate Roblox market values. Track item prices, discover trends, and stay ahead with reliable valuations for your favorite games.',
      categories: [
        {
          name: '⤿ Info',
          locked: true,
          channels: ['📰〢news', '📕〢rules', '🚫〢scam-awareness', '🎁〢giveaways'],
        },
        {
          name: '⤿ Values',
          locked: true,
          channels: ['💸〢sab-values', '🐱〢adm-values', '🔪〢mm2-values', '🌱〢gag-values'],
        },
        {
          name: '⤿ Trade Your Items',
          locked: true,
          channels: ['🛒〢sell-your-items', '🛍️〢buying-your-items'],
        },
      ],
    },

    jaces: {
      key: 'jaces',
      guildName: 'Jaces MM Services',
      icon: 'jaces',
      botName: 'Jaces Middleman BOT',
      botIcon: 'jaces',
      description: 'https://jaces.xyz/',
      categories: [
        {
          name: 'Important',
          locked: true,
          channels: [
            '๑˚・╭╴rules',
            '๑˚・｜╴updates',
            '๑˚・｜╴client-giveaways',
            '๑˚・｜╴servers',
            '๑˚・｜╴boosts',
          ],
        },
        {
          name: 'Middleman request',
          locked: true,
          channels: ['╭╴╴mm-req', '╰╴╴mm-tos', '👑╴clients-lb'],
        },
        {
          name: 'auto crypto',
          locked: true,
          channels: ['auto-crypto', 'tos-crypto', 'completed-crypto'],
        },
        {
          name: 'Social',
          locked: true,
          channels: ['chat', 'commands', '🛒'],
        },
      ],
      autoPost: {
        middleman: { channelMatch: 'mm-req' },
        autoCrypto: { channelMatch: 'auto-crypto' },
        tosCrypto: { channelMatch: 'tos-crypto' },
        mmTos: { channelMatch: 'mm-tos' },
        shop: {
          channelId: '1533260656801878196', // explicit ID — avoids matching '🛒〢sell-your-items' from the other profile
          channelMatch: '🛒', // fallback only, used if the ID isn't found
          inviteUrl: 'https://discord.gg/jacemarket',
          buttonLabel: 'Join 🛒',
        },
        serverLinks: {
          channelMatch: 'servers',
          links: ['https://discord.gg/8ueB68BGqn', 'https://discord.gg/fQbPUNvCFx'],
          note: 'ALL LINKS CAN BE FOUND IN https://jaces.xyz/',
        },
      },
    },
  },

  embed: {
    color: 0x5865f2,
  },

  displays: {
    middleman: {
      title: 'Middleman Service',
      color: 0x5865f2,
      description:
        '↳ To request a middleman from this server, click the blue "Request Middleman" button on this message.\n\n' +
        '__**How does middleman work?**__\n' +
        '✕ Example: Trade is NFR Crow for Robux.\n' +
        '1. Seller gives NFR Crow to middleman\n' +
        '2. Buyer pays seller robux (After middleman confirms receiving pet)\n' +
        '3. Middleman gives buyer NFR Crow (After seller confirmed receiving robux)\n\n' +
        '__**NOTES:**__\n' +
        '1. You must both agree on the deal before using a middleman. Troll tickets will have consequences.\n' +
        '2. Specify what you\'re trading (e.g. FR Frost Dragon in Adopt me > $20 USD LTC). Don\'t just put "adopt me" in the embed.',
      buttonLabel: 'Request Middleman',
      buttonCustomId: 'middleman_request',
    },
    autoCrypto: {
      title: "Jace's Auto Middleman",
      color: 0x5865f2,
      tutorialUrl: 'https://jaces.xyz/',
      description: '• Paid Service\n• Read our ToS before using the bot: #tos-crypto',
      fees: ['Deals $250+: $1.50', 'Deals under $250: $0.50', 'Deals under $50 are FREE'],
      footerChannel: 'completed-crypto',
      footerAmount: '$24,468',
      requests: [
        {
          label: 'Request Litecoin',
          icon: '🪙',
          note: null,
          buttonLabel: 'Request LTC',
          customId: 'request_ltc',
          style: 'primary',
        },
        {
          label: 'Request USDT [BEP-20]',
          icon: '🟢',
          note: 'Network: BSC (BEP-20)',
          buttonLabel: 'Request USDT [BEP-20]',
          customId: 'request_usdt',
          style: 'success',
        },
      ],
    },
  },

  // Standalone ToS/rules messages, auto-posted into their channels on !jaces.
  // "button" reuses tosUrl below unless it sets its own url.
  tosUrl: 'https://jaces.xyz/tos', // update to the real ToS link if different
  tosCryptoMessages: [
    {
      content:
        'The ToS in #mm-tos also apply here.\nYou can start a trade with the Automatic MM Bot here: #auto-crypto',
      button: { label: 'View ToS' },
    },
    {
      content:
        "• Double-check your Middleman's roles, as traders can impersonate the MM.\n" +
        '• Beware of fake SAB games.\n' +
        '• Always record your trades (e.g. giving items in-game).\n' +
        "• Always read the bot's embeds, people can send a few cents to the bot and lie that they sent the full amount.",
    },
  ],
  mmTosMessages: [
    {
      content: 'Get a Manual Middleman here from -> #mm-req',
      button: { label: 'View ToS' },
    },
    {
      content:
        'There has been an increase in scam attempts recently.\n' +
        "• Double-check your Middleman's roles, as traders can impersonate the MM.\n" +
        '• Beware of fake SAB games.\n' +
        '• Always record your trades (e.g. giving items in-game).',
    },
  ],

  // !stats — fake rank/volume card for a random member, posted to #commands
  stats: {
    postChannelMatch: 'commands',
    // Tried in order: members with this role → this specific member → any non-bot member.
    randomPoolId: '1526273333811876071',
    emoji: '💎',
    ranks: [
      { name: 'Quartz', threshold: 0 },
      { name: 'Topaz', threshold: 1000 },
      { name: 'Sapphire', threshold: 10000 },
      { name: 'Emerald', threshold: 50000 },
      { name: 'Diamond', threshold: 100000 },
    ],
    dealsMin: 1,
    dealsMax: 300,
    volumeMin: 100,
    volumeMax: 50000,
  },

  autopost: {
    channelName: 'completed-crypto',
    intervalMs: 5 * 60 * 1000,
    currencies: [
      { symbol: 'LTC', name: 'Litecoin', min: 0.01, max: 10, usdMin: 1, usdMax: 400, icon: '🪙' },
      { symbol: 'USDT', name: 'USDT [BEP-20]', min: 5, max: 500, usdMin: 5, usdMax: 500, icon: '🟢' },
    ],
  },
};
