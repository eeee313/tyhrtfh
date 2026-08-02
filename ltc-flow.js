// Real "Request LTC" auto-middleman flow: modal -> ticket -> role select ->
// role confirm -> USD amount -> USD confirm -> payment address. No blockchain
// verification is implemented — it stops at showing payment info and closes
// the ticket automatically after a timeout if nothing else happens.

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const config = require('./config');

const tickets = new Map();
let counter = 0;
function newTicketId() {
  counter += 1;
  return `${Date.now()}${counter}`;
}

function otherParty(ticket, userId) {
  return userId === ticket.initiatorId ? ticket.traderId : ticket.initiatorId;
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

// --- Step 2: modal submitted -> create the ticket ---

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
    await interaction
      .reply({ content: "⚠️ You can't open a trade with yourself.", ephemeral: true })
      .catch(() => {});
    return;
  }

  const id = newTicketId();
  const ticket = {
    id,
    channelId: interaction.channelId,
    initiatorId: interaction.user.id,
    traderId: traderMember.id,
    giving,
    traderGiving,
    roles: {}, // userId -> 'sender' | 'receiver'
    roleConfirmed: {}, // userId -> true
    usdAmount: null,
    usdConfirmed: {}, // userId -> true
    messages: {}, // stage -> messageId
    closeTimeout: null,
    status: 'awaiting_roles',
  };
  tickets.set(id, ticket);

  await interaction.reply(buildTicketPayload(ticket));
  const sent = await interaction.fetchReply().catch(() => null);
  if (sent) ticket.messages.ticket = sent.id;
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
        `By using this bot, you agree to our ToS #tos-crypto.\n` +
        "Whether you're the seller or the buyer, make sure to video-record everything in this deal."
    )
    .addFields(
      { name: `${initiatorMention}'s side:`, value: ticket.giving || '\u200b' },
      { name: `${traderMention}'s side:`, value: ticket.traderGiving || '\u200b' }
    );

  const rows = [];

  if (ticket.status === 'awaiting_roles') {
    const senderName = ticket.roles.sender ? `<@${ticket.roles.sender}>` : '...';
    const receiverName = ticket.roles.receiver ? `<@${ticket.roles.receiver}>` : '...';

    const roleEmbed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setDescription(
        '🛡️ · **Select your role**\n' +
          '"Sender" if you are Sending LTC to the bot.\n' +
          '"Receiver" if you are Receiving LTC *later* from the bot.'
      )
      .addFields({ name: 'Sender', value: senderName, inline: true }, { name: 'Receiver', value: receiverName, inline: true });

    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ltc_role_sender:${ticket.id}`).setLabel('Sender').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`ltc_role_receiver:${ticket.id}`).setLabel('Receiver').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`ltc_role_reset:${ticket.id}`).setLabel('Reset').setStyle(ButtonStyle.Danger)
      )
    );
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ltc_delete:${ticket.id}`).setLabel('Delete Ticket').setStyle(ButtonStyle.Danger)
      )
    );

    return { content: `${initiatorMention} ${traderMention}`, embeds: [infoEmbed, roleEmbed], components: rows };
  }

  // Roles picked — show them as plain text, keep only Delete Ticket.
  const senderName = ticket.roles.sender ? `<@${ticket.roles.sender}>` : '...';
  const receiverName = ticket.roles.receiver ? `<@${ticket.roles.receiver}>` : '...';
  const roleEmbed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setDescription('🛡️ · **Select your role**')
    .addFields({ name: 'Sender', value: senderName, inline: true }, { name: 'Receiver', value: receiverName, inline: true });

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ltc_delete:${ticket.id}`).setLabel('Delete Ticket').setStyle(ButtonStyle.Danger)
    )
  );

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

  // Clear this user from whichever slot they held, then assign the new one.
  if (ticket.roles.sender === interaction.user.id) delete ticket.roles.sender;
  if (ticket.roles.receiver === interaction.user.id) delete ticket.roles.receiver;
  ticket.roles[role] = interaction.user.id;

  await interaction.deferUpdate().catch(() => {});
  await refreshTicketMessage(interaction.channel, ticket);

  const bothPicked = ticket.roles.sender && ticket.roles.receiver;
  const differentUsers = ticket.roles.sender !== ticket.roles.receiver;
  if (bothPicked && differentUsers) {
    ticket.status = 'awaiting_role_confirm';
    await refreshTicketMessage(interaction.channel, ticket);
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
      '· **Is This Information Correct?**\n\n' +
        `**Sender**\n${senderMention}\n\n**Receiver**\n${receiverMention}\n\n` +
        'Make sure you have selected the right role! If you didn\'t then click "Incorrect"'
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ltc_role_correct:${ticket.id}`).setLabel('Correct').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ltc_role_incorrect:${ticket.id}`).setLabel('Incorrect').setStyle(ButtonStyle.Danger)
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
    await refreshTicketMessage(interaction.channel, ticket);
    return;
  }

  ticket.roleConfirmed[interaction.user.id] = true;
  const msg = interaction.message;
  const newLine = `✅ <@${interaction.user.id}> clicked Correct.`;
  const content = msg.content.includes(newLine) ? msg.content : `${msg.content}\n${newLine}`;

  await interaction.update({ content }).catch(() => {});

  const bothConfirmed = ticket.roleConfirmed[ticket.roles.sender] && ticket.roleConfirmed[ticket.roles.receiver];
  if (bothConfirmed) {
    ticket.status = 'awaiting_usd';
    await postSetUsdPrompt(interaction.channel, ticket);
  }
}

// --- Sender sets the USD amount ---

async function postSetUsdPrompt(channel, ticket) {
  const senderMention = `<@${ticket.roles.sender}>`;
  const embed = new EmbedBuilder().setColor(0x2b2d31).setDescription('💵 · **Set the amount in USD value**');
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
    .setDescription(`· **USD amount set to $${amount.toFixed(2)}.**\nPlease confirm the USD amount.`);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ltc_usd_correct:${ticket.id}`).setLabel('Correct').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ltc_usd_incorrect:${ticket.id}`).setLabel('Incorrect').setStyle(ButtonStyle.Danger)
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
    await postSetUsdPrompt(interaction.channel, ticket);
    return;
  }

  ticket.usdConfirmed[interaction.user.id] = true;
  const newLine = `✅ <@${interaction.user.id}> clicked Correct.`;
  const content = interaction.message.content.includes(newLine)
    ? interaction.message.content
    : `${interaction.message.content}\n${newLine}`;
  await interaction.update({ content }).catch(() => {});

  const bothConfirmed = ticket.usdConfirmed[ticket.roles.sender] && ticket.usdConfirmed[ticket.roles.receiver];
  if (bothConfirmed) {
    ticket.status = 'awaiting_payment';
    await postPaymentInfo(interaction.channel, ticket);
  }
}

// --- Final payment info ---

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
    .setDescription(
      'Send the LTC to the following address.\n\n' +
        '💵 · **Payment Information**\n' +
        'Make sure to send the **EXACT** amount in LTC.\n\n' +
        `USD Amount: $${ticket.usdAmount.toFixed(2)}\nLTC Amount: ${ltcAmount}\n\n` +
        `Payment Address:\n\`${config.ltc.address}\`\n\n` +
        `Current LTC Price: $${price.toFixed(2)}\n` +
        'This ticket will be closed within 20 minutes if no transaction was detected.'
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ltc_copy:${ticket.id}`).setLabel('Copy Details').setStyle(ButtonStyle.Primary)
  );

  const msg = await channel.send({ content: senderMention, embeds: [embed], components: [row] }).catch(() => null);
  if (msg) ticket.messages.payment = msg.id;

  ticket.closeTimeout = setTimeout(async () => {
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

// --- Delete ticket ---

async function handleDelete(interaction, ticket) {
  if (!isParticipant(ticket, interaction.user.id) && !interaction.member?.permissions?.has('Administrator')) {
    await interaction.reply({ content: "This isn't your ticket.", ephemeral: true }).catch(() => {});
    return;
  }
  clearTicketTimeout(ticket);
  const channel = interaction.channel;
  for (const key of Object.keys(ticket.messages)) {
    await deleteTrackedMessage(channel, ticket, key);
  }
  await interaction.deferUpdate().catch(() => {});
  const ticketMsg = await channel.messages.fetch(ticket.messages.ticket).catch(() => null);
  if (ticketMsg) await ticketMsg.delete().catch(() => {});
  tickets.delete(ticket.id);
}

// --- Router ---

function parseCustomId(customId) {
  const idx = customId.indexOf(':');
  if (idx === -1) return { action: customId, ticketId: null };
  return { action: customId.slice(0, idx), ticketId: customId.slice(idx + 1) };
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

module.exports = { handleInteraction };
