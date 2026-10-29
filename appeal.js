const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField
} = require('discord.js');
const config = require('./config');
const db = require('./database');
const { formatUkrainianDateTime, getMemberStaffLevel } = require('./roleHistory');

// Build the public Appeal Panel displayed in channel #апиляцію
function getAppealPanelData() {
  const embed = new EmbedBuilder()
    .setTitle('📜 Подача апеляції на зняття Чорного Списку')
    .setColor('#ED4245')
    .setDescription(
      'Ви бачите цей канал, оскільки потрапили до **Чорного Списку** сервера.\n' +
      'Доступ до всіх інших каналів та голосових кімнат для вас заблоковано.\n\n' +
      '📌 **Як подати апеляцію та зняти ЧС?**\n' +
      '• Натисніть кнопку **"Подати апеляцію"** нижче.\n' +
      '• Вкажіть **модератора (user3)**, який видав вам ЧС, та свого **друга/свідка (user2)**, у якого є відеозапис (**відкат**).\n' +
      '• Бот автоматично створить **окремий закритий чат та голосовий войс** для вас трьох і модерації сервера.\n' +
      '• Модератор зможе **взяти апеляцію на розгляд**, перевірити відкат у чаті або у войсі.\n\n' +
      '⚠️ **Важливо:** якщо у вас або у свідка **немає відкату**, модератор має право закрити апеляцію без зняття покарання!'
    )
    .setFooter({ text: 'Система апеляцій • LUVEX Staff' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('appeal:open')
      .setLabel('Подати апеляцію')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Danger)
  );

  return {
    embeds: [embed],
    components: [row]
  };
}

// Find member by ID, mention, username, tag or nickname
async function findMember(guild, input) {
  if (!input || typeof input !== 'string') return null;
  const cleaned = input.replace(/[<@!>]/g, '').trim();

  // 1. Try by ID
  if (/^\d{17,20}$/.test(cleaned)) {
    try {
      const byId = await guild.members.fetch(cleaned).catch(() => null);
      if (byId) return byId;
    } catch {}
  }

  // 2. Try match in cached members
  const query = cleaned.toLowerCase();
  const cached = guild.members.cache.find(m =>
    m.id === cleaned ||
    m.user.username.toLowerCase() === query ||
    (m.user.tag && m.user.tag.toLowerCase() === query) ||
    m.displayName.toLowerCase() === query
  );
  if (cached) return cached;

  // 3. Try search query through API
  try {
    const searchRes = await guild.members.search({ query: cleaned, limit: 10 }).catch(() => null);
    if (searchRes && searchRes.size > 0) {
      const exact = searchRes.find(m =>
        m.user.username.toLowerCase() === query ||
        m.displayName.toLowerCase() === query
      );
      return exact || searchRes.first();
    }
  } catch {}

  return null;
}

// Check if member is Administrator or higher, or the assigned moderator
function canManageAppeal(member, appealData = null) {
  if (!member) return false;
  if (member.id === member.guild.ownerId) return true;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;

  // Administrator (Level 4) and higher (Team Lead, Owner)
  const staffLevel = getMemberStaffLevel(member);
  if (staffLevel >= 4) return true;

  // If this member is user3 (the moderator who issued blacklist or assigned)
  if (appealData) {
    if (appealData.moderatorId && member.id === appealData.moderatorId) return true;
    if (appealData.claimedBy && member.id === appealData.claimedBy) return true;
  }

  return false;
}

// Get or create dedicated appeals category
async function getOrCreateAppealsCategory(guild) {
  let cat = guild.channels.cache.find(c => c.type === 4 && (c.name.includes('АПЕЛЯЦІЇ') || c.name.includes('Апеляції')));
  if (!cat) {
    cat = await guild.channels.create({
      name: '⚖️ │ АПЕЛЯЦІЇ ЧС',
      type: 4, // GuildCategory
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionsBitField.Flags.ViewChannel]
        },
        {
          id: config.roles.blacklist,
          deny: [PermissionsBitField.Flags.ViewChannel]
        }
      ]
    }).catch(err => {
      console.error('Failed to create appeals category:', err);
      return null;
    });
  }
  return cat;
}

// Automatically configure channel permissions for Blacklist role and remove timeouts
async function setupBlacklistPermissions(guild) {
  try {
    const blRoleId = config.roles.blacklist;
    const appealChannelId = config.channels.appeal;

    if (!blRoleId || !appealChannelId) return;

    // 1. Configure #апиляцію channel
    const appealChannel = await guild.channels.fetch(appealChannelId).catch(() => null);
    if (appealChannel) {
      await appealChannel.permissionOverwrites.set([
        {
          id: guild.id, // @everyone: hide
          deny: [PermissionsBitField.Flags.ViewChannel]
        },
        {
          id: blRoleId, // Черный Список: show channel
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.SendMessages
          ]
        }
      ]);

      // Ensure appeal panel exists in #апиляцію
      const messages = await appealChannel.messages.fetch({ limit: 10 }).catch(() => null);
      const hasPanel = messages && messages.some(m => m.components.length > 0 && m.components[0].components.some(c => c.customId === 'appeal:open'));

      if (!hasPanel) {
        await appealChannel.send(getAppealPanelData());
        console.log('✅ Панель апеляцій успішно розміщена в каналі #апиляцію!');
      }
    }

    // 2. Hide all normal server categories for Черный Список
    const channels = await guild.channels.fetch();
    const categories = channels.filter(c => c && c.type === 4); // CategoryChannel

    for (const [, cat] of categories) {
      await cat.permissionOverwrites.edit(blRoleId, {
        ViewChannel: false
      }).catch(err => {
        console.warn(`Не вдалося встановити права на категорію ${cat.name}:`, err.message);
      });
    }

    // 3. Remove timeout for any members currently in Blacklist
    try {
      const allMembers = await guild.members.fetch().catch(() => null);
      if (allMembers) {
        for (const [, m] of allMembers) {
          if (m.roles.cache.has(blRoleId) && m.communicationDisabledUntilTimestamp && m.communicationDisabledUntilTimestamp > Date.now()) {
            await m.timeout(null, 'Зняття таймауту для користувача в ЧС').catch(() => {});
          }
        }
      }
    } catch {}

    console.log('✅ Права доступу для ролі Чорний Список успішно синхронізовано!');
  } catch (error) {
    console.error('❌ Помилка при налаштуванні прав ЧС:', error);
  }
}

// Build appeal message embed & buttons for the appeal room
function buildAppealMessageData(guild, appealData) {
  const isClaimed = !!appealData.claimedBy;
  const claimedMember = isClaimed ? guild.members.cache.get(appealData.claimedBy) : null;
  const authorMember = guild.members.cache.get(appealData.userId);
  const witnessMember = appealData.witnessId ? guild.members.cache.get(appealData.witnessId) : null;
  const moderatorMember = appealData.moderatorId ? guild.members.cache.get(appealData.moderatorId) : null;

  const embed = new EmbedBuilder()
    .setTitle('⚖️ Кімната розгляду апеляції на зняття Чорного Списку')
    .setColor(isClaimed ? '#57F287' : '#5865F2')
    .setThumbnail(authorMember ? authorMember.user.displayAvatarURL({ dynamic: true, size: 256 }) : (guild.iconURL({ dynamic: true }) || null))
    .setFooter({ text: 'Система апеляцій • LUVEX Staff' })
    .setTimestamp();

  if (isClaimed && claimedMember) {
    embed.setAuthor({
      name: `🛡️ Модератор справи: ${claimedMember.user.tag}`,
      iconURL: claimedMember.user.displayAvatarURL({ dynamic: true })
    });
  } else {
    embed.setAuthor({
      name: '⚖️ Модерація сервера • Очікує модератора',
      iconURL: guild.iconURL({ dynamic: true }) || undefined
    });
  }

  const statusText = isClaimed && claimedMember
    ? `🟢 **Взято на розгляд:** <@${claimedMember.id}> (\`${claimedMember.user.tag}\`)`
    : `⏳ **Очікує розгляду модератором** (Натисніть кнопку "Взяти апеляцію" нижче)`;

  embed.setDescription(
    `Вітаємо в кімнаті розгляду апеляції!\n` +
    `Тут зібрані автор апеляції, запрошений друг/свідок та модерація для з'ясування обставин і перевірки відеозапису (відкату).\n\n` +
    `**Статус розгляду:**\n${statusText}\n\n` +
    `**Учасники справи:**\n` +
    `• 👤 **Автор апеляції (ЧС / user1):** <@${appealData.userId}> (\`${authorMember ? authorMember.user.tag : appealData.userId}\`)\n` +
    `• 👮 **Модератор ЧС (user3):** ${moderatorMember ? `<@${moderatorMember.id}> (\`${moderatorMember.user.tag}\`)` : `\`${appealData.moderatorInput || 'Не вказано'}\``}\n` +
    `• 👥 **Друг / Свідок з відкатом (user2):** ${witnessMember ? `<@${witnessMember.id}> (\`${witnessMember.user.tag}\`)` : (appealData.witnessInput ? `\`${appealData.witnessInput}\`` : '`Не вказано`')}\n\n` +
    `🔊 **Голосовий войс для розмови та показу відкату:**\n` +
    `👉 <#${appealData.voiceChannelId}>\n\n` +
    `📋 **Опис ситуації від автора:**\n` +
    `> ${appealData.reason}\n\n` +
    `📹 **Інформація про відкат:**\n` +
    `> ${appealData.recording || 'Очікується надання в чаті або показ у войсі'}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📌 **Правила розгляду:**\n` +
    `• Автор або свідок повинні надати відеозапис (відкат) у цей чат або увімкнути стрім у голосовому каналі <#${appealData.voiceChannelId}>.\n` +
    `• **Якщо у іншої особи або у автора немає відкату**, модератор закриває апеляцію кнопкою **"Закрити (Немає відкату)"**.\n` +
    `• Якщо доведено невинність — модератор знімає ЧС кнопкою **"Схвалити та зняти ЧС"**.`
  );

  const row1 = new ActionRowBuilder();
  if (!isClaimed) {
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(`appeal:claim:${appealData.userId}:${appealData.textChannelId}:${appealData.voiceChannelId}`)
        .setLabel('Взяти апеляцію')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🛡️'),
      new ButtonBuilder()
        .setCustomId(`appeal:reject:${appealData.userId}:${appealData.textChannelId}:${appealData.voiceChannelId}`)
        .setLabel('Закрити (Немає відкату)')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌')
    );
  } else {
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(`appeal:approve:${appealData.userId}:${appealData.textChannelId}:${appealData.voiceChannelId}`)
        .setLabel('Схвалити та зняти ЧС')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId(`appeal:reject:${appealData.userId}:${appealData.textChannelId}:${appealData.voiceChannelId}`)
        .setLabel('Закрити (Немає відкату)')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌'),
      new ButtonBuilder()
        .setCustomId(`appeal:unclaim:${appealData.userId}:${appealData.textChannelId}:${appealData.voiceChannelId}`)
        .setLabel('Відмовитися / Передати')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('↩️')
    );
  }

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`appeal:invite:${appealData.userId}:${appealData.textChannelId}:${appealData.voiceChannelId}`)
      .setLabel('Покликати ще свідка / друга')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('➕'),
    new ButtonBuilder()
      .setCustomId(`appeal:del_voice:${appealData.voiceChannelId}`)
      .setLabel('Закрити войс')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔊')
  );

  return {
    embeds: [embed],
    components: [row1, row2]
  };
}

// Handle Appeal Buttons
async function handleAppealButton(interaction, canManageStaffFunc) {
  const customId = interaction.customId;
  const parts = customId.split(':');
  const action = parts[1];
  const targetId = parts[2];
  const guild = interaction.guild;

  // 1. Blacklisted user clicks "Подати апеляцію"
  if (action === 'open') {
    const member = interaction.member;
    const blRoleId = config.roles.blacklist;
    const isBLRole = member.roles.cache.has(blRoleId);
    const isBLDB = db.isBlacklisted(guild.id, member.id);

    if (!isBLRole && !isBLDB) {
      return interaction.reply({
        content: '⚠️ Ви не перебуваєте в Чорному Списку!',
        ephemeral: true
      });
    }

    // Remove active timeout if user has one
    if (member.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now()) {
      await member.timeout(null, 'Зняття таймауту для проходження апеляції').catch(() => {});
    }

    if (db.hasPendingAppeal(guild.id, member.id)) {
      const appealData = db.getAppeal(guild.id, member.id);
      if (appealData && appealData.textChannelId) {
        const existingChan = guild.channels.cache.get(appealData.textChannelId);
        if (existingChan) {
          return interaction.reply({
            content: `⏳ У вас вже є відкрита апеляція! Перейдіть у створений чат: <#${existingChan.id}>.`,
            ephemeral: true
          });
        }
      }
    }

    const blRecord = db.getBlacklistRecord(guild.id, member.id);
    let defaultModerator = '';
    if (blRecord && blRecord.moderatorId) {
      defaultModerator = blRecord.moderatorId;
    }

    const modal = new ModalBuilder()
      .setCustomId('modal:appeal:submit')
      .setTitle('Подача апеляції на зняття ЧС');

    const modInput = new TextInputBuilder()
      .setCustomId('moderator_input')
      .setLabel('Модератор, який видав ЧС (user3)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Вкажіть нікнейм або ID модератора (user3)')
      .setRequired(true);

    if (defaultModerator) {
      modInput.setValue(defaultModerator);
    }

    const witnessInput = new TextInputBuilder()
      .setCustomId('witness_input')
      .setLabel('Друг / свідок з відкатом (user2)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Вкажіть нік або ID друга з відкатом (user2)')
      .setRequired(false);

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Причина апеляції / опис ситуації')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Детально поясніть ситуацію, що сталося...')
      .setRequired(true);

    const recordingInput = new TextInputBuilder()
      .setCustomId('recording')
      .setLabel('Відкат / Докази (посилання або войс)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Посилання на запис відкату або напишіть, що друг покаже у войсі')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(modInput),
      new ActionRowBuilder().addComponents(witnessInput),
      new ActionRowBuilder().addComponents(reasonInput),
      new ActionRowBuilder().addComponents(recordingInput)
    );

    return interaction.showModal(modal);
  }

  // 2. Moderator takes appeal ("Взяти апеляцію")
  if (action === 'claim') {
    const appealData = db.getAppeal(guild.id, targetId);
    if (!canManageAppeal(interaction.member, appealData)) {
      return interaction.reply({
        content: '❌ Брати апеляції на розгляд можуть лише призначений модератор або користувачі з посадою **Адміністратор** та вище!',
        ephemeral: true
      });
    }

    if (appealData && appealData.claimedBy && appealData.claimedBy !== interaction.user.id) {
      return interaction.reply({
        content: `⚠️ Цю апеляцію вже взяв на розгляд модератор <@${appealData.claimedBy}>!`,
        ephemeral: true
      });
    }

    db.claimAppeal(guild.id, targetId, interaction.user.id);
    const updatedData = db.getAppeal(guild.id, targetId);

    // Update message in the appeal channel
    const messageData = buildAppealMessageData(guild, updatedData);
    await interaction.update(messageData);

    // Announce in channel
    await interaction.channel.send(`🛡️ Модератор <@${interaction.user.id}> взяв розгляд даної апеляції на себе!`);

    // Log to #log1
    const logChannel = await guild.channels.fetch(config.channels.log).catch(() => null);
    if (logChannel) {
      const nowText = formatUkrainianDateTime(Date.now());
      const logEmbed = new EmbedBuilder()
        .setTitle('🟢 [АПЕЛЯЦІЯ] Взято на розгляд')
        .setColor('#57F287')
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
          {
            name: '🛡️ Модератор (хто взяв):',
            value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`,
            inline: true
          },
          {
            name: '👤 Автор апеляції (ЧС):',
            value: `<@${targetId}>`,
            inline: true
          },
          {
            name: '💬 Кімната апеляції:',
            value: `<#${interaction.channel.id}>`,
            inline: true
          },
          {
            name: '⏰ Дата та час:',
            value: `\`${nowText}\``,
            inline: false
          }
        )
        .setFooter({ text: 'Система апеляцій • LUVEX Staff' })
        .setTimestamp();

      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }

    return;
  }

  // 3. Moderator unclaims appeal ("Відмовитися / Передати")
  if (action === 'unclaim') {
    const appealData = db.getAppeal(guild.id, targetId);
    if (!canManageAppeal(interaction.member, appealData)) {
      return interaction.reply({
        content: '❌ Керувати апеляцією можуть лише модератор розгляду або Адміністратор і вище!',
        ephemeral: true
      });
    }

    if (appealData && appealData.claimedBy && appealData.claimedBy !== interaction.user.id && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({
        content: '❌ Тільки модератор, який взяв апеляцію, або Адміністратор можуть відмовитися від неї!',
        ephemeral: true
      });
    }

    db.unclaimAppeal(guild.id, targetId);
    const updatedData = db.getAppeal(guild.id, targetId);

    const messageData = buildAppealMessageData(guild, updatedData);
    await interaction.update(messageData);

    await interaction.channel.send(`↩️ Модератор <@${interaction.user.id}> відмовився від розгляду апеляції. Апеляція знову доступна для інших модераторів.`);

    // Log to #log1
    const logChannel = await guild.channels.fetch(config.channels.log).catch(() => null);
    if (logChannel) {
      const nowText = formatUkrainianDateTime(Date.now());
      const logEmbed = new EmbedBuilder()
        .setTitle('↩️ [АПЕЛЯЦІЯ] Відмова від розгляду')
        .setColor('#FEE75C')
        .addFields(
          {
            name: '🛡️ Модератор:',
            value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`,
            inline: true
          },
          {
            name: '👤 Автор апеляції:',
            value: `<@${targetId}>`,
            inline: true
          },
          {
            name: '💬 Кімната апеляції:',
            value: `<#${interaction.channel.id}>`,
            inline: true
          },
          {
            name: '⏰ Дата та час:',
            value: `\`${nowText}\``,
            inline: false
          }
        )
        .setFooter({ text: 'Система апеляцій • LUVEX Staff' })
        .setTimestamp();

      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }

    return;
  }

  // 4. Staff clicks "Схвалити апеляцію та зняти ЧС"
  if (action === 'approve') {
    const appealData = db.getAppeal(guild.id, targetId);
    if (!canManageAppeal(interaction.member, appealData)) {
      return interaction.reply({
        content: '❌ Схвалювати апеляції можуть лише призначений модератор або користувачі з посадою **Адміністратор** та вище!',
        ephemeral: true
      });
    }

    const textChannelId = parts[3] || interaction.channelId;
    const voiceChannelId = parts[4];

    let targetMember = null;
    try {
      targetMember = await guild.members.fetch(targetId);
    } catch (e) {}

    const blRecord = db.removeBlacklist(guild.id, targetId);
    db.resolveAppeal(guild.id, targetId, 'approved', interaction.user.id);

    // Remove blacklist role, remove timeout and restore previous roles
    if (targetMember) {
      await targetMember.timeout(null, 'Зняття таймауту при схваленні апеляції').catch(() => {});
      const blRole = guild.roles.cache.get(config.roles.blacklist);
      if (blRole && targetMember.roles.cache.has(blRole.id)) {
        await targetMember.roles.remove(blRole, `Зняття ЧС за апеляцією модератором ${interaction.user.tag}`).catch(() => {});
      }

      // Restore previous roles
      if (blRecord && blRecord.previousRoles && blRecord.previousRoles.length > 0) {
        for (const rId of blRecord.previousRoles) {
          if (rId !== config.roles.blacklist && guild.roles.cache.has(rId)) {
            await targetMember.roles.add(rId, 'Відновлення ролей після апеляції').catch(() => {});
          }
        }
      }

      targetMember.send(`🎉 Вашу апеляцію на сервері **${guild.name}** було схвалено модератором <@${interaction.user.id}>! Чорний Список знято, ваші ролі та доступ повністю відновлено.`).catch(() => {});
    }

    // Send log to #log1
    const logChannel = await guild.channels.fetch(config.channels.log).catch(() => null);
    if (logChannel) {
      const nowText = formatUkrainianDateTime(Date.now());
      const logEmbed = new EmbedBuilder()
        .setTitle('✅ [АПЕЛЯЦІЯ СХВАЛЕНА] Знято Чорний Список')
        .setColor('#57F287')
        .addFields(
          {
            name: '👑 Модератор, який схвалив:',
            value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`,
            inline: true
          },
          {
            name: '👤 Користувач (з кого знято ЧС):',
            value: `<@${targetId}> (\`${targetMember ? targetMember.user.tag : targetId}\`)\n\`ID: ${targetId}\``,
            inline: true
          },
          {
            name: '⏰ Дата та час:',
            value: `\`${nowText}\``,
            inline: false
          }
        )
        .setFooter({ text: 'Система апеляцій • LUVEX Staff' })
        .setTimestamp();

      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }

    await interaction.reply({
      content: `🎉 **Апеляцію схвалено!**\nКористувача <@${targetId}> винесено з Чорного Списку модератором <@${interaction.user.id}>. Ролі та доступ відновлено.\n🗑️ Канали апеляції буде автоматично видалено через 15 секунд...`
    });

    setTimeout(async () => {
      try {
        const tc = guild.channels.cache.get(textChannelId);
        if (tc) await tc.delete('Апеляцію схвалено').catch(() => {});
      } catch {}
      try {
        if (voiceChannelId) {
          const vc = guild.channels.cache.get(voiceChannelId);
          if (vc) await vc.delete('Апеляцію схвалено').catch(() => {});
        }
      } catch {}
    }, 15000);

    return;
  }

  // 5. Staff clicks "Закрити (Немає відкату / Відхилено)"
  if (action === 'reject') {
    const appealData = db.getAppeal(guild.id, targetId);
    if (!canManageAppeal(interaction.member, appealData)) {
      return interaction.reply({
        content: '❌ Закривати апеляції можуть лише призначений модератор або користувачі з посадою **Адміністратор** та вище!',
        ephemeral: true
      });
    }

    const textChannelId = parts[3] || interaction.channelId;
    const voiceChannelId = parts[4] || '';

    const modal = new ModalBuilder()
      .setCustomId(`modal:appeal:reject:${targetId}:${textChannelId}:${voiceChannelId}`)
      .setTitle('Закриття апеляції');

    const input = new TextInputBuilder()
      .setCustomId('reject_reason')
      .setLabel('Причина закриття апеляції')
      .setStyle(TextInputStyle.Paragraph)
      .setValue('Немає відкату / Докази не надані')
      .setPlaceholder('Вкажіть причину закриття апеляції...')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // 6. Invite additional witness/friend
  if (action === 'invite') {
    const textChannelId = parts[3] || interaction.channelId;
    const voiceChannelId = parts[4] || '';

    const modal = new ModalBuilder()
      .setCustomId(`modal:appeal:invite:${targetId}:${textChannelId}:${voiceChannelId}`)
      .setTitle('Запросити свідка / друга з відкатом');

    const input = new TextInputBuilder()
      .setCustomId('witness_user')
      .setLabel('Нікнейм або ID друга/свідка (user2)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Вкажіть нікнейм або ID...')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // 7. Close/Delete Voice Channel
  if (action === 'del_voice') {
    const appealData = db.getAppeal(guild.id, targetId);
    if (!canManageAppeal(interaction.member, appealData)) {
      return interaction.reply({
        content: '❌ Керувати голосовим каналом апеляції можуть лише призначений модератор або Адміністратор і вище!',
        ephemeral: true
      });
    }

    const voiceChannelId = parts[2];
    const voiceChannel = guild.channels.cache.get(voiceChannelId);
    if (voiceChannel) {
      await voiceChannel.delete('Видалення войсу апеляції модератором').catch(() => {});
      return interaction.reply({ content: '🔊 Голосовий канал апеляції успішно закрито/видалено.', ephemeral: true });
    } else {
      return interaction.reply({ content: '⚠️ Голосовий канал вже видалено або не знайдено.', ephemeral: true });
    }
  }
}

// Handle Appeal Modals
async function handleAppealModal(interaction) {
  const customId = interaction.customId;
  const guild = interaction.guild;

  // 1. Blacklisted user submits appeal
  if (customId === 'modal:appeal:submit') {
    await interaction.deferReply({ ephemeral: true });

    const moderatorInput = interaction.fields.getTextInputValue('moderator_input').trim();
    const witnessInput = (interaction.fields.getTextInputValue('witness_input') || '').trim();
    const reason = interaction.fields.getTextInputValue('reason').trim();
    const recording = (interaction.fields.getTextInputValue('recording') || '').trim();
    const userId = interaction.user.id;

    // Remove active timeout from author so they can freely type and talk in the appeal channels
    const authorMember = interaction.member || await guild.members.fetch(userId).catch(() => null);
    if (authorMember && authorMember.communicationDisabledUntilTimestamp && authorMember.communicationDisabledUntilTimestamp > Date.now()) {
      await authorMember.timeout(null, 'Зняття таймауту для спілкування в кімнаті апеляції').catch(() => {});
    }

    // Resolve moderator (user3) and witness (user2)
    const moderatorMember = await findMember(guild, moderatorInput);
    const witnessMember = witnessInput ? await findMember(guild, witnessInput) : null;

    // Get or create dedicated appeals category
    const category = await getOrCreateAppealsCategory(guild);

    // Build permission overwrites for Text Channel
    const botId = interaction.client.user.id;
    const blRoleId = config.roles.blacklist;

    const textOverwrites = [
      {
        id: guild.id,
        deny: [PermissionsBitField.Flags.ViewChannel]
      },
      {
        id: blRoleId,
        deny: [PermissionsBitField.Flags.ViewChannel]
      },
      {
        id: botId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.ManageMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.EmbedLinks,
          PermissionsBitField.Flags.AttachFiles
        ]
      },
      {
        id: userId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks
        ]
      }
    ];

    const voiceOverwrites = [
      {
        id: guild.id,
        deny: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect]
      },
      {
        id: blRoleId,
        deny: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect]
      },
      {
        id: botId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.Connect,
          PermissionsBitField.Flags.Speak,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.MoveMembers
        ]
      },
      {
        id: userId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.Connect,
          PermissionsBitField.Flags.Speak,
          PermissionsBitField.Flags.Stream
        ]
      }
    ];

    // Add witness (user2) if resolved
    if (witnessMember) {
      textOverwrites.push({
        id: witnessMember.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks
        ]
      });
      voiceOverwrites.push({
        id: witnessMember.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.Connect,
          PermissionsBitField.Flags.Speak,
          PermissionsBitField.Flags.Stream
        ]
      });
    }

    // Add moderator (user3) if resolved
    if (moderatorMember) {
      textOverwrites.push({
        id: moderatorMember.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageMessages,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks
        ]
      });
      voiceOverwrites.push({
        id: moderatorMember.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.Connect,
          PermissionsBitField.Flags.Speak,
          PermissionsBitField.Flags.MuteMembers,
          PermissionsBitField.Flags.DeafenMembers,
          PermissionsBitField.Flags.MoveMembers
        ]
      });
    }

    // Administrator and higher roles access ONLY (Administrator, Team Lead, Owner)
    // Regular moder / master cannot view unless they are user3
    const adminRoles = [
      config.roles.admin,
      config.roles.teamLead,
      '1559634990009024532' // Owner role
    ];

    for (const rId of adminRoles) {
      if (rId && guild.roles.cache.has(rId)) {
        textOverwrites.push({
          id: rId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.ManageMessages
          ]
        });
        voiceOverwrites.push({
          id: rId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.Speak,
            PermissionsBitField.Flags.MoveMembers
          ]
        });
      }
    }

    // Sanitize author username for channel name
    const cleanUsername = interaction.user.username.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 15) || userId.slice(0, 8);

    // Create Text Channel
    const textChannel = await guild.channels.create({
      name: `апеляція-${cleanUsername}`,
      type: 0, // GuildText
      parent: category ? category.id : null,
      permissionOverwrites: textOverwrites
    });

    // Create Voice Channel
    const voiceChannel = await guild.channels.create({
      name: `🔊 Апеляція: ${cleanUsername}`,
      type: 2, // GuildVoice
      parent: category ? category.id : null,
      permissionOverwrites: voiceOverwrites
    });

    // Save appeal in DB
    const appealData = {
      userId,
      moderatorInput,
      moderatorId: moderatorMember ? moderatorMember.id : null,
      witnessInput,
      witnessId: witnessMember ? witnessMember.id : null,
      reason,
      recording,
      textChannelId: textChannel.id,
      voiceChannelId: voiceChannel.id,
      claimedBy: null,
      claimedAt: null
    };
    db.createAppeal(guild.id, userId, appealData);

    // Build welcome message data
    const messageData = buildAppealMessageData(guild, appealData);
    const pingMsg = `👋 <@${userId}> ${witnessMember ? `<@${witnessMember.id}> ` : ''}${moderatorMember ? `<@${moderatorMember.id}> ` : ''}<@&${config.roles.admin}>`;
    await textChannel.send({ content: pingMsg, ...messageData });

    // Send log to #log1
    const logChannel = await guild.channels.fetch(config.channels.log).catch(() => null);
    if (logChannel) {
      const nowText = formatUkrainianDateTime(Date.now());
      const logEmbed = new EmbedBuilder()
        .setTitle('⚖️ [АПЕЛЯЦІЯ] Нова апеляція на зняття ЧС')
        .setColor('#5865F2')
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
          {
            name: '👤 Автор апеляції (ЧС / user1):',
            value: `<@${userId}> (\`${interaction.user.tag}\`)\n\`ID: ${userId}\``,
            inline: true
          },
          {
            name: '👮 Модератор ЧС (user3):',
            value: moderatorMember ? `<@${moderatorMember.id}> (\`${moderatorMember.user.tag}\`)` : `\`${moderatorInput}\``,
            inline: true
          },
          {
            name: '👥 Свідок / Друг з відкатом (user2):',
            value: witnessMember ? `<@${witnessMember.id}> (\`${witnessMember.user.tag}\`)` : (witnessInput ? `\`${witnessInput}\`` : '`Не вказано`'),
            inline: true
          },
          {
            name: '💬 Текстовий чат:',
            value: `<#${textChannel.id}>`,
            inline: true
          },
          {
            name: '🔊 Голосовий войс:',
            value: `<#${voiceChannel.id}>`,
            inline: true
          },
          {
            name: '📝 Опис ситуації:',
            value: `\`\`\`\n${reason.slice(0, 500)}\n\`\`\``,
            inline: false
          },
          {
            name: '📹 Інформація про відкат:',
            value: recording ? `\`\`\`\n${recording.slice(0, 500)}\n\`\`\`` : '`Очікується в чаті/войсі`',
            inline: false
          },
          {
            name: '⏰ Дата та час:',
            value: `\`${nowText}\``,
            inline: false
          }
        )
        .setFooter({ text: 'Система апеляцій • LUVEX Staff' })
        .setTimestamp();

      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }

    // Ephemeral response to author
    return interaction.editReply({
      content: `✅ Вашу апеляцію зареєстровано!\nСтворено текстовий чат <#${textChannel.id}> та голосовий войс <#${voiceChannel.id}> для вас, модератора та свідка.\nПерейдіть туди для з'ясування обставин.`
    });
  }

  // 2. Staff submits rejection reason
  if (customId.startsWith('modal:appeal:reject:')) {
    const parts = customId.split(':');
    const targetId = parts[3];
    const textChannelId = parts[4];
    const voiceChannelId = parts[5];
    const rejectReason = interaction.fields.getTextInputValue('reject_reason');

    db.resolveAppeal(guild.id, targetId, 'rejected', interaction.user.id, rejectReason);

    let targetMember = null;
    try {
      targetMember = await guild.members.fetch(targetId);
    } catch (e) {}

    if (targetMember) {
      targetMember.send(`❌ Вашу апеляцію на сервері **${guild.name}** було відхилено/закрито модератором <@${interaction.user.id}>.\n**Причина:** ${rejectReason}\nЧорний Список залишається в силі.`).catch(() => {});
    }

    // Send log to #log1
    const logChannel = await guild.channels.fetch(config.channels.log).catch(() => null);
    if (logChannel) {
      const nowText = formatUkrainianDateTime(Date.now());
      const logEmbed = new EmbedBuilder()
        .setTitle('❌ [АПЕЛЯЦІЯ ЗАКРИТА] ЧС залишено в силі')
        .setColor('#ED4245')
        .addFields(
          {
            name: '👑 Модератор, який закрив:',
            value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`,
            inline: true
          },
          {
            name: '👤 Користувач:',
            value: `<@${targetId}> (\`${targetMember ? targetMember.user.tag : targetId}\`)`,
            inline: true
          },
          {
            name: '📜 Причина закриття:',
            value: rejectReason,
            inline: false
          },
          {
            name: '⏰ Дата та час:',
            value: `\`${nowText}\``,
            inline: false
          }
        )
        .setFooter({ text: 'Система апеляцій • LUVEX Staff' })
        .setTimestamp();

      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }

    await interaction.reply({
      content: `❌ **Апеляцію закрито модератором <@${interaction.user.id}>!**\n**Причина:** ${rejectReason}\nКористувач <@${targetId}> залишається в Чорному Списку.\n🗑️ Канали апеляції буде видалено через 10 секунд...`
    });

    setTimeout(async () => {
      try {
        const tc = guild.channels.cache.get(textChannelId);
        if (tc) await tc.delete('Апеляцію відхилено/закрито').catch(() => {});
      } catch {}
      try {
        if (voiceChannelId) {
          const vc = guild.channels.cache.get(voiceChannelId);
          if (vc) await vc.delete('Апеляцію відхилено/закрито').catch(() => {});
        }
      } catch {}
    }, 10000);

    return;
  }

  // 3. User or staff submits witness invite
  if (customId.startsWith('modal:appeal:invite:')) {
    const parts = customId.split(':');
    const targetId = parts[3];
    const textChannelId = parts[4];
    const voiceChannelId = parts[5];
    const witnessQuery = interaction.fields.getTextInputValue('witness_user');

    const witnessMember = await findMember(guild, witnessQuery);
    if (!witnessMember) {
      return interaction.reply({
        content: `❌ Учасника \`${witnessQuery}\` не знайдено на сервері! Перевірте правильність нікнейму або ID.`,
        ephemeral: true
      });
    }

    const textChannel = guild.channels.cache.get(textChannelId);
    if (textChannel) {
      await textChannel.permissionOverwrites.edit(witnessMember.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true,
        EmbedLinks: true
      }).catch(() => {});

      await textChannel.send(`👋 До розгляду апеляції приєднався свідок <@${witnessMember.id}> (запросив: <@${interaction.user.id}>) для надання відкату.`);
    }

    if (voiceChannelId) {
      const voiceChannel = guild.channels.cache.get(voiceChannelId);
      if (voiceChannel) {
        await voiceChannel.permissionOverwrites.edit(witnessMember.id, {
          ViewChannel: true,
          Connect: true,
          Speak: true,
          Stream: true
        }).catch(() => {});
      }
    }

    return interaction.reply({
      content: `✅ Свідка <@${witnessMember.id}> успішно додано до чату та голосового войсу апеляції!`,
      ephemeral: true
    });
  }
}

module.exports = {
  getAppealPanelData,
  setupBlacklistPermissions,
  handleAppealButton,
  handleAppealModal
};
