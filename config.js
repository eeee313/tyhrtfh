module.exports = {
  // Users or roles allowed to run the admin-only commands below.
  adminRoleIds: [], // e.g. ['123456789012345678']
  adminUserIds: [], // e.g. ['123456789012345678']

  profiles: {
    values: {
      key: 'values',
      guildName: 'RoValues',
      icon: './assets/rovalues.png', // save the RoValues logo here
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
      guildName: 'Jaces',
      icon: './assets/jaces.png', // save the Jaces pfp here
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
          channels: ['chat'],
        },
      ],
    },
  },

  // Plain +embed command styling
  embed: {
    color: 0x5865f2,
  },

  // Static "for display only" panels — buttons on these always report failure.
  displays: {
    middleman: {
      title: 'Middleman Service',
      color: 0x5865f2,
      description:
        'To request a middleman from this server, click the blue "Request Middleman" button on this message.\n\n' +
        '__**How does middleman work?**__\n' +
        'Example: Trade is NFR Crow for Robux.\n' +
        '1. Seller gives NFR Crow to middleman\n' +
        '2. Buyer pays seller robux (After middleman confirms receiving pet)\n' +
        '3. Middleman gives buyer NFR Crow (After seller confirmed receiving robux)\n\n' +
        '__**NOTES:**__\n' +
        "1. You must both agree on the deal before using a middleman. Troll tickets will have consequences.\n" +
        '2. Specify what you\'re trading (e.g. FR Frost Dragon in Adopt me > $20 USD LTC). Don\'t just put "adopt me" in the embed.',
      buttonLabel: 'Request Middleman',
      buttonCustomId: 'middleman_request',
    },
    autoCrypto: {
      title: "Jace's Auto Middleman",
      color: 0x5865f2,
      description: '**Paid Service**\nRead our ToS before using the bot: #tos-crypto',
      fees: ['Deals $250+: $1.50', 'Deals under $250: $0.50', 'Deals under $50 are FREE'],
      footerChannel: 'completed-crypto',
      footerAmount: '$24,468',
      buttons: [
        { label: 'Request Litecoin', customId: 'request_ltc' },
        { label: 'Request USDT [BEP-20]', customId: 'request_usdt' },
      ],
    },
  },

  // Auto-poster for fake "Trade Completed" messages
  autopost: {
    channelName: 'completed-crypto',
    intervalMs: 5 * 60 * 1000, // every 5 minutes
    currencies: [
      { symbol: 'LTC', name: 'Litecoin', min: 0.01, max: 10, usdMin: 1, usdMax: 400, icon: '🪙' },
      { symbol: 'USDT', name: 'USDT [BEP-20]', min: 5, max: 500, usdMin: 5, usdMax: 500, icon: '🟢' },
    ],
  },
};
