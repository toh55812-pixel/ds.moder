const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  PermissionsBitField,
  EmbedBuilder
} = require('discord.js');
const config = require('./config');
const db = require('./database');
const {
  getRoleGrantInfo,
  formatUkrainianDateTime,
  getStaffTier,
  getMemberStaffLevel,
  getRoleStaffLevel,
  getStaffLevelTitle
} = require('./roleHistory');
const { parseBlacklistDuration } = require('./blacklist');

// Check if member has standard staff/moderator permissions
function isStaff(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) return true;
  if (member.permissions.has(PermissionsBitField.Flags.KickMembers)) return true;
  if (member.permissions.has(PermissionsBitField.Flags.BanMembers)) return true;
  if (member.permissions.has(PermissionsBitField.Flags.ManageRoles)) return true;

  const staffRoleNames = [
    'moder', 'moderator', 'staffmoder', 'suport', 'support',
    'closemode', 'closer', 'admin', 'administrator', 'curator', 'team leed', 'master', 'lame'
  ];
  return member.roles.cache.some(r => staffRoleNames.includes(r.name.toLowerCase()));
}

// Check if member is Master or higher
function canManageStaff(member) {
  if (!member) return false;
  if (member.id === member.guild.ownerId) return true;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;

  const masterRole = member.guild.roles.cache.get(config.roles.master) ||
                     member.guild.roles.cache.find(r => r.name.toLowerCase() === 'master');

  if (masterRole) {
    if (member.roles.cache.has(masterRole.id)) return true;
    if (member.roles.highest.position >= masterRole.position) return true;
  }

  const highRanks = ['curator', 'lame', 'team leed', 'admin', 'administrator', 'owner'];
  return member.roles.cache.some(r => highRanks.includes(r.name.toLowerCase()));
}

// Parse string duration into milliseconds
function parseDuration(str) {
  if (!str) return null;
  const match = str.trim().toLowerCase().match(/^(\d+)\s*([smhd])$/);
  if (!match) return null;

  const num = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's': return num * 1000;
    case 'm': return num * 60 * 1000;
    case 'h': return num * 60 * 60 * 1000;
    case 'd': return num * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

// Find role by id or name, or create if needed
async function getOrCreateRole(guild, roleId, roleName, color = null) {
  let role = null;
  if (roleId) {
    role = guild.roles.cache.get(roleId);
  }
  if (!role && roleName) {
    role = guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
  }
  if (!role && roleName) {
    try {
      role = await guild.roles.create({
        name: roleName,
        color: color || '#99aab5',
        reason: 'Автоматическое создание роли модерации'
      });
    } catch (e) {
      console.error(`Не удалось создать роль ${roleName}:`, e.message);
    }
  }
  return role;
}

// Handle Button Interactions
async function handleButton(interaction) {
  const customId = interaction.customId;
  const parts = customId.split(':');
  const scope = parts[0]; // 'act' or 'stf'

  if (scope !== 'act' && scope !== 'stf') return;

  const guild = interaction.guild;
  const executor = interaction.member;

  // 1. Verify permissions
  if (scope === 'act') {
    if (!isStaff(executor)) {
      return interaction.reply({
        content: '❌ У вас нет прав для выполнения действий модерации!',
        ephemeral: true
      });
    }
  } else if (scope === 'stf') {
    if (!canManageStaff(executor)) {
      return interaction.reply({
        content: '❌ Управление персоналом доступно только для роли **Master** и выше!',
        ephemeral: true
      });
    }
  }

  const action = parts[1];
  const subAction = parts[2];
  const targetId = parts[3] || parts[2]; // handle format like stf:kick:123 vs act:pred:add:123

  let targetMember = null;
  try {
    targetMember = await guild.members.fetch(targetId);
  } catch (err) {}

  // Cancel action
  if (action === 'cancel') {
    return interaction.update({
      content: `❌ Взаимодействие отменено модератором <@${interaction.user.id}>.`,
      embeds: [],
      components: []
    });
  }

  // Hierarchy checks for moderation actions
  const me = guild.members.me;
  if (targetMember) {
    if (targetMember.id === interaction.user.id) {
      return interaction.reply({
        content: '❌ Ви не можете застосувати цю дію до себе!',
        ephemeral: true
      });
    }

    if (scope === 'stf') {
      const executorTier = getStaffTier(executor);
      const targetTier = getStaffTier(targetMember);
      if (executor.id !== guild.ownerId && executorTier <= targetTier) {
        return interaction.reply({
          content: `❌ Ви не можете керувати учасником <@${targetId}>, оскільки його посада (${getStaffLevelTitle(targetTier)}) дорівнює або вища за вашу (${getStaffLevelTitle(executorTier)})!`,
          ephemeral: true
        });
      }
    } else {
      if (executor.id !== guild.ownerId && targetMember.roles.highest.position >= executor.roles.highest.position) {
        return interaction.reply({
          content: `❌ Ви не можете застосувати дію до учасника <@${targetId}>, так як його роль дорівнює або вища за вашу!`,
          ephemeral: true
        });
      }
    }

    if (targetMember.roles.highest.position >= me.roles.highest.position && !['pred', 'warn', 'cancel', 'bl', 'roles'].includes(action)) {
      return interaction.reply({
        content: `❌ Роль учасника <@${targetId}> вища або дорівнює ролі бота! Підніміть роль бота вище в налаштуваннях сервера.`,
        ephemeral: true
      });
    }
  }

  // =====================
  // MODAL TRIGGERS
  // =====================

  // Предупреждение (Выдать пред)
  if (action === 'pred' && subAction === 'add') {
    const modal = new ModalBuilder()
      .setCustomId(`modal:${scope}:pred:add:${targetId}`)
      .setTitle('Выдача предупреждения');

    const input = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Причина предупреждения')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Укажите причину...')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // Варн (Выдать варн)
  if (action === 'warn' && subAction === 'add') {
    const modal = new ModalBuilder()
      .setCustomId(`modal:${scope}:warn:add:${targetId}`)
      .setTitle('Выдача варна');

    const input = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Причина варна')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Укажите причину...')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // Мут (Выдать мут)
  if (action === 'mute' && subAction === 'add') {
    const modal = new ModalBuilder()
      .setCustomId(`modal:${scope}:mute:add:${targetId}`)
      .setTitle('Выдача мута');

    const durationInput = new TextInputBuilder()
      .setCustomId('duration')
      .setLabel('Длительность (например: 10m, 1h, 1d)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('30m')
      .setRequired(true);

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Причина мута')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Нарушение правил сервера')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(durationInput),
      new ActionRowBuilder().addComponents(reasonInput)
    );
    return interaction.showModal(modal);
  }

  // Бан (Выдать бан)
  if (action === 'ban' && subAction === 'add') {
    const modal = new ModalBuilder()
      .setCustomId(`modal:${scope}:ban:add:${targetId}`)
      .setTitle('Выдача бана');

    const input = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Причина бана')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Укажите причину бана...')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // Кик (Кикнуть)
  if (action === 'kick') {
    const modal = new ModalBuilder()
      .setCustomId(`modal:stf:kick:${targetId}`)
      .setTitle('Кик участника');

    const input = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Причина кика')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Укажите причину кика...')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // Черный Список (В Черный Список)
  if (action === 'bl' && subAction === 'add') {
    const modal = new ModalBuilder()
      .setCustomId(`modal:stf:bl:add:${targetId}`)
      .setTitle('Занесення в Чорний Список (ЧС)');

    const input = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Причина занесення в ЧС')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Вкажіть причину занесення в ЧС...')
      .setRequired(true);

    const durationInput = new TextInputBuilder()
      .setCustomId('duration')
      .setLabel('Термін ЧС (напр: 7d, 30d, назавжди)')
      .setStyle(TextInputStyle.Short)
      .setValue('Назавжди')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(input),
      new ActionRowBuilder().addComponents(durationInput)
    );
    return interaction.showModal(modal);
  }

  // =====================
  // DIRECT BUTTON ACTIONS
  // =====================

  // Снять пред
  if (action === 'pred' && subAction === 'rem') {
    const removed = db.removeInfraction(guild.id, targetId, 'pred');
    const remaining = db.getInfractionsCount(guild.id, targetId, 'pred');
    if (!removed) {
      return interaction.reply({
        content: `⚠️ У пользователя <@${targetId}> нет активных предупреждений.`,
        ephemeral: true
      });
    }
    db.addStaffAction(guild.id, interaction.user.id, 'moderator');
    return interaction.reply({
      content: `✅ Предупреждение снято с пользователя <@${targetId}> модератором <@${interaction.user.id}>. (Осталось предов: ${remaining})`
    });
  }

  // Снять варн
  if (action === 'warn' && subAction === 'rem') {
    const removed = db.removeInfraction(guild.id, targetId, 'warn');
    const remaining = db.getInfractionsCount(guild.id, targetId, 'warn');
    if (!removed) {
      return interaction.reply({
        content: `⚠️ У пользователя <@${targetId}> нет активных варнов.`,
        ephemeral: true
      });
    }
    db.addStaffAction(guild.id, interaction.user.id, 'moderator');
    return interaction.reply({
      content: `✅ Варн снят с пользователя <@${targetId}> модератором <@${interaction.user.id}>. (Осталось варнов: ${remaining})`
    });
  }

  // Снять мут
  if (action === 'mute' && subAction === 'rem') {
    if (!targetMember) {
      return interaction.reply({ content: '❌ Участник не найден на сервере!', ephemeral: true });
    }
    try {
      await targetMember.timeout(null, `Снятие мута модератором ${interaction.user.tag}`);

      const muteRoles = [config.roles.mutedChat, config.roles.mutedVoice];
      for (const rId of muteRoles) {
        if (rId && targetMember.roles.cache.has(rId)) {
          await targetMember.roles.remove(rId).catch(() => {});
        }
      }

      db.addStaffAction(guild.id, interaction.user.id, 'moderator');
      return interaction.reply({
        content: `🔊 Мут успешно снят с пользователя <@${targetId}> модератором <@${interaction.user.id}>.`
      });
    } catch (err) {
      return interaction.reply({
        content: `❌ Ошибка при снятии мута: ${err.message}`,
        ephemeral: true
      });
    }
  }

  // Снять бан
  if (action === 'ban' && subAction === 'rem') {
    try {
      await guild.bans.remove(targetId, `Снятие бана модератором ${interaction.user.tag}`);
      db.addStaffAction(guild.id, interaction.user.id, 'moderator');
      return interaction.reply({
        content: `🕊️ Бан успешно снят с пользователя <@${targetId}> модератором <@${interaction.user.id}>.`
      });
    } catch (err) {
      return interaction.reply({
        content: `❌ Не удалось снять бан: ${err.message}`,
        ephemeral: true
      });
    }
  }

  // Снять из Черного Списка (ЧС)
  if (action === 'bl' && subAction === 'rem') {
    const blRecord = db.removeBlacklist(guild.id, targetId);

    if (!blRecord) {
      return interaction.reply({
        content: `⚠️ Пользователь <@${targetId}> не числится в Черном Списке.`,
        ephemeral: true
      });
    }

    const blRole = guild.roles.cache.get(config.roles.blacklist) || guild.roles.cache.find(r => r.name.toLowerCase().includes('черный список') || r.name.toLowerCase() === 'чс');
    if (blRole && targetMember && targetMember.roles.cache.has(blRole.id)) {
      await targetMember.roles.remove(blRole).catch(() => {});
    }

    if (targetMember) {
      await targetMember.timeout(null, 'Зняття таймауту при винесенні з ЧС').catch(() => {});
    }

    if (blRecord.previousRoles && blRecord.previousRoles.length > 0 && targetMember) {
      for (const rId of blRecord.previousRoles) {
        if (blRole && rId === blRole.id) continue;
        if (guild.roles.cache.has(rId)) {
          await targetMember.roles.add(rId).catch(() => {});
        }
      }
    }

    if (targetMember) {
      targetMember.send(`🎉 Вас було видалено з **Чорного Списку** сервера **${guild.name}**! Доступ до каналів відновлено.`).catch(() => {});
    }

    // Log to log channel
    const logChannel = await guild.channels.fetch(config.channels.log).catch(() => null);
    if (logChannel) {
      const nowText = formatUkrainianDateTime(Date.now());
      const logEmbed = new EmbedBuilder()
        .setTitle('🕊️ [ЧОРНИЙ СПИСОК] Дострокове зняття ЧС')
        .setColor('#57F287')
        .addFields(
          {
            name: '👑 Модератор:',
            value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`,
            inline: true
          },
          {
            name: '👤 Користувач:',
            value: `<@${targetId}> (\`${targetMember ? targetMember.user.tag : targetId}\`)`,
            inline: true
          },
          {
            name: '⏳ Початковий термін:',
            value: `\`${blRecord.durationStr || 'Не вказано'}\``,
            inline: true
          },
          {
            name: '📜 Причина внесення:',
            value: `\`${blRecord.reason || 'Не вказано'}\``,
            inline: false
          },
          {
            name: '⏰ Дата та час зняття:',
            value: `\`${nowText}\``,
            inline: false
          }
        )
        .setFooter({ text: 'Система Чорного Списку • LUVEX Staff' })
        .setTimestamp();

      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }

    return interaction.reply({
      content: `✅ Пользователь <@${targetId}> успешно удален из **Черного Списка** модератором <@${interaction.user.id}>. Роли и доступ восстановлены.`
    });
  }

  // Снять все роли стаффа (Strip staff roles)
  if (action === 'roles' && subAction === 'strip') {
    if (!targetMember) {
      return interaction.reply({ content: '❌ Учасника не знайдено на сервері!', ephemeral: true });
    }

    const executorTier = getStaffTier(executor);
    if (executorTier < 2 && !canManageStaff(executor)) {
      return interaction.reply({
        content: '❌ Управління персоналом доступно лише для ролі **Master** та вище!',
        ephemeral: true
      });
    }

    if (targetMember.id === guild.ownerId) {
      return interaction.reply({ content: '❌ Ви не можете керувати Власником сервера!', ephemeral: true });
    }

    const targetTier = getStaffTier(targetMember);
    if (executorTier <= targetTier && executor.id !== guild.ownerId) {
      return interaction.reply({
        content: `❌ Ви не можете зняти ролі з учасника <@${targetMember.id}>, оскільки його посада дорівнює або вища за вашу!`,
        ephemeral: true
      });
    }

    const botHighest = me.roles.highest.position;
    const staffIds = config.roles.staffRoles || [];
    const staffKeywords = [
      'master', 'suport', 'support', 'closemode', 'creative', 'content maker',
      'evente', 'tribune mod', 'steamer', 'curator', 'lame', 'moder', 'staffmoder',
      'backsist', 'admin', 'administrator', 'team leed'
    ];

    const rolesToRemove = targetMember.roles.cache.filter(r => {
      const isStaff = staffIds.includes(r.id) || staffKeywords.some(k => r.name.toLowerCase().includes(k));
      const canBotRemove = r.position < botHighest && !r.managed && r.id !== guild.id;
      return isStaff && canBotRemove;
    });

    if (rolesToRemove.size === 0) {
      return interaction.reply({
        content: `⚠️ У користувача <@${targetId}> немає активних посад персоналу для зняття.`,
        ephemeral: true
      });
    }

    try {
      // Gather grant information for all stripped roles
      const removedInfoLines = [];
      for (const [, r] of rolesToRemove) {
        const grantInfo = await getRoleGrantInfo(guild, targetId, r.id);
        const issuerText = grantInfo.executorId
          ? `<@${grantInfo.executorId}> (\`${grantInfo.executorTag}\`)`
          : `\`${grantInfo.executorTag || 'Невідомо'}\``;
        const dateText = formatUkrainianDateTime(grantInfo.timestamp || grantInfo.createdAt);
        removedInfoLines.push(`• <@&${r.id}> (\`${r.name}\`)\n  └ 👤 **Видав:** ${issuerText} | 📅 **Коли:** \`${dateText}\``);
      }

      await targetMember.roles.remove(rolesToRemove, `Снятие всех стафф-ролей модератором ${interaction.user.tag}`);
      const removedNames = rolesToRemove.map(r => r.name).join(', ');

      // Send Log to #log1
      const logChannel = await guild.channels.fetch(config.channels.log).catch(() => null);
      if (logChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle('📋 [ЛОГ] Повне зняття посад персоналу')
          .setColor('#ED4245')
          .addFields(
            {
              name: '👑 Хто зняв ролі (Модератор):',
              value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)\n\`ID: ${interaction.user.id}\``,
              inline: true
            },
            {
              name: '👤 З кого знято посади:',
              value: `<@${targetId}> (\`${targetMember.user.tag}\`)\n\`ID: ${targetId}\``,
              inline: true
            },
            {
              name: '🏷️ Зняті ролі та історія видачі:',
              value: removedInfoLines.join('\n').slice(0, 1024),
              inline: false
            },
            {
              name: '⏰ Дата та час зняття:',
              value: `\`${formatUkrainianDateTime(Date.now())}\``,
              inline: false
            }
          )
          .setFooter({ text: 'Система управління персоналом • Staff Manage' })
          .setTimestamp();

        await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
      }

      return interaction.reply({
        content: `🛡️ З користувача <@${targetId}> успішно знято всі посади персоналу: **${removedNames}**.\n📋 Подію зафіксовано в журналі логів <#${config.channels.log}>.`
      });
    } catch (err) {
      return interaction.reply({
        content: `❌ Помилка при знятті ролей стаффа: ${err.message}`,
        ephemeral: true
      });
    }
  }

  // =====================
  // /action UNIQUE BUTTONS
  // =====================

  // Сменить гендер
  if (action === 'gender' && subAction === 'toggle') {
    if (!targetMember) {
      return interaction.reply({ content: '❌ Участник не найден на сервере!', ephemeral: true });
    }
    try {
      const boyRole = await getOrCreateRole(guild, config.roles.genderBoy, '🩵');
      const girlRole = await getOrCreateRole(guild, config.roles.genderGirl, '🩷');

      const hasBoy = boyRole && targetMember.roles.cache.has(boyRole.id);
      const hasGirl = girlRole && targetMember.roles.cache.has(girlRole.id);

      if (hasBoy) {
        if (boyRole) await targetMember.roles.remove(boyRole);
        if (girlRole) await targetMember.roles.add(girlRole);
        return interaction.reply({
          content: `⚧ Гендер участника <@${targetId}> изменен на **🩷 (Девушка)**.`
        });
      } else if (hasGirl) {
        if (girlRole) await targetMember.roles.remove(girlRole);
        if (boyRole) await targetMember.roles.add(boyRole);
        return interaction.reply({
          content: `⚧ Гендер участника <@${targetId}> изменен на **🩵 (Парень)**.`
        });
      } else {
        if (boyRole) await targetMember.roles.add(boyRole);
        return interaction.reply({
          content: `⚧ Участнику <@${targetId}> установлен гендер **🩵 (Парень)**.`
        });
      }
    } catch (err) {
      return interaction.reply({
        content: `❌ Ошибка при смене гендера: ${err.message}`,
        ephemeral: true
      });
    }
  }

  // Верифицировать
  if (action === 'verify') {
    if (!targetMember) {
      return interaction.reply({ content: '❌ Участник не найден на сервере!', ephemeral: true });
    }
    try {
      const unverifiedRole = await getOrCreateRole(guild, config.roles.unverified, 'unvefiry');
      if (unverifiedRole && targetMember.roles.cache.has(unverifiedRole.id)) {
        await targetMember.roles.remove(unverifiedRole, `Верификация модератором ${interaction.user.tag}`);
        db.addStaffAction(guild.id, interaction.user.id, 'support');
        return interaction.reply({
          content: `✅ Пользователь <@${targetId}> успешно верифицирован (роль <@&${unverifiedRole.id}> снята).`
        });
      } else {
        db.addStaffAction(guild.id, interaction.user.id, 'support');
        return interaction.reply({
          content: `✅ Пользователь <@${targetId}> уже верифицирован.`
        });
      }
    } catch (err) {
      return interaction.reply({
        content: `❌ Ошибка при верификации: ${err.message}`,
        ephemeral: true
      });
    }
  }

  // Выдать недопуск
  if (action === 'denied' && subAction === 'add') {
    if (!targetMember) {
      return interaction.reply({ content: '❌ Участник не найден на сервере!', ephemeral: true });
    }
    try {
      const deniedRole = await getOrCreateRole(guild, null, 'Недопуск', '#E74C3C');
      if (deniedRole) {
        await targetMember.roles.add(deniedRole, `Выдача недопуска модератором ${interaction.user.tag}`);
        db.addStaffAction(guild.id, interaction.user.id, 'moderator');
        return interaction.reply({
          content: `⛔ Пользователю <@${targetId}> выдан недопуск (роль <@&${deniedRole.id}> добавлена).`
        });
      } else {
        return interaction.reply({ content: '❌ Не удалось получить роль недопуска.', ephemeral: true });
      }
    } catch (err) {
      return interaction.reply({ content: `❌ Ошибка: ${err.message}`, ephemeral: true });
    }
  }

  // Снять недопуск
  if (action === 'denied' && subAction === 'rem') {
    if (!targetMember) {
      return interaction.reply({ content: '❌ Участник не найден на сервере!', ephemeral: true });
    }
    try {
      const deniedRole = await getOrCreateRole(guild, null, 'Недопуск');
      if (deniedRole && targetMember.roles.cache.has(deniedRole.id)) {
        await targetMember.roles.remove(deniedRole, `Снятие недопуска модератором ${interaction.user.tag}`);
        db.addStaffAction(guild.id, interaction.user.id, 'moderator');
        return interaction.reply({
          content: `✅ С пользователя <@${targetId}> снят недопуск.`
        });
      } else {
        return interaction.reply({
          content: `⚠️ У пользователя <@${targetId}> нет роли недопуска.`,
          ephemeral: true
        });
      }
    } catch (err) {
      return interaction.reply({ content: `❌ Ошибка: ${err.message}`, ephemeral: true });
    }
  }

  // Выдать отстранение
  if (action === 'suspend' && subAction === 'add') {
    if (!targetMember) {
      return interaction.reply({ content: '❌ Участник не найден на сервере!', ephemeral: true });
    }
    try {
      const suspendRole = await getOrCreateRole(guild, null, 'Отстранение', '#95A5A6');
      if (suspendRole) {
        await targetMember.roles.add(suspendRole, `Выдача отстранения модератором ${interaction.user.tag}`);
        db.addStaffAction(guild.id, interaction.user.id, 'moderator');
        return interaction.reply({
          content: `⚠️ Пользователю <@${targetId}> выдано отстранение (роль <@&${suspendRole.id}> добавлена).`
        });
      } else {
        return interaction.reply({ content: '❌ Не удалось получить роль отстранения.', ephemeral: true });
      }
    } catch (err) {
      return interaction.reply({ content: `❌ Ошибка: ${err.message}`, ephemeral: true });
    }
  }

  // Снять отстранение
  if (action === 'suspend' && subAction === 'rem') {
    if (!targetMember) {
      return interaction.reply({ content: '❌ Участник не найден на сервере!', ephemeral: true });
    }
    try {
      const suspendRole = await getOrCreateRole(guild, null, 'Отстранение');
      if (suspendRole && targetMember.roles.cache.has(suspendRole.id)) {
        await targetMember.roles.remove(suspendRole, `Снятие отстранения модератором ${interaction.user.tag}`);
        db.addStaffAction(guild.id, interaction.user.id, 'moderator');
        return interaction.reply({
          content: `✅ С пользователя <@${targetId}> снято отстранение.`
        });
      } else {
        return interaction.reply({
          content: `⚠️ У пользователя <@${targetId}> нет роли отстранения.`,
          ephemeral: true
        });
      }
    } catch (err) {
      return interaction.reply({ content: `❌ Ошибка: ${err.message}`, ephemeral: true });
    }
  }

  // Выдать креативную роль
  if (action === 'creative' && subAction === 'toggle') {
    if (!targetMember) {
      return interaction.reply({ content: '❌ Участник не найден на сервере!', ephemeral: true });
    }
    try {
      const creativeRole = await getOrCreateRole(guild, config.roles.creative, 'Creative', '#9B59B6');
      if (!creativeRole) {
        return interaction.reply({ content: '❌ Роль Creative не найдена.', ephemeral: true });
      }

      if (targetMember.roles.cache.has(creativeRole.id)) {
        await targetMember.roles.remove(creativeRole);
        return interaction.reply({
          content: `🎨 С пользователя <@${targetId}> снята креативная роль <@&${creativeRole.id}>.`
        });
      } else {
        await targetMember.roles.add(creativeRole);
        db.addStaffAction(guild.id, interaction.user.id, 'creative');
        return interaction.reply({
          content: `🎨 Пользователю <@${targetId}> выдана креативная роль <@&${creativeRole.id}>.`
        });
      }
    } catch (err) {
      return interaction.reply({ content: `❌ Ошибка: ${err.message}`, ephemeral: true });
    }
  }
}

// Handle Select Menu Interactions (Adding or removing roles)
async function handleStringSelect(interaction) {
  const customId = interaction.customId;

  // 1. ADD ROLE (Видача ролі персоналу)
  if (customId.startsWith('stf:roles:add:')) {
    const targetId = customId.split(':')[3];
    const roleId = interaction.values[0];
    const guild = interaction.guild;
    const executor = interaction.member;

    const executorTier = getMemberStaffLevel(executor);
    if (executorTier < 2 && !canManageStaff(executor)) {
      return interaction.reply({
        content: '❌ Управління персоналом доступно лише для ролі **Master** та вище!',
        ephemeral: true
      });
    }

    let targetMember = null;
    try {
      targetMember = await guild.members.fetch(targetId);
    } catch (e) {
      return interaction.reply({ content: '❌ Учасника не знайдено на сервері!', ephemeral: true });
    }

    if (targetMember.id === guild.ownerId) {
      return interaction.reply({ content: '❌ Ви не можете керувати Власником сервера!', ephemeral: true });
    }

    const targetTier = getMemberStaffLevel(targetMember);
    if (executorTier <= targetTier && executor.id !== guild.ownerId) {
      return interaction.reply({
        content: `❌ Ви не можете керувати учасником <@${targetMember.id}>, оскільки його посада (${getStaffLevelTitle(targetTier)}) дорівнює або вища за вашу (${getStaffLevelTitle(executorTier)})!`,
        ephemeral: true
      });
    }

    const role = guild.roles.cache.get(roleId);
    if (!role) {
      return interaction.reply({ content: '❌ Роль не знайдено на сервері!', ephemeral: true });
    }

    const roleLevel = getRoleStaffLevel(role);
    if (roleLevel === 0) {
      return interaction.reply({ content: '❌ Ця роль не є посадою персоналу!', ephemeral: true });
    }

    if (executor.id !== guild.ownerId && executorTier <= roleLevel) {
      return interaction.reply({
        content: `❌ Ви не можете видати роль **${role.name}**, оскільки її рівень (${getStaffLevelTitle(roleLevel)}) дорівнює або вищий за ваш рівень (${getStaffLevelTitle(executorTier)})!`,
        ephemeral: true
      });
    }

    if (targetMember.roles.cache.has(role.id)) {
      return interaction.reply({
        content: `⚠️ Учасник <@${targetId}> вже має роль **${role.name}**!`,
        ephemeral: true
      });
    }

    if (role.position >= guild.members.me.roles.highest.position) {
      return interaction.reply({
        content: `❌ Роль **${role.name}** вища або дорівнює найвищій ролі бота! Підніміть роль бота в налаштуваннях сервера.`,
        ephemeral: true
      });
    }

    try {
      // 1. Add role to member
      await targetMember.roles.add(role, `Видача посади персоналу модератором ${interaction.user.tag}`);

      // 2. Save in database
      const grantInfo = {
        executorId: interaction.user.id,
        executorTag: interaction.user.tag || interaction.user.username,
        timestamp: Date.now(),
        createdAt: new Date().toISOString()
      };
      db.saveRoleGrant(guild.id, targetId, role.id, grantInfo);

      const nowText = formatUkrainianDateTime(Date.now());

      // 3. Notify member in DM if possible
      targetMember.send(`🎉 Вам було надано посаду/роль **${role.name}** на сервері **${guild.name}** модератором <@${interaction.user.id}>!`).catch(() => {});

      // 4. Send detailed Log to #log1
      const logChannel = await guild.channels.fetch(config.channels.log).catch(() => null);
      if (logChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle('📋 [ЛОГ] Видача ролі персоналу / посади')
          .setColor('#57F287')
          .addFields(
            {
              name: '👑 Хто видав роль (Модератор):',
              value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)\n\`ID: ${interaction.user.id}\` (${getStaffLevelTitle(executorTier)})`,
              inline: true
            },
            {
              name: '👤 Кому видано роль:',
              value: `<@${targetId}> (\`${targetMember.user.tag}\`)\n\`ID: ${targetId}\``,
              inline: true
            },
            {
              name: '🏷️ Надана роль / посада:',
              value: `<@&${role.id}> (\`${role.name}\`)\n\`ID: ${role.id}\` (Рівень: ${getStaffLevelTitle(roleLevel)})`,
              inline: false
            },
            {
              name: '⏰ Дата та час видачі ролі:',
              value: `\`${nowText}\``,
              inline: false
            }
          )
          .setFooter({ text: 'Система управління персоналом • Staff Manage' })
          .setTimestamp();

        await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
      }

      return interaction.reply({
        content: `✅ Роль **${role.name}** (<@&${role.id}>) успішно видана учаснику <@${targetId}> модератором <@${interaction.user.id}>!\n` +
                 `🏷️ **Рівень посади:** ${getStaffLevelTitle(roleLevel)}\n` +
                 `⏰ **Час видачі:** \`${nowText}\`\n` +
                 `📋 Запис зафіксовано в журналі логів <#${config.channels.log}>.`
      });
    } catch (err) {
      return interaction.reply({
        content: `❌ Помилка при видачі ролі: ${err.message}`,
        ephemeral: true
      });
    }
  }

  // 2. REMOVE ROLE (Зняття посади або ролі)
  if (customId.startsWith('stf:roles:remove:')) {
    const targetId = customId.split(':')[3];
    const roleId = interaction.values[0];
    const guild = interaction.guild;
    const executor = interaction.member;

    const executorTier = getStaffTier(executor);
    if (executorTier < 2 && !canManageStaff(executor)) {
      return interaction.reply({
        content: '❌ Управління персоналом доступно лише для ролі **Master** та вище!',
        ephemeral: true
      });
    }

    let targetMember = null;
    try {
      targetMember = await guild.members.fetch(targetId);
    } catch (e) {
      return interaction.reply({ content: '❌ Учасника не знайдено на сервері!', ephemeral: true });
    }

    if (targetMember.id === guild.ownerId) {
      return interaction.reply({ content: '❌ Ви не можете керувати Власником сервера!', ephemeral: true });
    }

    const targetTier = getStaffTier(targetMember);
    if (executorTier <= targetTier && executor.id !== guild.ownerId) {
      return interaction.reply({
        content: `❌ Ви не можете зняти роль з учасника <@${targetMember.id}>, оскільки його посада дорівнює або вища за вашу!`,
        ephemeral: true
      });
    }

    const role = guild.roles.cache.get(roleId);
    if (!role) {
      return interaction.reply({ content: '❌ Роль не знайдено на сервері!', ephemeral: true });
    }

    try {
      // 1. Fetch who gave this role and when
      const grantInfo = await getRoleGrantInfo(guild, targetId, roleId);
      const issuerText = grantInfo.executorId
        ? `<@${grantInfo.executorId}> (\`${grantInfo.executorTag}\`)`
        : `\`${grantInfo.executorTag || 'Невідомо / Давній запис'}\``;
      const dateText = formatUkrainianDateTime(grantInfo.timestamp || grantInfo.createdAt);
      const nowText = formatUkrainianDateTime(Date.now());

      // 2. Remove role from member
      await targetMember.roles.remove(role, `Зняття посади модератором ${interaction.user.tag}`);

      // 3. Notify member in DM if possible
      targetMember.send(`⚠️ З вас було знято посаду/роль **${role.name}** на сервері **${guild.name}** модератором <@${interaction.user.id}>.`).catch(() => {});

      // 4. Send detailed Log to #log1
      const logChannel = await guild.channels.fetch(config.channels.log).catch(() => null);
      if (logChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle('📋 [ЛОГ] Зняття ролі персоналу / посади')
          .setColor('#ED4245')
          .addFields(
            {
              name: '👑 Хто зняв роль (Модератор):',
              value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)\n\`ID: ${interaction.user.id}\``,
              inline: true
            },
            {
              name: '👤 З кого знято роль:',
              value: `<@${targetId}> (\`${targetMember.user.tag}\`)\n\`ID: ${targetId}\``,
              inline: true
            },
            {
              name: '🏷️ Знята роль / посада:',
              value: `<@&${role.id}> (\`${role.name}\`)\n\`ID: ${role.id}\``,
              inline: false
            },
            {
              name: '👮 Хто видав цю роль раніше:',
              value: issuerText,
              inline: true
            },
            {
              name: '📅 Дата та час видачі ролі:',
              value: `\`${dateText}\``,
              inline: true
            },
            {
              name: '⏰ Дата та час зняття ролі:',
              value: `\`${nowText}\``,
              inline: false
            }
          )
          .setFooter({ text: 'Система управління персоналом • Staff Manage' })
          .setTimestamp();

        await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
      }

      return interaction.reply({
        content: `✅ Роль **${role.name}** (<@&${role.id}>) успішно знята з <@${targetId}> модератором <@${interaction.user.id}>!\n` +
                 `👤 **Хто видавав роль:** ${issuerText}\n` +
                 `📅 **Коли було видано:** \`${dateText}\`\n` +
                 `📋 Запис зафіксовано в журналі логів <#${config.channels.log}>.`
      });
    } catch (err) {
      return interaction.reply({
        content: `❌ Помилка при знятті ролі: ${err.message}`,
        ephemeral: true
      });
    }
  }
}

// Handle Modal Submissions
async function handleModal(interaction) {
  const customId = interaction.customId;
  const parts = customId.split(':');
  if (parts[0] !== 'modal') return;

  const scope = parts[1]; // 'act' or 'stf'
  const action = parts[2];
  const subAction = parts[3];
  const targetId = parts[4] || parts[3];
  const guild = interaction.guild;

  let targetMember = null;
  try {
    targetMember = await guild.members.fetch(targetId);
  } catch (err) {}

  // 1. ВЫДАЧА ПРЕДА
  if (action === 'pred' && subAction === 'add') {
    const reason = interaction.fields.getTextInputValue('reason');
    db.addInfraction(guild.id, targetId, interaction.user.id, reason, 'pred', interaction.user.tag);
    const count = db.getInfractionsCount(guild.id, targetId, 'pred');
    db.addStaffAction(guild.id, interaction.user.id, 'moderator');

    if (targetMember) {
      targetMember.send(`⚠️ Вам видано попередження на сервері **${guild.name}**.\n**Причина:** ${reason}`).catch(() => {});
    }

    return interaction.reply({
      content: `⚠️ Користувачу <@${targetId}> видано попередження модератором <@${interaction.user.id}>.\n**Причина:** ${reason}\n**Всього предів:** ${count}`
    });
  }

  // 2. ВЫДАЧА ВАРНА
  if (action === 'warn' && subAction === 'add') {
    const reason = interaction.fields.getTextInputValue('reason');
    db.addInfraction(guild.id, targetId, interaction.user.id, reason, 'warn', interaction.user.tag);
    const count = db.getInfractionsCount(guild.id, targetId, 'warn');
    db.addStaffAction(guild.id, interaction.user.id, 'moderator');

    if (targetMember) {
      targetMember.send(`🚨 Вам видано варн (догану) на сервері **${guild.name}**.\n**Причина:** ${reason}`).catch(() => {});
    }

    return interaction.reply({
      content: `🚨 Користувачу <@${targetId}> видано варн модератором <@${interaction.user.id}>.\n**Причина:** ${reason}\n**Всього варнів:** ${count}`
    });
  }

  // 3. ВЫДАЧА МУТА
  if (action === 'mute' && subAction === 'add') {
    if (!targetMember) {
      return interaction.reply({ content: '❌ Участник не найден на сервере!', ephemeral: true });
    }
    const durationStr = interaction.fields.getTextInputValue('duration');
    const reason = interaction.fields.getTextInputValue('reason') || 'Нарушение правил';

    const ms = parseDuration(durationStr);
    if (!ms || ms < 10000 || ms > 28 * 24 * 60 * 60 * 1000) {
      return interaction.reply({
        content: '❌ Неверный формат длительности! Используйте, например: `10m` (10 минут), `2h` (2 часа), `1d` (1 день). Максимум 28 дней.',
        ephemeral: true
      });
    }

    try {
      await targetMember.timeout(ms, `${reason} | Модератор: ${interaction.user.tag}`);

      if (config.roles.mutedChat && guild.roles.cache.has(config.roles.mutedChat)) {
        await targetMember.roles.add(config.roles.mutedChat).catch(() => {});
      }
      if (config.roles.mutedVoice && guild.roles.cache.has(config.roles.mutedVoice)) {
        await targetMember.roles.add(config.roles.mutedVoice).catch(() => {});
      }

      db.addStaffAction(guild.id, interaction.user.id, 'moderator');

      targetMember.send(`🔇 Вам выдан мут на сервере **${guild.name}** на **${durationStr}**.\n**Причина:** ${reason}`).catch(() => {});

      return interaction.reply({
        content: `🔇 Пользователю <@${targetId}> выдан мут на **${durationStr}** модератором <@${interaction.user.id}>.\n**Причина:** ${reason}`
      });
    } catch (err) {
      return interaction.reply({
        content: `❌ Ошибка при выдаче мута: ${err.message}`,
        ephemeral: true
      });
    }
  }

  // 4. ВЫДАЧА БАНА
  if (action === 'ban' && subAction === 'add') {
    const reason = interaction.fields.getTextInputValue('reason');
    try {
      if (targetMember) {
        await targetMember.send(`🔨 Вы были забанены на сервере **${guild.name}**.\n**Причина:** ${reason}`).catch(() => {});
      }

      await guild.members.ban(targetId, {
        reason: `${reason} | Модератор: ${interaction.user.tag}`
      });

      db.addStaffAction(guild.id, interaction.user.id, 'moderator');

      return interaction.reply({
        content: `🔨 Пользователь <@${targetId}> успешно забанен модератором <@${interaction.user.id}>.\n**Причина:** ${reason}`
      });
    } catch (err) {
      return interaction.reply({
        content: `❌ Ошибка при выдаче бана: ${err.message}`,
        ephemeral: true
      });
    }
  }

  // 5. КИК
  if (action === 'kick') {
    const reason = interaction.fields.getTextInputValue('reason');
    if (!targetMember) {
      return interaction.reply({ content: '❌ Участник не найден на сервере!', ephemeral: true });
    }

    try {
      await targetMember.send(`👢 Вы были кикнуты с сервера **${guild.name}**.\n**Причина:** ${reason}`).catch(() => {});
      await targetMember.kick(`${reason} | Модератор: ${interaction.user.tag}`);

      db.addStaffAction(guild.id, interaction.user.id, 'moderator');
      db.addPunishmentRecord(guild.id, targetId, {
        type: 'kick',
        reason,
        moderatorId: interaction.user.id,
        moderatorTag: interaction.user.tag
      });

      return interaction.reply({
        content: `👢 Пользователь <@${targetId}> успешно кикнут модератором <@${interaction.user.id}>.\n**Причина:** ${reason}`
      });
    } catch (err) {
      return interaction.reply({
        content: `❌ Ошибка при кике: ${err.message}`,
        ephemeral: true
      });
    }
  }

  // 6. ЧЕРНЫЙ СПИСОК (ЧС)
  if (action === 'bl' && subAction === 'add') {
    const reason = interaction.fields.getTextInputValue('reason');
    let rawDuration = 'Назавжди';
    try {
      rawDuration = interaction.fields.getTextInputValue('duration') || 'Назавжди';
    } catch {}

    const parsed = parseBlacklistDuration(rawDuration) || { ms: null, label: 'Назавжди' };
    const expiresAt = parsed.ms ? new Date(Date.now() + parsed.ms).toISOString() : null;
    const durationStr = parsed.label;

    // Save previous roles of member
    const rolesToSave = targetMember
      ? targetMember.roles.cache.filter(r => r.id !== guild.id && !r.managed).map(r => r.id)
      : [];

    db.addBlacklist(guild.id, targetId, interaction.user.id, reason, rolesToSave, durationStr, expiresAt, interaction.user.tag);
    db.addStaffAction(guild.id, interaction.user.id, 'moderator');

    // Strip previous roles so member loses access to all normal channels
    if (targetMember && rolesToSave.length > 0) {
      await targetMember.roles.remove(rolesToSave, 'Внесение в ЧС (снятие ролей)').catch(() => {});
    }

    // Assign Blacklist role
    const blRole = guild.roles.cache.get(config.roles.blacklist) || await getOrCreateRole(guild, null, 'Черный Список', '#111111');
    if (blRole && targetMember) {
      await targetMember.roles.add(blRole, `Занесение в ЧС модератором ${interaction.user.tag}`).catch(() => {});
    }

    // Remove any active timeout and mute roles so member can communicate in appeal
    if (targetMember) {
      await targetMember.timeout(null, 'Зняття таймауту при внесенні в ЧС для можливості апеляції').catch(() => {});
      const muteRoles = [config.roles.mutedChat, config.roles.mutedVoice];
      for (const rId of muteRoles) {
        if (rId && targetMember.roles.cache.has(rId)) {
          await targetMember.roles.remove(rId).catch(() => {});
        }
      }
    }

    if (targetMember) {
      targetMember.send(
        `⛔ Вас було внесено до **Чорного Списку** сервера **${guild.name}**.\n` +
        `**Причина:** ${reason}\n` +
        `**Термін:** ${durationStr}\n\n` +
        `Вам заблоковано доступ до всіх каналів та чатів. Для вас доступний лише канал апеляцій <#${config.channels.appeal}>, де ви можете подати заявку на зняття Чорного Списку.`
      ).catch(() => {});
    }

    // Log to log channel
    const logChannel = await guild.channels.fetch(config.channels.log).catch(() => null);
    if (logChannel) {
      const nowText = formatUkrainianDateTime(Date.now());
      const logEmbed = new EmbedBuilder()
        .setTitle('⛔ [ЧОРНИЙ СПИСОК] Додавання до ЧС')
        .setColor('#ED4245')
        .setThumbnail(targetMember ? targetMember.user.displayAvatarURL({ dynamic: true, size: 256 }) : undefined)
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
            name: '⏳ Термін:',
            value: `\`${durationStr}\``,
            inline: true
          },
          {
            name: '⌛ Закінчення:',
            value: `\`${expiresAt ? formatUkrainianDateTime(expiresAt) : 'Безстроково (назавжди)'}\``,
            inline: true
          },
          {
            name: '📜 Причина:',
            value: `\`${reason}\``,
            inline: false
          },
          {
            name: '⏰ Дата та час занесення:',
            value: `\`${nowText}\``,
            inline: false
          }
        )
        .setFooter({ text: 'Система Чорного Списку • LUVEX Staff' })
        .setTimestamp();

      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }

    return interaction.reply({
      content: `⛔ Пользователь <@${targetId}> успешно добавлен в **Черный Список (ЧС)** модератором <@${interaction.user.id}>.\n**Термін:** ${durationStr}\n**Причина:** ${reason}\nРоли сняты, доступ открыт только в канал апелляций <#${config.channels.appeal}>.`
    });
  }
}

module.exports = {
  isStaff,
  canManageStaff,
  handleButton,
  handleModal,
  handleStringSelect
};
