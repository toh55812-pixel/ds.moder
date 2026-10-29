const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField
} = require('discord.js');
const config = require('./config');
const db = require('./database');
const { formatUkrainianDateTime, getStaffTier } = require('./roleHistory');

// Parse duration string into ms and human label
function parseBlacklistDuration(str) {
  if (!str) return null;
  const s = str.trim().toLowerCase();
  if (['perm', 'permanent', 'назавжди', 'безстроково', 'inf', 'бессрочно', 'навсегда'].includes(s)) {
    return { ms: null, label: 'Назавжди' };
  }

  const match = s.match(/^(\d+)\s*([smhdwmy])$/);
  if (!match) return null;

  const num = parseInt(match[1], 10);
  if (num <= 0) return null;
  const unit = match[2];
  let ms = 0;
  let labelUnit = '';

  switch (unit) {
    case 's':
      ms = num * 1000;
      labelUnit = num === 1 ? 'секунда' : (num < 5 ? 'секунди' : 'секунд');
      break;
    case 'm':
      ms = num * 60 * 1000;
      labelUnit = num === 1 ? 'хвилина' : (num < 5 ? 'хвилини' : 'хвилин');
      break;
    case 'h':
      ms = num * 60 * 60 * 1000;
      labelUnit = num === 1 ? 'година' : (num < 5 ? 'години' : 'годин');
      break;
    case 'd':
      ms = num * 24 * 60 * 60 * 1000;
      labelUnit = num === 1 ? 'день' : (num < 5 ? 'дні' : 'днів');
      break;
    case 'w':
      ms = num * 7 * 24 * 60 * 60 * 1000;
      labelUnit = num === 1 ? 'тиждень' : (num < 5 ? 'тижні' : 'тижнів');
      break;
    case 'y':
      ms = num * 365 * 24 * 60 * 60 * 1000;
      labelUnit = num === 1 ? 'рік' : (num < 5 ? 'роки' : 'років');
      break;
    default:
      return null;
  }

  return { ms, label: `${num} ${labelUnit}` };
}

// Format remaining time nicely
function formatRemainingTime(expiresAt) {
  if (!expiresAt) return 'Безстроково (назавжди)';
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Термін закінчився';

  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const mins = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));

  const parts = [];
  if (days > 0) parts.push(`${days} дн.`);
  if (hours > 0) parts.push(`${hours} год.`);
  if (mins > 0 && days === 0) parts.push(`${mins} хв.`);
  return parts.length > 0 ? parts.join(' ') : 'менше хвилини';
}

// Build the List Embed of all blacklisted members
async function createBlacklistListEmbed(guild, page = 0) {
  const allBlacklisted = db.getAllBlacklisted(guild.id);
  const pageSize = 10;
  const maxPages = Math.max(1, Math.ceil(allBlacklisted.length / pageSize));
  const currentPage = Math.min(Math.max(0, page), maxPages - 1);
  const start = currentPage * pageSize;
  const pagedList = allBlacklisted.slice(start, start + pageSize);

  const embed = new EmbedBuilder()
    .setTitle('⛔ Чорний Список сервера (ЧС)')
    .setColor('#2B2D31')
    .setThumbnail(guild.iconURL({ dynamic: true }) || undefined)
    .setFooter({ text: `Сторінка ${currentPage + 1} з ${maxPages} • Всього в ЧС: ${allBlacklisted.length}` })
    .setTimestamp();

  if (allBlacklisted.length === 0) {
    embed.setDescription('Наразі в **Чорному Списку** сервера немає жодного учасника.');
    return {
      embeds: [embed],
      components: []
    };
  }

  const lines = [];
  const selectOptions = [];

  for (let i = 0; i < pagedList.length; i++) {
    const record = pagedList[i];
    let memberTag = `ID: ${record.userId}`;
    let avatarUrl = null;

    try {
      const user = await guild.client.users.fetch(record.userId).catch(() => null);
      if (user) {
        memberTag = user.tag;
        avatarUrl = user.displayAvatarURL({ dynamic: true });
      }
    } catch {}

    const indexNum = start + i + 1;
    const durationLabel = record.durationStr || 'Назавжди';
    const remainingLabel = formatRemainingTime(record.expiresAt);
    const dateFormatted = formatUkrainianDateTime(record.createdAt);
    const reasonText = record.reason || 'Не вказано';

    lines.push(
      `**${indexNum}. <@${record.userId}>** (\`${memberTag}\`)\n` +
      `├ 👮 **Хто видав:** <@${record.moderatorId}>\n` +
      `├ 💬 **За що (причина):** \`${reasonText.length > 55 ? reasonText.slice(0, 52) + '...' : reasonText}\`\n` +
      `├ ⏳ **Термін:** \`${durationLabel}\` (Залишилось: \`${remainingLabel}\`)\n` +
      `└ 📅 **Дата покарання:** \`${dateFormatted}\``
    );

    selectOptions.push({
      label: `${memberTag}`.slice(0, 100),
      description: `Термін: ${durationLabel} | ${reasonText}`.slice(0, 100),
      value: record.userId,
      emoji: '⛔'
    });
  }

  embed.setDescription(
    `Усього активних блокувань у ЧС: **${allBlacklisted.length}**\n\n` +
    lines.join('\n\n')
  );

  const components = [];

  // Select menu to view details and actions for a member
  if (selectOptions.length > 0) {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('bl:panel:select_user')
      .setPlaceholder('🔍 Оберіть порушника для перегляду та дій...')
      .addOptions(selectOptions.slice(0, 25));

    components.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  // Pagination buttons
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bl:panel:page:${currentPage - 1}`)
      .setLabel('⬅️ Попередня')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 0),
    new ButtonBuilder()
      .setCustomId(`bl:panel:page:${currentPage + 1}`)
      .setLabel('➡️ Наступна')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= maxPages - 1),
    new ButtonBuilder()
      .setCustomId(`bl:panel:refresh_list:${currentPage}`)
      .setLabel('🔄 Оновити')
      .setStyle(ButtonStyle.Secondary)
  );

  components.push(navRow);

  return {
    embeds: [embed],
    components
  };
}

// Format a single punishment entry with who issued and reason
function formatPunishmentEntry(guild, entry) {
  const dateStr = formatUkrainianDateTime(entry.createdAt);
  let modStr = entry.moderatorId ? `<@${entry.moderatorId}>` : '`Система`';
  if (entry.moderatorTag) {
    modStr += ` (\`${entry.moderatorTag}\`)`;
  }

  let typeName = 'Покарання';
  let emoji = '⚠️';
  let termInfo = '';

  switch (entry.type) {
    case 'blacklist':
      emoji = '⛔';
      typeName = 'Чорний Список (ЧС)';
      if (entry.durationStr) termInfo = `\n    ├ ⏳ **Термін:** \`${entry.durationStr}\``;
      break;
    case 'bl_extend':
      emoji = '➕';
      typeName = 'Збільшення терміну ЧС';
      if (entry.durationStr) termInfo = `\n    ├ ⏳ **Новий термін:** \`${entry.durationStr}\``;
      break;
    case 'bl_duration':
      emoji = '⏱️';
      typeName = 'Зміна терміну ЧС';
      if (entry.durationStr) termInfo = `\n    ├ ⏳ **Встановлено:** \`${entry.durationStr}\``;
      break;
    case 'bl_remove':
      emoji = '🕊️';
      typeName = 'Зняття з Чорного Списку';
      break;
    case 'bl_appeal_approved':
      emoji = '🕊️';
      typeName = 'Зняття ЧС (Апеляція схвалена)';
      break;
    case 'warn':
      emoji = '⚠️';
      typeName = 'Варн (Догана)';
      break;
    case 'pred':
      emoji = '🟡';
      typeName = 'Попередження (Пред)';
      break;
    case 'kick':
      emoji = '👢';
      typeName = 'Кік з сервера';
      break;
    case 'mute':
    case 'timeout':
      emoji = '🔇';
      typeName = 'Таймаут / Мут';
      break;
    default:
      emoji = '📌';
      typeName = entry.type;
  }

  return (
    `• ${emoji} **[${typeName}]** — \`${dateStr}\`\n` +
    `    ├ 👮 **Хто видав:** ${modStr}${termInfo}\n` +
    `    └ 💬 **За що (причина):** \`${entry.reason || 'Не вказано'}\``
  );
}

// Build dedicated full punishment history view
async function createFullPunishmentHistoryEmbed(guild, targetUserId, page = 0) {
  let user = null;
  try {
    user = await guild.client.users.fetch(targetUserId).catch(() => null);
  } catch {}

  const userTag = user ? user.tag : targetUserId;
  const avatarUrl = user ? user.displayAvatarURL({ dynamic: true, size: 256 }) : (guild.iconURL({ dynamic: true }) || null);

  const history = db.getUserPunishmentHistory(guild.id, targetUserId);
  const pageSize = 5;
  const maxPages = Math.max(1, Math.ceil(history.length / pageSize));
  const currentPage = Math.min(Math.max(0, page), maxPages - 1);
  const start = currentPage * pageSize;
  const pagedList = history.slice(start, start + pageSize);

  const embed = new EmbedBuilder()
    .setTitle(`📜 Повна історія покарань: ${userTag}`)
    .setColor('#ED4245')
    .setThumbnail(avatarUrl)
    .setFooter({ text: `Сторінка ${currentPage + 1} з ${maxPages} • Всього покарань: ${history.length}` })
    .setTimestamp();

  if (history.length === 0) {
    embed.setDescription(
      `👤 **Користувач:** <@${targetUserId}> (\`${userTag}\`)\n\`ID: ${targetUserId}\`\n\n` +
      `✅ У даного користувача немає зареєстрованих покарань у базі даних сервера.`
    );
  } else {
    const formattedLines = pagedList.map(entry => formatPunishmentEntry(guild, entry));
    embed.setDescription(
      `👤 **Користувач:** <@${targetUserId}> (\`${userTag}\`)\n` +
      `Всього покарань: **${history.length}**\n\n` +
      formattedLines.join('\n\n')
    );
  }

  const buttons = [];
  if (currentPage > 0) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`bl:panel:hist_page:${targetUserId}:${currentPage - 1}`)
        .setLabel('⬅️ Назад')
        .setStyle(ButtonStyle.Secondary)
    );
  }
  if (currentPage < maxPages - 1) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`bl:panel:hist_page:${targetUserId}:${currentPage + 1}`)
        .setLabel('Вперед ➡️')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId(`bl:panel:user:${targetUserId}`)
      .setLabel('До картки')
      .setEmoji('↩️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('bl:panel:list')
      .setLabel('До списку ЧС')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(buttons)]
  };
}

// Build the detailed Punishment Card for a specific user
async function createBlacklistUserCard(guild, targetUserId, executorMember = null) {
  const record = db.getBlacklistRecord(guild.id, targetUserId);

  let user = null;
  let member = null;
  try {
    user = await guild.client.users.fetch(targetUserId).catch(() => null);
    member = await guild.members.fetch(targetUserId).catch(() => null);
  } catch {}

  const userTag = user ? user.tag : targetUserId;
  const avatarUrl = user ? user.displayAvatarURL({ dynamic: true, size: 256 }) : (guild.iconURL({ dynamic: true }) || null);

  const allPunishments = db.getUserPunishmentHistory(guild.id, targetUserId);
  const warnCount = db.getInfractionsCount(guild.id, targetUserId, 'warn');
  const predCount = db.getInfractionsCount(guild.id, targetUserId, 'pred');

  // If user is NOT in blacklist
  if (!record) {
    const notInEmbed = new EmbedBuilder()
      .setTitle('ℹ️ Інформація про учасника & Історія покарань')
      .setColor('#5865F2')
      .setThumbnail(avatarUrl)
      .setDescription(
        `Користувач <@${targetUserId}> (\`${userTag}\`) **не перебуває** в Чорному Списку сервера на даний момент.\n\n` +
        `> ⛔ **Статус ЧС:** \`Чистий\`\n` +
        `> ⚠️ **Варнів:** \`${warnCount}\` | 🟡 **Попереджень:** \`${predCount}\` | 📜 **Всього покарань:** \`${allPunishments.length}\``
      )
      .setFooter({ text: 'Система Чорного Списку • LUVEX Staff' })
      .setTimestamp();

    if (allPunishments.length > 0) {
      const topPunishments = allPunishments.slice(0, 4).map(entry => formatPunishmentEntry(guild, entry));
      const extraNote = allPunishments.length > 4 ? `\n\n*Показано останні 4 записи. Натисніть «📜 Вся історія» для перегляду всіх ${allPunishments.length} покарань.*` : '';
      notInEmbed.addFields({
        name: '📜 Історія покарань даної особи (Хто видав і за що):',
        value: topPunishments.join('\n\n') + extraNote,
        inline: false
      });
    } else {
      notInEmbed.addFields({
        name: '📜 Історія покарань даної особи:',
        value: '`Жодних покарань у базі даних не знайдено (користувач чистий).`',
        inline: false
      });
    }

    const buttons = [
      new ButtonBuilder()
        .setCustomId(`bl:panel:add_new:${targetUserId}`)
        .setLabel('Внести в ЧС')
        .setEmoji('⛔')
        .setStyle(ButtonStyle.Danger)
    ];

    if (allPunishments.length > 0) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`bl:panel:full_history:${targetUserId}`)
          .setLabel('Вся історія')
          .setEmoji('📜')
          .setStyle(ButtonStyle.Primary)
      );
    }

    buttons.push(
      new ButtonBuilder()
        .setCustomId('bl:panel:list')
        .setLabel('До списку ЧС')
        .setEmoji('📋')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`bl:panel:refresh:${targetUserId}`)
        .setLabel('Оновити')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary)
    );

    return {
      embeds: [notInEmbed],
      components: [new ActionRowBuilder().addComponents(buttons)]
    };
  }

  // Moderator who issued blacklist
  let modTag = record.moderatorTag || record.moderatorId;
  if (!record.moderatorTag && record.moderatorId) {
    try {
      const modUser = await guild.client.users.fetch(record.moderatorId).catch(() => null);
      if (modUser) modTag = modUser.tag;
    } catch {}
  }

  const durationStr = record.durationStr || 'Назавжди';
  const remainingStr = formatRemainingTime(record.expiresAt);
  const createdDate = formatUkrainianDateTime(record.createdAt);
  const expiryDate = record.expiresAt ? formatUkrainianDateTime(record.expiresAt) : 'Безстроково (назавжди)';

  // Build History section from allPunishments
  const topHistory = allPunishments.slice(0, 4).map(entry => formatPunishmentEntry(guild, entry));
  const extraNote = allPunishments.length > 4 ? `\n\n*Показано останні 4 записи. Натисніть кнопку «📜 Вся історія покарань» нижче (всього покарань: ${allPunishments.length}).*` : '';
  const historyValue = topHistory.length > 0 ? (topHistory.join('\n\n') + extraNote) : '`Немає зареєстрованих записів.`';

  const embed = new EmbedBuilder()
    .setTitle('⛔ Картка покарання: Чорний Список (ЧС)')
    .setColor('#ED4245')
    .setThumbnail(avatarUrl)
    .addFields(
      {
        name: '👤 Порушник:',
        value: `<@${targetUserId}> (\`${userTag}\`)\n\`ID: ${targetUserId}\``,
        inline: true
      },
      {
        name: '👮 Хто видав покарання:',
        value: `<@${record.moderatorId}> (\`${modTag}\`)\n\`ID: ${record.moderatorId}\``,
        inline: true
      },
      {
        name: '⏳ Встановлений термін:',
        value: `\`${durationStr}\``,
        inline: true
      },
      {
        name: '⏰ Залишилось часу:',
        value: `\`${remainingStr}\``,
        inline: true
      },
      {
        name: '📅 Дата та час видачі:',
        value: `\`${createdDate}\``,
        inline: true
      },
      {
        name: '⌛ Дата закінчення покарання:',
        value: `\`${expiryDate}\``,
        inline: true
      },
      {
        name: '📜 Причина внесення до ЧС (за що):',
        value: `\`\`\`\n${record.reason || 'Не вказано'}\n\`\`\``,
        inline: false
      },
      {
        name: '📊 Загальна статистика порушника:',
        value: `> ⛔ **ЧС:** \`Активний\` | ⚠️ **Варнів:** \`${warnCount}\` | 🟡 **Попереджень:** \`${predCount}\` | 📜 **Всього покарань:** \`${allPunishments.length}\``,
        inline: false
      },
      {
        name: '📜 Історія покарань даної особи (Хто видав і за що):',
        value: historyValue,
        inline: false
      }
    )
    .setFooter({ text: 'Система покарань Чорного Списку • LUVEX Staff' })
    .setTimestamp();

  // Row 1: Зняти ЧС, Збільшити термін, Змінити термін
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bl:panel:rem:${targetUserId}`)
      .setLabel('Зняти ЧС серв')
      .setEmoji('🕊️')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`bl:panel:extend:${targetUserId}`)
      .setLabel('Збільшити термін')
      .setEmoji('➕')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`bl:panel:set_duration:${targetUserId}`)
      .setLabel('Змінити термін')
      .setEmoji('⏱️')
      .setStyle(ButtonStyle.Secondary)
  );

  // Row 2: Вся історія, До списку ЧС, Оновити
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bl:panel:full_history:${targetUserId}`)
      .setLabel('Вся історія покарань')
      .setEmoji('📜')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('bl:panel:list')
      .setLabel('До списку ЧС')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`bl:panel:refresh:${targetUserId}`)
      .setLabel('Оновити')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [row1, row2]
  };
}

// Handle Blacklist Buttons
async function handleBlacklistButton(interaction, canManageStaffFunc) {
  const customId = interaction.customId;
  const parts = customId.split(':');
  const action = parts[2]; // e.g. list, page, rem, extend, set_duration, add_new, refresh, user, full_history, hist_page
  const targetId = parts[3];
  const guild = interaction.guild;

  // 1. Back to Blacklist List
  if (action === 'list') {
    const listData = await createBlacklistListEmbed(guild, 0);
    return interaction.update(listData);
  }

  // 1.1 Show User Card
  if (action === 'user') {
    const cardData = await createBlacklistUserCard(guild, targetId, interaction.member);
    return interaction.update(cardData);
  }

  // 1.2 Show Full Punishment History
  if (action === 'full_history') {
    const historyData = await createFullPunishmentHistoryEmbed(guild, targetId, 0);
    return interaction.update(historyData);
  }

  // 1.3 Full History Pagination
  if (action === 'hist_page') {
    const pageNum = parseInt(parts[4], 10) || 0;
    const historyData = await createFullPunishmentHistoryEmbed(guild, targetId, pageNum);
    return interaction.update(historyData);
  }

  // 2. Pagination for Blacklist List
  if (action === 'page') {
    const pageNum = parseInt(targetId, 10) || 0;
    const listData = await createBlacklistListEmbed(guild, pageNum);
    return interaction.update(listData);
  }

  // 3. Refresh list
  if (action === 'refresh_list') {
    const pageNum = parseInt(targetId, 10) || 0;
    const listData = await createBlacklistListEmbed(guild, pageNum);
    return interaction.update(listData);
  }

  // 4. Refresh specific user card
  if (action === 'refresh') {
    const cardData = await createBlacklistUserCard(guild, targetId, interaction.member);
    return interaction.update(cardData);
  }

  // Management actions require canManageStaff
  if (!canManageStaffFunc(interaction.member)) {
    return interaction.reply({
      content: '❌ Керувати Чорним Списком можуть лише користувачі з роллю **Master** та вище!',
      ephemeral: true
    });
  }

  // 5. Remove Blacklist (Зняти ЧС серв)
  if (action === 'rem') {
    let targetMember = null;
    try {
      targetMember = await guild.members.fetch(targetId).catch(() => null);
    } catch {}

    const blRecord = db.removeBlacklist(guild.id, targetId);

    if (targetMember) {
      // Remove timeout
      await targetMember.timeout(null, `Зняття ЧС модератором ${interaction.user.tag}`).catch(() => {});

      // Remove blacklist role
      const blRole = guild.roles.cache.get(config.roles.blacklist);
      if (blRole && targetMember.roles.cache.has(blRole.id)) {
        await targetMember.roles.remove(blRole, `Зняття ЧС модератором ${interaction.user.tag}`).catch(() => {});
      }

      // Restore previous roles
      if (blRecord && Array.isArray(blRecord.previousRoles) && blRecord.previousRoles.length > 0) {
        for (const rId of blRecord.previousRoles) {
          if (blRole && rId === blRole.id) continue;
          if (guild.roles.cache.has(rId)) {
            await targetMember.roles.add(rId, 'Відновлення ролей після зняття ЧС').catch(() => {});
          }
        }
      }

      targetMember.send(`🎉 Вас було винесено з **Чорного Списку** сервера **${guild.name}** модератором <@${interaction.user.id}>! Всі ролі та доступ відновлено.`).catch(() => {});
    }

    // Log to #log1
    const logChannel = await guild.channels.fetch(config.channels.log).catch(() => null);
    if (logChannel) {
      const nowText = formatUkrainianDateTime(Date.now());
      const logEmbed = new EmbedBuilder()
        .setTitle('🕊️ [ЧОРНИЙ СПИСОК] Дострокове зняття ЧС')
        .setColor('#57F287')
        .addFields(
          {
            name: '👑 Модератор, який зняв ЧС:',
            value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`,
            inline: true
          },
          {
            name: '👤 Користувач:',
            value: `<@${targetId}> (\`${targetMember ? targetMember.user.tag : targetId}\`)`,
            inline: true
          },
          {
            name: '⏰ Дата та час:',
            value: `\`${nowText}\``,
            inline: false
          }
        )
        .setFooter({ text: 'Система Чорного Списку • LUVEX Staff' })
        .setTimestamp();

      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }

    // Refresh card
    const refreshed = await createBlacklistUserCard(guild, targetId, interaction.member);
    await interaction.update(refreshed);

    await interaction.followUp({
      content: `✅ Користувача <@${targetId}> успішно винесено з **Чорного Списку** сервера! Ролі відновлено.`,
      ephemeral: true
    });
    return;
  }

  // 6. Extend Blacklist duration modal (Збільшити термін)
  if (action === 'extend') {
    const modal = new ModalBuilder()
      .setCustomId(`modal:bl:extend:${targetId}`)
      .setTitle('Збільшення терміну ЧС');

    const timeInput = new TextInputBuilder()
      .setCustomId('extra_time')
      .setLabel('На скільки збільшити? (напр: 7d, 14d, 30d)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Вкажіть термін: 7d (7 днів), 14d, 30d тощо')
      .setRequired(true);

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Причина збільшення терміну')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Вкажіть причину продовження блокування...')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(timeInput),
      new ActionRowBuilder().addComponents(reasonInput)
    );

    return interaction.showModal(modal);
  }

  // 7. Set new duration modal (Змінити термін)
  if (action === 'set_duration') {
    const modal = new ModalBuilder()
      .setCustomId(`modal:bl:set_duration:${targetId}`)
      .setTitle('Встановлення нового терміну ЧС');

    const durationInput = new TextInputBuilder()
      .setCustomId('new_duration')
      .setLabel('Новий термін (напр: 30d, 7d, назавжди)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('30d, 7d або permanent / назавжди')
      .setRequired(true);

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Причина зміни терміну')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Вкажіть причину зміни терміну...')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(durationInput),
      new ActionRowBuilder().addComponents(reasonInput)
    );

    return interaction.showModal(modal);
  }

  // 8. Add new user to Blacklist modal
  if (action === 'add_new') {
    const modal = new ModalBuilder()
      .setCustomId(`modal:bl:add_new:${targetId}`)
      .setTitle('Занесення в Чорний Список');

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Причина занесення в ЧС')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Вкажіть причину занесення в ЧС...')
      .setRequired(true);

    const durationInput = new TextInputBuilder()
      .setCustomId('duration')
      .setLabel('Термін покарання (напр: 30d, назавжди)')
      .setStyle(TextInputStyle.Short)
      .setValue('Назавжди')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(reasonInput),
      new ActionRowBuilder().addComponents(durationInput)
    );

    return interaction.showModal(modal);
  }
}

// Handle String Select Menu (user selection from list)
async function handleBlacklistSelect(interaction, canManageStaffFunc) {
  const customId = interaction.customId;
  const guild = interaction.guild;

  if (customId === 'bl:panel:select_user') {
    const selectedUserId = interaction.values[0];
    const cardData = await createBlacklistUserCard(guild, selectedUserId, interaction.member);
    return interaction.update(cardData);
  }
}

// Handle Blacklist Modal Submissions
async function handleBlacklistModal(interaction, canManageStaffFunc) {
  const customId = interaction.customId;
  const parts = customId.split(':');
  const action = parts[2];
  const targetId = parts[3];
  const guild = interaction.guild;

  // 1. Extend Blacklist duration
  if (action === 'extend') {
    const extraTimeInput = interaction.fields.getTextInputValue('extra_time').trim();
    const reason = (interaction.fields.getTextInputValue('reason') || '').trim();

    const parsed = parseBlacklistDuration(extraTimeInput);
    if (!parsed || parsed.ms === null) {
      return interaction.reply({
        content: '❌ Невірний формат тривалості! Використовуйте, наприклад: `7d` (7 днів), `14d` (14 днів), `30d` (30 днів).',
        ephemeral: true
      });
    }

    const currentRecord = db.getBlacklistRecord(guild.id, targetId);
    if (!currentRecord) {
      return interaction.reply({
        content: '⚠️ Користувач вже не перебуває в Чорному Списку!',
        ephemeral: true
      });
    }

    // Compute new expiration
    const baseTime = currentRecord.expiresAt && new Date(currentRecord.expiresAt).getTime() > Date.now()
      ? new Date(currentRecord.expiresAt).getTime()
      : Date.now();

    const newExpiresTimestamp = baseTime + parsed.ms;
    const newExpiresAt = new Date(newExpiresTimestamp).toISOString();
    const newDurationStr = `${currentRecord.durationStr || 'Термін'} + ${parsed.label}`;

    db.updateBlacklistDuration(
      guild.id,
      targetId,
      interaction.user.id,
      parsed.ms,
      newDurationStr,
      newExpiresAt,
      interaction.user.tag,
      reason
    );

    // Notify user in DM
    let targetMember = null;
    try {
      targetMember = await guild.members.fetch(targetId).catch(() => null);
    } catch {}

    if (targetMember) {
      targetMember.send(
        `⚠️ Ваш термін перебування в **Чорному Списку** на сервері **${guild.name}** було збільшено на **${parsed.label}** модератором <@${interaction.user.id}>.\n` +
        `**Новий дедлайн:** \`${formatUkrainianDateTime(newExpiresAt)}\`\n` +
        (reason ? `**Причина продовження:** ${reason}` : '')
      ).catch(() => {});
    }

    // Log to #log1
    const logChannel = await guild.channels.fetch(config.channels.log).catch(() => null);
    if (logChannel) {
      const nowText = formatUkrainianDateTime(Date.now());
      const logEmbed = new EmbedBuilder()
        .setTitle('➕ [ЧОРНИЙ СПИСОК] Збільшення терміну покарання')
        .setColor('#FFA500')
        .addFields(
          {
            name: '👑 Модератор:',
            value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`,
            inline: true
          },
          {
            name: '👤 Порушник:',
            value: `<@${targetId}> (\`${targetMember ? targetMember.user.tag : targetId}\`)`,
            inline: true
          },
          {
            name: '⏱️ Додано часу:',
            value: `\`+${parsed.label}\``,
            inline: true
          },
          {
            name: '⌛ Новий дедлайн закінчення:',
            value: `\`${formatUkrainianDateTime(newExpiresAt)}\``,
            inline: true
          },
          {
            name: '📜 Причина продовження:',
            value: reason ? `\`${reason}\`` : '`Не вказано`',
            inline: false
          },
          {
            name: '⏰ Дата та час дії:',
            value: `\`${nowText}\``,
            inline: false
          }
        )
        .setFooter({ text: 'Система Чорного Списку • LUVEX Staff' })
        .setTimestamp();

      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }

    const refreshed = await createBlacklistUserCard(guild, targetId, interaction.member);
    await interaction.update(refreshed);

    await interaction.followUp({
      content: `✅ Термін покарання для <@${targetId}> успішно збільшено на **${parsed.label}**! Новий дедлайн: \`${formatUkrainianDateTime(newExpiresAt)}\`.`,
      ephemeral: true
    });
    return;
  }

  // 2. Set new Blacklist duration
  if (action === 'set_duration') {
    const durationInput = interaction.fields.getTextInputValue('new_duration').trim();
    const reason = (interaction.fields.getTextInputValue('reason') || '').trim();

    const parsed = parseBlacklistDuration(durationInput);
    if (!parsed) {
      return interaction.reply({
        content: '❌ Невірний формат тривалості! Використовуйте, наприклад: `30d` (30 днів), `7d` (7 днів) або `назавжди` (безстроково).',
        ephemeral: true
      });
    }

    const currentRecord = db.getBlacklistRecord(guild.id, targetId);
    if (!currentRecord) {
      return interaction.reply({
        content: '⚠️ Користувач не перебуває в Чорному Списку!',
        ephemeral: true
      });
    }

    const newExpiresAt = parsed.ms ? new Date(Date.now() + parsed.ms).toISOString() : null;
    const newDurationStr = parsed.label;

    db.updateBlacklistDuration(
      guild.id,
      targetId,
      interaction.user.id,
      null,
      newDurationStr,
      newExpiresAt,
      interaction.user.tag,
      reason
    );

    let targetMember = null;
    try {
      targetMember = await guild.members.fetch(targetId).catch(() => null);
    } catch {}

    if (targetMember) {
      targetMember.send(
        `⏱️ Ваш термін у **Чорному Списку** сервера **${guild.name}** було змінено на **${newDurationStr}** модератором <@${interaction.user.id}>.\n` +
        `**Новий дедлайн:** \`${newExpiresAt ? formatUkrainianDateTime(newExpiresAt) : 'Безстроково (назавжди)'}\`\n` +
        (reason ? `**Причина:** ${reason}` : '')
      ).catch(() => {});
    }

    // Log to #log1
    const logChannel = await guild.channels.fetch(config.channels.log).catch(() => null);
    if (logChannel) {
      const nowText = formatUkrainianDateTime(Date.now());
      const logEmbed = new EmbedBuilder()
        .setTitle('⏱️ [ЧОРНИЙ СПИСОК] Зміна терміну покарання')
        .setColor('#5865F2')
        .addFields(
          {
            name: '👑 Модератор:',
            value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`,
            inline: true
          },
          {
            name: '👤 Порушник:',
            value: `<@${targetId}> (\`${targetMember ? targetMember.user.tag : targetId}\`)`,
            inline: true
          },
          {
            name: '⏳ Встановлений термін:',
            value: `\`${newDurationStr}\``,
            inline: true
          },
          {
            name: '⌛ Дедлайн закінчення:',
            value: `\`${newExpiresAt ? formatUkrainianDateTime(newExpiresAt) : 'Безстроково (назавжди)'}\``,
            inline: true
          },
          {
            name: '📜 Причина зміни:',
            value: reason ? `\`${reason}\`` : '`Не вказано`',
            inline: false
          },
          {
            name: '⏰ Дата та час дії:',
            value: `\`${nowText}\``,
            inline: false
          }
        )
        .setFooter({ text: 'Система Чорного Списку • LUVEX Staff' })
        .setTimestamp();

      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }

    const refreshed = await createBlacklistUserCard(guild, targetId, interaction.member);
    await interaction.update(refreshed);

    await interaction.followUp({
      content: `✅ Термін ЧС для <@${targetId}> встановлено: **${newDurationStr}** (\`${newExpiresAt ? formatUkrainianDateTime(newExpiresAt) : 'Безстроково'}\`).`,
      ephemeral: true
    });
    return;
  }

  // 3. Add new user to Blacklist
  if (action === 'add_new') {
    const reason = interaction.fields.getTextInputValue('reason').trim();
    const durationInput = (interaction.fields.getTextInputValue('duration') || 'Назавжди').trim();

    const parsed = parseBlacklistDuration(durationInput) || { ms: null, label: 'Назавжди' };
    const expiresAt = parsed.ms ? new Date(Date.now() + parsed.ms).toISOString() : null;

    let targetMember = null;
    try {
      targetMember = await guild.members.fetch(targetId).catch(() => null);
    } catch {}

    const rolesToSave = targetMember
      ? targetMember.roles.cache.filter(r => r.id !== guild.id && !r.managed).map(r => r.id)
      : [];

    db.addBlacklist(
      guild.id,
      targetId,
      interaction.user.id,
      reason,
      rolesToSave,
      parsed.label,
      expiresAt,
      interaction.user.tag
    );
    db.addStaffAction(guild.id, interaction.user.id, 'moderator');

    if (targetMember) {
      // Remove timeout and mute roles
      await targetMember.timeout(null, 'Зняття таймауту при внесенні в ЧС').catch(() => {});
      const muteRoles = [config.roles.mutedChat, config.roles.mutedVoice];
      for (const rId of muteRoles) {
        if (rId && targetMember.roles.cache.has(rId)) {
          await targetMember.roles.remove(rId).catch(() => {});
        }
      }

      // Strip roles
      if (rolesToSave.length > 0) {
        await targetMember.roles.remove(rolesToSave, 'Внесення в ЧС (зняття ролей)').catch(() => {});
      }

      // Assign Blacklist role
      const blRole = guild.roles.cache.get(config.roles.blacklist);
      if (blRole) {
        await targetMember.roles.add(blRole, `Занесення в ЧС модератором ${interaction.user.tag}`).catch(() => {});
      }

      targetMember.send(
        `⛔ Вас було внесено до **Чорного Списку** сервера **${guild.name}**.\n` +
        `**Термін:** \`${parsed.label}\` (${expiresAt ? formatUkrainianDateTime(expiresAt) : 'Безстроково'})\n` +
        `**Причина:** ${reason}\n\n` +
        `Вам заблоковано доступ до всіх каналів та чатів. Для вас доступний лише канал апеляцій <#${config.channels.appeal}>.`
      ).catch(() => {});
    }

    // Log to #log1
    const logChannel = await guild.channels.fetch(config.channels.log).catch(() => null);
    if (logChannel) {
      const nowText = formatUkrainianDateTime(Date.now());
      const logEmbed = new EmbedBuilder()
        .setTitle('⛔ [ЧОРНИЙ СПИСОК] Внесення до ЧС')
        .setColor('#ED4245')
        .addFields(
          {
            name: '👑 Модератор:',
            value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`,
            inline: true
          },
          {
            name: '👤 Порушник:',
            value: `<@${targetId}> (\`${targetMember ? targetMember.user.tag : targetId}\`)`,
            inline: true
          },
          {
            name: '⏳ Термін покарання:',
            value: `\`${parsed.label}\``,
            inline: true
          },
          {
            name: '⌛ Закінчується:',
            value: `\`${expiresAt ? formatUkrainianDateTime(expiresAt) : 'Безстроково'}\``,
            inline: true
          },
          {
            name: '📜 Причина:',
            value: `\`\`\`\n${reason}\n\`\`\``,
            inline: false
          },
          {
            name: '⏰ Дата та час:',
            value: `\`${nowText}\``,
            inline: false
          }
        )
        .setFooter({ text: 'Система Чорного Списку • LUVEX Staff' })
        .setTimestamp();

      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }

    const refreshed = await createBlacklistUserCard(guild, targetId, interaction.member);
    await interaction.update(refreshed);

    await interaction.followUp({
      content: `⛔ Користувача <@${targetId}> успішно додано до **Чорного Списку** на термін **${parsed.label}**!`,
      ephemeral: true
    });
    return;
  }
}

// Background Task: Check for expired temporary blacklists
function startBlacklistExpirationChecker(client) {
  setInterval(async () => {
    try {
      for (const [, guild] of client.guilds.cache) {
        const allBlacklisted = db.getAllBlacklisted(guild.id);
        const now = Date.now();

        for (const record of allBlacklisted) {
          if (record.expiresAt && new Date(record.expiresAt).getTime() <= now) {
            console.log(`[Blacklist] Термін ЧС закінчився для користувача ${record.userId}. Автоматичне зняття...`);

            const targetId = record.userId;
            const blRecord = db.removeBlacklist(guild.id, targetId);

            let targetMember = null;
            try {
              targetMember = await guild.members.fetch(targetId).catch(() => null);
            } catch {}

            if (targetMember) {
              await targetMember.timeout(null, 'Закінчення терміну ЧС').catch(() => {});

              const blRole = guild.roles.cache.get(config.roles.blacklist);
              if (blRole && targetMember.roles.cache.has(blRole.id)) {
                await targetMember.roles.remove(blRole, 'Закінчення терміну ЧС').catch(() => {});
              }

              if (blRecord && Array.isArray(blRecord.previousRoles)) {
                for (const rId of blRecord.previousRoles) {
                  if (blRole && rId === blRole.id) continue;
                  if (guild.roles.cache.has(rId)) {
                    await targetMember.roles.add(rId, 'Відновлення ролей після закінчення терміну ЧС').catch(() => {});
                  }
                }
              }

              targetMember.send(`🎉 Термін вашого покарання в **Чорному Списку** на сервері **${guild.name}** закінчився! Всі ролі та доступ відновлено.`).catch(() => {});
            }

            // Log to #log1
            const logChannel = await guild.channels.fetch(config.channels.log).catch(() => null);
            if (logChannel) {
              const nowText = formatUkrainianDateTime(Date.now());
              const logEmbed = new EmbedBuilder()
                .setTitle('🕊️ [ЧОРНИЙ СПИСОК] Закінчення терміну дії ЧС')
                .setColor('#57F287')
                .addFields(
                  {
                    name: '👤 Користувач:',
                    value: `<@${targetId}> (\`${targetMember ? targetMember.user.tag : targetId}\`)`,
                    inline: true
                  },
                  {
                    name: '⏳ Пробув у ЧС:',
                    value: `\`${record.durationStr || 'Встановлений термін'}\``,
                    inline: true
                  },
                  {
                    name: '📜 Початкова причина:',
                    value: `\`${record.reason || 'Не вказано'}\``,
                    inline: false
                  },
                  {
                    name: '⏰ Дата та час автоматичного зняття:',
                    value: `\`${nowText}\``,
                    inline: false
                  }
                )
                .setFooter({ text: 'Система Чорного Списку • Автоматичне зняття' })
                .setTimestamp();

              await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
            }
          }
        }
      }
    } catch (err) {
      console.error('Error in BlacklistExpirationChecker:', err);
    }
  }, 60 * 1000); // Check every 60 seconds
}

module.exports = {
  parseBlacklistDuration,
  formatRemainingTime,
  createBlacklistListEmbed,
  createBlacklistUserCard,
  createFullPunishmentHistoryEmbed,
  formatPunishmentEntry,
  handleBlacklistButton,
  handleBlacklistSelect,
  handleBlacklistModal,
  startBlacklistExpirationChecker
};
