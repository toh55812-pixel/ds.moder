const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder
} = require('discord.js');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const db = require('./database');
const { formatUkrainianDateTime } = require('./roleHistory');

// Check if member is Team leed, Administrator, Curator, Lame, or Owner
function canReviewKeyRequests(member) {
  if (!member) return false;
  if (member.id === member.guild.ownerId) return true;
  const allowedRoles = [
    config.roles.teamLead, // 1558592734816772096 (Team leed)
    config.roles.admin,    // 1558592841041838232 (Administrator)
    config.roles.curator,  // 1558593274883874897 (Curator)
    config.roles.lame,     // 1558593166938996850 (Lame)
    config.roles.ownerRole // 1559634990009024532 (Owner)
  ].filter(Boolean);

  return member.roles.cache.some(r => allowedRoles.includes(r.id));
}

// Ensure nobody can type in #запрос-на-ключ (read-only with buttons)
async function setupKeyRequestsChannelPermissions(guild) {
  if (!config.channels.keyRequests) return;
  try {
    const channel = await guild.channels.fetch(config.channels.keyRequests).catch(() => null);
    if (!channel) return;

    const allowedRoles = [
      config.roles.teamLead,
      config.roles.admin,
      config.roles.curator,
      config.roles.lame,
      config.roles.ownerRole
    ].filter(Boolean);

    // Lock @everyone completely
    await channel.permissionOverwrites.edit(guild.roles.everyone.id, {
      ViewChannel: false,
      SendMessages: false
    }).catch(() => {});

    // Allowed review staff can VIEW and READ message history, but CANNOT SEND messages
    for (const roleId of allowedRoles) {
      await channel.permissionOverwrites.edit(roleId, {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
        SendMessagesInThreads: false
      }).catch(() => {});
    }

    // Bot client has full send & embed permissions
    if (guild.client.user) {
      await channel.permissionOverwrites.edit(guild.client.user.id, {
        ViewChannel: true,
        SendMessages: true,
        EmbedLinks: true,
        AttachFiles: true,
        ReadMessageHistory: true
      }).catch(() => {});
    }

    console.log(`[KeyShop] Права доступу для каналу ${channel.name} успішно налаштовано (запис заблоковано)!`);
  } catch (err) {
    console.error('[KeyShop] Помилка налаштування прав для каналу запрос-на-ключ:', err);
  }
}

// Grant user access to <Проходка> category & channels upon submitting key request
async function grantProkhodkaAccess(guild, userId) {
  try {
    const prokhodkaCatId = config.categories.prokhodka;
    if (!prokhodkaCatId) return;

    const cat = await guild.channels.fetch(prokhodkaCatId).catch(() => null);
    if (cat) {
      await cat.permissionOverwrites.edit(userId, {
        ViewChannel: true,
        Connect: true,
        Speak: true
      }).catch(() => {});
    }

    // Support text channel
    if (config.channels.support) {
      const supportChan = await guild.channels.fetch(config.channels.support).catch(() => null);
      if (supportChan) {
        await supportChan.permissionOverwrites.edit(userId, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true
        }).catch(() => {});
      }
    }

    // Voice rooms inside category
    const children = guild.channels.cache.filter(c => c.parentId === prokhodkaCatId);
    for (const [, child] of children) {
      if (child.isVoiceBased()) {
        await child.permissionOverwrites.edit(userId, {
          ViewChannel: true,
          Connect: true,
          Speak: true
        }).catch(() => {});
      }
    }

    console.log(`[KeyShop] Користувачу ${userId} успішно надано доступ до категорії <Проходка>!`);
  } catch (err) {
    console.error(`[KeyShop] Помилка надання доступу до <Проходка> для ${userId}:`, err);
  }
}

// Revoke user access to <Проходка> when request is resolved (approved/rejected)
async function revokeProkhodkaAccess(guild, userId) {
  try {
    const prokhodkaCatId = config.categories.prokhodka;
    if (!prokhodkaCatId) return;

    const cat = await guild.channels.fetch(prokhodkaCatId).catch(() => null);
    if (cat) {
      await cat.permissionOverwrites.delete(userId).catch(() => {});
    }

    if (config.channels.support) {
      const supportChan = await guild.channels.fetch(config.channels.support).catch(() => null);
      if (supportChan) {
        await supportChan.permissionOverwrites.delete(userId).catch(() => {});
      }
    }

    const children = guild.channels.cache.filter(c => c.parentId === prokhodkaCatId);
    for (const [, child] of children) {
      await child.permissionOverwrites.delete(userId).catch(() => {});
    }

    console.log(`[KeyShop] Доступ до категорії <Проходка> для ${userId} закрито.`);
  } catch (err) {
    console.error(`[KeyShop] Помилка закриття доступу до <Проходка> для ${userId}:`, err);
  }
}

// 1. Create Main Shop Panel (Only for role 🔑)
function createKeyShopMainPanel() {
  const roleId = config.roles.keyRole || config.keyRole.id;

  const embed = new EmbedBuilder()
    .setTitle('📌 Ключик стаффа')
    .setColor('#2B2D31')
    .setDescription(
      '❓ **Что такое ключ?**\n\n' +
      `📌 **Ключ подразумевает под собой staff роль <@&${roleId}>, с определёнными плюшками, такими как:**\n\n` +
      '• необязательное выполнение нормы;\n' +
      '• доступ к staff каналам;\n' +
      '• команды ботов, доступные только для staff.\n\n' +
      '💎 **Привилегии ключа:**\n' +
      '• У вас нет нормы по часам и поинтам\n' +
      '• Вы можете выдавать пользователям пкм муты микрофона\n' +
      '• У вас появляется доступ к функционалу модератора\n' +
      '• У вас появляется доступ к локальному серверу модераторов\n' +
      '• Открывается возможность участвовать во всех мероприятиях модераторов\n' +
      '• Нахождение в приватном канале модераторов по своему желанию\n\n' +
      '⚠️ **Выговоры и правила ключей:**\n' +
      'У каждого ключика будет возможность получить выговор. Всего выговоров: **2**. Они даются за нарушение правил, описанных снизу:\n' +
      '> 1. Запрещено злоупотреблять полномочиями и использовать права не по назначению.\n' +
      '> 2. Запрещен слив информации из приватных и служебных стафф-каналов.\n' +
      '> 3. Соблюдение субординации, уважение к участникам и адекватное поведение.\n\n' +
      '*При получении 2-х выговоров ключ и роль немедленно изымаются Администрацией!*'
    )
    .setFooter({ text: 'Система магазину ключів • LUVEX Staff' })
    .setTimestamp();

  const files = [];
  const bannerPath = path.join(__dirname, 'assets', 'shop_banner.jpg');
  if (fs.existsSync(bannerPath)) {
    const attachment = new AttachmentBuilder(bannerPath, { name: 'shop_banner.jpg' });
    files.push(attachment);
    embed.setImage('attachment://shop_banner.jpg');
  }

  // Single clean button for role 🔑
  const button = new ButtonBuilder()
    .setCustomId('key:apply')
    .setLabel('Подати запит на ключ')
    .setEmoji('🔑')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(button);

  return {
    embeds: [embed],
    components: [row],
    files
  };
}

// 2. Handle Button Interactions
async function handleKeyButton(interaction) {
  const customId = interaction.customId;
  const parts = customId.split(':');
  const action = parts[1]; // apply, req
  const guild = interaction.guild;
  const keyRoleId = config.roles.keyRole || config.keyRole.id;

  // User clicks "Подати запит на ключ"
  if (action === 'apply') {
    // Check if user already has the role 🔑
    const member = interaction.member;
    if (member && member.roles.cache.has(keyRoleId)) {
      return interaction.reply({
        content: `❌ У вас вже є роль <@&${keyRoleId}> на цьому сервері!`,
        ephemeral: true
      });
    }

    // Check if user already has a pending request
    if (db.hasPendingKeyRequest(guild.id, interaction.user.id, 'key')) {
      return interaction.reply({
        content: `⚠️ У вас вже є активний запит на ключ <@&${keyRoleId}>, який очікує розгляду!`,
        ephemeral: true
      });
    }

    // Open Modal
    const modal = new ModalBuilder()
      .setCustomId('modal:key:apply')
      .setTitle('Запит на ключ 🔑');

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Чому саме ви? (Ваша мотивація)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Опишіть, чому ви хочете отримати цей ключ і чим будете корисні...')
      .setRequired(true)
      .setMaxLength(1000);

    const contactsInput = new TextInputBuilder()
      .setCustomId('contacts')
      .setLabel('Ваш досвід або коментар (необов\'язково)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Розкажіть про свій досвід або залиште коментар...')
      .setRequired(false)
      .setMaxLength(500);

    modal.addComponents(
      new ActionRowBuilder().addComponents(reasonInput),
      new ActionRowBuilder().addComponents(contactsInput)
    );

    return interaction.showModal(modal);
  }

  // Staff reviews request: Approve (✅ Одобрити)
  if (action === 'req' && parts[2] === 'approve') {
    const requestId = parts[3];

    if (!canReviewKeyRequests(interaction.member)) {
      return interaction.reply({
        content: '❌ Розглядати та схвалювати запити на ключ можуть лише **Team leed**, **Administrator**, **Curator** та **Lame**!',
        ephemeral: true
      });
    }

    const request = db.getKeyRequest(guild.id, requestId);
    if (!request || request.status !== 'pending') {
      return interaction.reply({
        content: '⚠️ Цей запит вже було розглянуто або його не існує!',
        ephemeral: true
      });
    }

    const roleId = request.roleId || keyRoleId;

    let targetMember = null;
    try {
      targetMember = await guild.members.fetch(request.userId).catch(() => null);
    } catch {}

    // Assign role 🔑
    if (targetMember && roleId) {
      const roleObj = guild.roles.cache.get(roleId);
      if (roleObj) {
        await targetMember.roles.add(roleObj, `Схвалення запиту на ключ адміністратором ${interaction.user.tag}`).catch(() => {});
      }
    }

    // Grant prokhodka access upon approval
    await grantProkhodkaAccess(guild, request.userId);

    // Save in DB
    db.resolveKeyRequest(guild.id, requestId, 'approved', interaction.user.id);
    db.grantKey(guild.id, request.userId, 'key', roleId, interaction.user.id);

    // Notify user in DM
    if (targetMember) {
      targetMember.send(
        `🎉 **Вітаємо! Ваш запит на ключ 🔑 було одобрено!**\n` +
        `👑 Хто одобрив: <@${interaction.user.id}> (\`${interaction.user.tag}\`)\n` +
        `Вам видано роль <@&${roleId}> та відкрито доступ до каналів **<Проходка>** на сервері **${guild.name}**.\n\n` +
        `⚠️ *Нагадуємо: у кожного ключика є можливість отримати максимум 2 виговори за порушення правил.*`
      ).catch(() => {});
    }

    const nowText = formatUkrainianDateTime(Date.now());

    // Log to log-shop
    const shopLogChannel = await guild.channels.fetch(config.channels.shopLog).catch(() => null);
    if (shopLogChannel) {
      const logEmbed = new EmbedBuilder()
        .setTitle('✅ [КЛЮЧ ОДОБРЕНО] Роль 🔑 та доступ до проходки видано')
        .setColor('#57F287')
        .setThumbnail(targetMember ? targetMember.user.displayAvatarURL({ dynamic: true }) : null)
        .addFields(
          {
            name: '👑 Хто розглянув:',
            value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`,
            inline: true
          },
          {
            name: '👤 Отримувач ключа:',
            value: `<@${request.userId}> (\`${request.userTag || request.userId}\`)`,
            inline: true
          },
          {
            name: '🔑 Виданий ключ:',
            value: `<@&${roleId}> (\`🔑\`)`,
            inline: true
          },
          {
            name: '🚪 Статус проходки:',
            value: '`Доступ до <Проходка> відкрито`',
            inline: true
          },
          {
            name: '⏰ Дата та час:',
            value: `\`${nowText}\``,
            inline: false
          }
        )
        .setFooter({ text: 'Магазин ключів • Схвалення' })
        .setTimestamp();

      await shopLogChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }

    // Update review message in #запрос-на-ключ
    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor('#57F287')
      .setTitle('✅ [ЗАПИТ НА КЛЮЧ ОДОБРЕНО]')
      .addFields(
        {
          name: '👑 Статус розгляду:',
          value: `✅ **Одобрено:** <@${interaction.user.id}> (\`${interaction.user.tag}\`) о \`${nowText}\`\n🚪 **Доступ:** Надано доступ до <Проходка> та роль <@&${roleId}>`,
          inline: false
        }
      );

    await interaction.update({
      embeds: [updatedEmbed],
      components: []
    });

    return interaction.followUp({
      content: `✅ Запит користувача <@${request.userId}> на ключ успішно одобрено! Роль <@&${roleId}> видано та відкрито доступ до каналів <Проходка>.`,
      ephemeral: true
    });
  }

  // Staff reviews request: Reject (❌ Відмовити)
  if (action === 'req' && parts[2] === 'reject') {
    const requestId = parts[3];

    if (!canReviewKeyRequests(interaction.member)) {
      return interaction.reply({
        content: '❌ Розглядати та відхиляти запити на ключ можуть лише **Team leed**, **Administrator**, **Curator** та **Lame**!',
        ephemeral: true
      });
    }

    const request = db.getKeyRequest(guild.id, requestId);
    if (!request || request.status !== 'pending') {
      return interaction.reply({
        content: '⚠️ Цей запит вже було розглянуто або його не існує!',
        ephemeral: true
      });
    }

    const modal = new ModalBuilder()
      .setCustomId(`modal:key:reject:${requestId}`)
      .setTitle('Відхилення запиту на ключ');

    const reasonInput = new TextInputBuilder()
      .setCustomId('reject_reason')
      .setLabel('Причина відмови на запит')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Вкажіть причину відмови користувачу...')
      .setRequired(true)
      .setMaxLength(500);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    return interaction.showModal(modal);
  }
}

// 3. Handle Modal Submissions
async function handleKeyModal(interaction) {
  const customId = interaction.customId;
  const parts = customId.split(':');
  const action = parts[2]; // apply, reject
  const guild = interaction.guild;
  const keyRoleId = config.roles.keyRole || config.keyRole.id;

  // User submits key application modal
  if (action === 'apply') {
    const reason = interaction.fields.getTextInputValue('reason').trim();
    const contacts = (interaction.fields.getTextInputValue('contacts') || '').trim();

    const request = db.createKeyRequest(
      guild.id,
      interaction.user.id,
      interaction.user.tag,
      'key',
      keyRoleId,
      reason,
      contacts
    );

    const nowText = formatUkrainianDateTime(Date.now());

    // Send review embed to #запрос-на-ключ
    const reqChannel = await guild.channels.fetch(config.channels.keyRequests).catch(() => null);
    if (reqChannel) {
      const reviewEmbed = new EmbedBuilder()
        .setTitle('🔑 [НОВИЙ ЗАПИТ НА КЛЮЧ]')
        .setColor('#FEE75C')
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
          {
            name: '👤 Кандидат:',
            value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)\n\`ID: ${interaction.user.id}\``,
            inline: true
          },
          {
            name: '🔑 Запитуваний ключ:',
            value: `<@&${keyRoleId}> (\`🔑\`)`,
            inline: true
          },
          {
            name: '💬 Мотивація (Чому саме він):',
            value: `\`\`\`\n${reason}\n\`\`\``,
            inline: false
          },
          {
            name: '📋 Досвід / коментар:',
            value: `\`\`\`\n${contacts || 'Не вказано'}\n\`\`\``,
            inline: false
          },
          {
            name: '⏰ Дата та час подачі:',
            value: `\`${nowText}\``,
            inline: false
          },
          {
            name: '👥 Хто розглядає (Team leed, Administrator, Curator, Lame):',
            value: `<@&${config.roles.teamLead}> | <@&${config.roles.admin}> | <@&${config.roles.curator}> | <@&${config.roles.lame}>`,
            inline: false
          }
        )
        .setFooter({ text: 'Розгляд доступний лише для: Team leed, Administrator, Curator, Lame' })
        .setTimestamp();

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`key:req:approve:${request.id}`)
          .setLabel('Одобрити')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`key:req:reject:${request.id}`)
          .setLabel('Відмовити')
          .setEmoji('❌')
          .setStyle(ButtonStyle.Danger)
      );

      // Mention the allowed roles in message text as requested
      const pingText = `<@&${config.roles.teamLead}> <@&${config.roles.admin}> <@&${config.roles.curator}> <@&${config.roles.lame}>`;

      await reqChannel.send({
        content: `🔔 **Новий запит на ключ!** ${pingText}`,
        embeds: [reviewEmbed],
        components: [buttons]
      }).catch(() => {});
    }

    // Send log to log-shop
    const shopLogChannel = await guild.channels.fetch(config.channels.shopLog).catch(() => null);
    if (shopLogChannel) {
      const logEmbed = new EmbedBuilder()
        .setTitle('📥 [ЗАПИТ НА КЛЮЧ] Подано нову заявку')
        .setColor('#5865F2')
        .addFields(
          {
            name: '👤 Користувач:',
            value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`,
            inline: true
          },
          {
            name: '🔑 Ключ:',
            value: `<@&${keyRoleId}> (\`🔑\`)`,
            inline: true
          },
          {
            name: '🚪 Статус проходки:',
            value: '`Очікує схвалення заявки`',
            inline: true
          },
          {
            name: '⏰ Дата подачі:',
            value: `\`${nowText}\``,
            inline: false
          }
        )
        .setFooter({ text: 'Магазин ключів • Очікує розгляду' })
        .setTimestamp();

      await shopLogChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }

    return interaction.reply({
      content: `✅ Ваш запит на ключ 🔑 успішно надіслано на розгляд керівництву сервера! Доступ до проходки буде надано після схвалення вашої заявки.`,
      ephemeral: true
    });
  }

  // Staff submits rejection modal
  if (action === 'reject') {
    const requestId = parts[3];

    if (!canReviewKeyRequests(interaction.member)) {
      return interaction.reply({
        content: '❌ Розглядати та відхиляти запити на ключ можуть лише **Team leed**, **Administrator**, **Curator** та **Lame**!',
        ephemeral: true
      });
    }

    const request = db.getKeyRequest(guild.id, requestId);
    if (!request || request.status !== 'pending') {
      return interaction.reply({
        content: '⚠️ Цей запит вже було розглянуто або його не існує!',
        ephemeral: true
      });
    }

    const rejectReason = interaction.fields.getTextInputValue('reject_reason').trim();

    // Revoke prokhodka access
    await revokeProkhodkaAccess(guild, request.userId);

    // Save in DB
    db.resolveKeyRequest(guild.id, requestId, 'rejected', interaction.user.id, rejectReason);

    let targetMember = null;
    try {
      targetMember = await guild.members.fetch(request.userId).catch(() => null);
    } catch {}

    // Notify user in DM
    if (targetMember) {
      targetMember.send(
        `❌ **Ваш запит на ключ 🔑 на сервері ${guild.name} було відхилено.**\n` +
        `👑 Хто розглянув: <@${interaction.user.id}> (\`${interaction.user.tag}\`)\n` +
        `**Причина відмови:** ${rejectReason}`
      ).catch(() => {});
    }

    const nowText = formatUkrainianDateTime(Date.now());

    // Log to log-shop
    const shopLogChannel = await guild.channels.fetch(config.channels.shopLog).catch(() => null);
    if (shopLogChannel) {
      const logEmbed = new EmbedBuilder()
        .setTitle('❌ [КЛЮЧ ВІДХИЛЕНО] Запит відхилено')
        .setColor('#ED4245')
        .addFields(
          {
            name: '👑 Хто розглянув:',
            value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`,
            inline: true
          },
          {
            name: '👤 Кандидат:',
            value: `<@${request.userId}> (\`${request.userTag || request.userId}\`)`,
            inline: true
          },
          {
            name: '🔑 Ключ:',
            value: `<@&${keyRoleId}> (\`🔑\`)`,
            inline: true
          },
          {
            name: '💬 Причина відмови:',
            value: `\`${rejectReason}\``,
            inline: false
          },
          {
            name: '⏰ Дата та час:',
            value: `\`${nowText}\``,
            inline: false
          }
        )
        .setFooter({ text: 'Магазин ключів • Відхилення' })
        .setTimestamp();

      await shopLogChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }

    // Update message in #запрос-на-ключ
    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor('#ED4245')
      .setTitle('❌ [ЗАПИТ НА КЛЮЧ ВІДХИЛЕНО]')
      .addFields(
        {
          name: '👑 Статус розгляду:',
          value: `❌ **Відмовлено:** <@${interaction.user.id}> (\`${interaction.user.tag}\`) о \`${nowText}\`\n💬 **Причина:** \`${rejectReason}\``,
          inline: false
        }
      );

    await interaction.update({
      embeds: [updatedEmbed],
      components: []
    });

    return interaction.followUp({
      content: `❌ Запит користувача <@${request.userId}> на ключ відхилено. Причину надіслано в ЛС.`,
      ephemeral: true
    });
  }
}

// 4. Deploy Key Shop Panel to #магазин-ключей
async function deployKeyShopPanel(guild) {
  if (!config.channels.keysShop) return null;

  try {
    const channel = await guild.channels.fetch(config.channels.keysShop).catch(() => null);
    if (!channel || !channel.isTextBased()) return null;

    // Check if panel already exists
    const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
    const existingPanel = messages ? messages.find(m =>
      m.author.id === guild.client.user.id &&
      m.embeds.some(e => e.title && e.title.includes('Ключик стаффа'))
    ) : null;

    const panelData = createKeyShopMainPanel();

    if (existingPanel) {
      await existingPanel.edit(panelData).catch(() => {});
      console.log(`[KeyShop] Панель магазина ключів оновлено в каналі: ${channel.name}`);
      return existingPanel;
    } else {
      const msg = await channel.send(panelData).catch(() => {});
      console.log(`[KeyShop] Панель магазина ключів розгорнуто в каналі: ${channel.name}`);
      return msg;
    }
  } catch (err) {
    console.error('[KeyShop] Помилка при розгортанні панелі магазина ключів:', err);
    return null;
  }
}

module.exports = {
  canReviewKeyRequests,
  setupKeyRequestsChannelPermissions,
  grantProkhodkaAccess,
  revokeProkhodkaAccess,
  createKeyShopMainPanel,
  handleKeyButton,
  handleKeyModal,
  deployKeyShopPanel
};
