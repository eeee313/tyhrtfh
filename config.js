module.exports = {
  // Users or roles allowed to run !values / !jaces. Fill in IDs.
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
};
