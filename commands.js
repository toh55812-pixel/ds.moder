const {
  SlashCommandBuilder,
  EmbedBuilder,
  UserSelectMenuBuilder,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { createActionPanel, createStaffManagePanel, formatDate } = require('./panel');
const { isStaff, canManageStaff } = require('./handlers');
const { setupBlacklistPermissions } = require('./appeal');
const { sendReportToKorzina } = require('./report');
const { setupVoicePermissions, deployVoiceSummonPanels } = require('./voiceModeration');
const { createBlacklistListEmbed, createBlacklistUserCard } = require('./blacklist');
const { getStaffTier, formatUkrainianDateTime } = require('./roleHistory');
const { canReviewKeyRequests, deployKeyShopPanel, revokeProkhodkaAccess } = require('./keyShop');
const config = require('./config');
const db = require('./database');

// Define Slash Commands

// /acation (command requested by user)
const acationCommand = new SlashCommandBuilder()
  .setName('acation')
  .setDescription('Взаимодействие с участником сервера (модерация)')
  .addUserOption(opt =>
    opt
      .setName('user')
      .setDescription('Выберите участника для взаимодействия')
      .setRequired(false)
  );

// /staff profile, /staff actions & /staff manage
const staffCommand = new SlashCommandBuilder()
  .setName('staff')
  .setDescription('Команды персонала сервера')
  .addSubcommand(sub =>
    sub
      .setName('profile')
      .setDescription('Просмотр профиля сотрудника')
      .addUserOption(opt =>
        opt
          .setName('user')
          .setDescription('Сотрудник для просмотра (по умолчанию вы)')
          .setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('actions')
      .setDescription('Показать статистику действий модератора')
      .addUserOption(opt =>
        opt
          .setName('moderator')
          .setDescription('Модератор для просмотра статистики (по умолчанию вы)')
          .setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('manage')
      .setDescription('Управление персоналом (для Master и выше)')
      .addUserOption(opt =>
        opt
          .setName('user')
          .setDescription('Сотрудник для управления')
          .setRequired(false)
      )
  );

// /appeal
const appealCommand = new SlashCommandBuilder()
  .setName('appeal')
  .setDescription('Настройка и обновление панели апелляций в канале #апиляцію');

// /report (доступно всем пользователям)
const reportCommand = new SlashCommandBuilder()
  .setName('report')
  .setDescription('Подать жалобу на нарушителя правил сервера')
  .addUserOption(opt =>
    opt
      .setName('user')
      .setDescription('Участник, на которого вы хотите пожаловаться')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt
      .setName('reason')
      .setDescription('Причина жалобы (что нарушил участник)')
      .setRequired(false)
  )
  .addStringOption(opt =>
    opt
      .setName('proof')
      .setDescription('Ссылка на скриншот или доказательства (необязательно)')
      .setRequired(false)
  );

// /voicesetup (настройка прав и кнопок вызова в войсах)
const voicesetupCommand = new SlashCommandBuilder()
  .setName('voicesetup')
  .setDescription('Настроить запрет чата в Модер-зоне и обновить кнопки вызова персонала');

// /call (быстрый вызов модератора в текущий войс)
const callCommand = new SlashCommandBuilder()
  .setName('call')
  .setDescription('Позвать администратора или модератора в ваш голосовой канал');

// /blacklist
const blacklistCommand = new SlashCommandBuilder()
  .setName('blacklist')
  .setDescription('Управління Чорним Списком: перегляд порушників, зміна/збільшення терміну та зняття ЧС')
  .addUserOption(opt =>
    opt
      .setName('user')
      .setDescription('Обрати конкретного порушника для перегляду та дій')
      .setRequired(false)
  );

// /key
const keyCommand = new SlashCommandBuilder()
  .setName('key')
  .setDescription('Управління ключем стаффа 🔑')
  .addSubcommand(sub =>
    sub
      .setName('panel')
      .setDescription('Надіслати або оновити панель магазину ключів у каналі')
  )
  .addSubcommand(sub =>
    sub
      .setName('warn')
      .setDescription('Видати виговор держателю ключа (максимум 2)')
      .addUserOption(opt =>
        opt.setName('user').setDescription('Користувач, якому видається виговор').setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('reason').setDescription('Причина виговору').setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('unwarn')
      .setDescription('Зняти виговор у держателя ключа')
      .addUserOption(opt =>
        opt.setName('user').setDescription('Користувач, у якого знімається виговор').setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('revoke')
      .setDescription('Анулювати ключ та зняти роль 🔑 у користувача')
      .addUserOption(opt =>
        opt.setName('user').setDescription('Користувач, у якого вилучається ключ').setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('reason').setDescription('Причина вилучення ключа').setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('list')
      .setDescription('Список усіх активних держателів ключа 🔑 та їх виговорів (0/2, 1/2)')
  );

// Handle Slash Command Executions
async function handleChatInputCommand(interaction) {
  const { commandName, guild, member } = interaction;

  // 1. Handle /action and /acation
  if (commandName === 'action' || commandName === 'acation') {
    if (!isStaff(member)) {
      return interaction.reply({
        content: '❌ У вас нет прав для использования этой команды!',
        ephemeral: true
      });
    }

    const targetUser = interaction.options.getUser('user');

    if (targetUser) {
      let targetMember = null;
      try {
        targetMember = await guild.members.fetch(targetUser.id);
      } catch (err) {
        return interaction.reply({
          content: '❌ Участник не найден на этом сервере!',
          ephemeral: true
        });
      }

      const panelData = createActionPanel(targetMember);
      return interaction.reply(panelData);
    } else {
      const selectMenu = new UserSelectMenuBuilder()
        .setCustomId('select_action_user')
        .setPlaceholder('Выберите участника для модерации...')
        .setMaxValues(1);

      const row = new ActionRowBuilder().addComponents(selectMenu);

      return interaction.reply({
        content: '🔍 Пожалуйста, выберите участника из списка ниже для открытия панели действий:',
        components: [row],
        ephemeral: true
      });
    }
  }

  // 2. Handle /staff
  if (commandName === 'staff') {
    const sub = interaction.options.getSubcommand();

    // /staff profile
    if (sub === 'profile') {
      const targetUser = interaction.options.getUser('user') || interaction.user;
      let targetMember = null;
      try {
        targetMember = await guild.members.fetch(targetUser.id);
      } catch (e) {
        return interaction.reply({ content: '❌ Участник не найден на этом сервере!', ephemeral: true });
      }

      const stats = db.getStaffStats(guild.id, targetUser.id);
      const preds = db.getInfractionsCount(guild.id, targetUser.id, 'pred');
      const warns = db.getInfractionsCount(guild.id, targetUser.id, 'warn');
      const isBL = db.isBlacklisted(guild.id, targetUser.id);

      const staffIds = config.roles.staffRoles || [];
      const staffNames = ['master', 'suport', 'support', 'closemode', 'creative', 'content maker', 'evente', 'tribune mod', 'steamer', 'curator', 'lame', 'moder', 'staffmoder', 'admin', 'administrator', 'team leed'];

      const userStaffRoles = targetMember.roles.cache.filter(r =>
        staffIds.includes(r.id) || staffNames.includes(r.name.toLowerCase())
      );

      const staffRolesText = userStaffRoles.size > 0
        ? userStaffRoles.map(r => `<@&${r.id}>`).join(', ')
        : '`Обычный участник`';

      const totalActions = (stats.moderator || 0) + (stats.support || 0) + (stats.closer || 0) + (stats.creative || 0);

      const embed = new EmbedBuilder()
        .setTitle(`📋 Профиль сотрудника — ${targetMember.displayName || targetUser.username}`)
        .setColor('#2B2D31')
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
        .setDescription(
          `**Сотрудник:** <@${targetUser.id}> (\`${targetUser.tag}\`)\n` +
          `**ID:** \`${targetUser.id}\`\n` +
          `**Дата входа:** ${formatDate(targetMember.joinedAt)}\n` +
          `**Должности:** ${staffRolesText}\n` +
          `**Статус ЧС:** ${isBL ? '⚠️ `В Черном Списке`' : '✅ `Чист`'}`
        )
        .addFields(
          {
            name: '📊 Действия за эту неделю:',
            value:
              `> 🛡️ Действий модератора: \`${stats.moderator || 0}\`\n` +
              `> 🤝 Действий саппорта: \`${stats.support || 0}\`\n` +
              `> 🔒 Действий клозера: \`${stats.closer || 0}\`\n` +
              `> 🎨 Действий креатива: \`${stats.creative || 0}\`\n` +
              `> 📈 Всего действий: \`${totalActions}\``,
            inline: false
          },
          {
            name: '⚠️ Взыскания сотрудника:',
            value: `> Предупреждений: \`${preds}\`\n> Варнов: \`${warns}\``,
            inline: false
          }
        )
        .setFooter({ text: 'Система профилей персонала • Moderation' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    // /staff actions
    if (sub === 'actions') {
      if (!isStaff(member)) {
        return interaction.reply({
          content: '❌ У вас нет прав для использования этой команды!',
          ephemeral: true
        });
      }

      const targetUser = interaction.options.getUser('moderator') || interaction.user;
      const stats = db.getStaffStats(guild.id, targetUser.id);

      const embed = new EmbedBuilder()
        .setTitle(`Действия за эту неделю - ${targetUser.username}`)
        .setColor('#2B2D31')
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
          { name: 'Действий модератора:', value: `\`${stats.moderator || 0}\``, inline: false },
          { name: 'Действий саппорта:', value: `\`${stats.support || 0}\``, inline: false },
          { name: 'Действий клозера:', value: `\`${stats.closer || 0}\``, inline: false },
          { name: 'Действий креатива:', value: `\`${stats.creative || 0}\``, inline: false }
        );

      return interaction.reply({ embeds: [embed] });
    }

    // /staff manage
    if (sub === 'manage') {
      return handleStaffManage(interaction);
    }
  }

  // 4. Handle /appeal
  if (commandName === 'appeal' || commandName === 'appeal_setup') {
    if (!canManageStaff(member)) {
      return interaction.reply({
        content: '❌ Эта команда доступна только для роли **Master** и выше!',
        ephemeral: true
      });
    }

    await setupBlacklistPermissions(guild);
    return interaction.reply({
      content: '✅ Канал апелляций и права доступа для Черного Списка успешно настроены и синхронизированы!',
      ephemeral: true
    });
  }

  // 5. Handle /report (доступно всем пользователям)
  if (commandName === 'report') {
    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    const proof = interaction.options.getString('proof') || '';

    if (targetUser.id === interaction.user.id) {
      return interaction.reply({
        content: '❌ Вы не можете подать жалобу на самого себя!',
        ephemeral: true
      });
    }

    if (targetUser.bot) {
      return interaction.reply({
        content: '❌ Вы не можете подать жалобу на бота!',
        ephemeral: true
      });
    }

    // If reason was provided directly in command
    if (reason && reason.trim()) {
      const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
      await sendReportToKorzina(guild, interaction.member, targetMember, reason.trim(), proof, interaction.channel);
      return interaction.reply({
        content: `✅ Ваша жалоба на пользователя <@${targetUser.id}> успешно отправлена модераторам в корзину!`,
        ephemeral: true
      });
    } else {
      // If reason not provided, open interactive Modal
      const modal = new ModalBuilder()
        .setCustomId(`modal:rep:submit:${targetUser.id}`)
        .setTitle(`Жалоба на ${targetUser.username}`.slice(0, 45));

      const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Причина жалобы')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Опишите нарушение подробно...')
        .setRequired(true);

      const proofInput = new TextInputBuilder()
        .setCustomId('proof')
        .setLabel('Доказательства (ссылка на скриншот)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('https://...')
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(reasonInput),
        new ActionRowBuilder().addComponents(proofInput)
      );

      return interaction.showModal(modal);
    }
  }

  // 6. Handle /voicesetup
  if (commandName === 'voicesetup') {
    if (!canManageStaff(member) && !isStaff(member)) {
      return interaction.reply({
        content: '❌ У вас нет прав для настройки голосовой модерации!',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });
    await setupVoicePermissions(guild);
    await deployVoiceSummonPanels(guild);
    return interaction.editReply({
      content: '✅ Настройки голосовых комнат успешно применены!\n• Текстовый чат в Модер-зоне (1-50) заблокирован для пользователей.\n• Панели с кнопками «Позвать модератора» и «Пожаловаться на нарушителя» обновлены во всех войсах!'
    });
  }

  // 7. Handle /call
  if (commandName === 'call') {
    const voiceChannel = member.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ Вы должны находиться в голосовом канале, чтобы позвать модератора!',
        ephemeral: true
      });
    }

    const modal = new ModalBuilder()
      .setCustomId('modal:voice:summon')
      .setTitle('Вызов модератора в войс');

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Причина вызова модератора')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Например: Оскорбления, помехи в войсе, троллинг')
      .setRequired(true)
      .setMaxLength(150);

    const detailsInput = new TextInputBuilder()
      .setCustomId('details')
      .setLabel('Кто нарушает или подробности (необязательно)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Укажите ник нарушителя или кратко опишите ситуацию...')
      .setRequired(false)
      .setMaxLength(500);

    modal.addComponents(
      new ActionRowBuilder().addComponents(reasonInput),
      new ActionRowBuilder().addComponents(detailsInput)
    );

    return interaction.showModal(modal);
  }

  // 8. Handle /blacklist
  if (commandName === 'blacklist') {
    if (!canManageStaff(member)) {
      return interaction.reply({
        content: '❌ Керувати Чорним Списком можуть лише користувачі з роллю **Master** та вище!',
        ephemeral: true
      });
    }

    const targetUser = interaction.options.getUser('user');
    if (targetUser) {
      const cardData = await createBlacklistUserCard(guild, targetUser.id, member);
      return interaction.reply(cardData);
    } else {
      const listData = await createBlacklistListEmbed(guild, 0);
      return interaction.reply(listData);
    }
  }

  // 9. Handle /key
  if (commandName === 'key') {
    const sub = interaction.options.getSubcommand();

    if (!canReviewKeyRequests(member)) {
      return interaction.reply({
        content: '❌ Керувати ключами стаффа можуть лише **Team leed**, **Administrator**, **Curator** та **Lame**!',
        ephemeral: true
      });
    }

    // /key panel
    if (sub === 'panel') {
      await interaction.deferReply({ ephemeral: true });
      const deployed = await deployKeyShopPanel(guild);
      if (deployed) {
        return interaction.editReply({
          content: `✅ Панель магазину ключів успішно розміщено в каналі <#${config.channels.keysShop}>!`
        });
      } else {
        return interaction.editReply({
          content: '❌ Не вдалося розгорнути панель магазину ключів. Перевірте канал `config.channels.keysShop`!'
        });
      }
    }

    // /key warn
    if (sub === 'warn') {
      const targetUser = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      const keyRoleId = config.roles.keyRole || config.keyRole.id;

      let targetMember = null;
      try {
        targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
      } catch {}

      const warnRes = db.addKeyWarn(guild.id, targetUser.id, 'key', interaction.user.id, reason);
      const warnCount = warnRes.warnCount;
      const nowText = formatUkrainianDateTime(Date.now());

      if (warnCount >= 2) {
        // 2nd warning -> REVOKE KEY & ROLE
        if (targetMember && keyRoleId) {
          const roleObj = guild.roles.cache.get(keyRoleId);
          if (roleObj && targetMember.roles.cache.has(roleObj.id)) {
            await targetMember.roles.remove(roleObj, `Вилучення ключа через 2 виговори від ${interaction.user.tag}`).catch(() => {});
          }
        }

        db.revokeKey(guild.id, targetUser.id, 'key');
        await revokeProkhodkaAccess(guild, targetUser.id);

        // Record in punishment history
        db.addPunishmentRecord(guild.id, targetUser.id, {
          type: 'key_revoked_warns',
          reason: `Отримано 2-й виговор по ключу 🔑: ${reason}`,
          moderatorId: interaction.user.id,
          moderatorTag: interaction.user.tag
        });

        // Notify user in DM
        if (targetMember) {
          targetMember.send(
            `⛔ **Ви отримали 2-й виговор (2/2) по ключу 🔑 на сервері ${guild.name}!**\n` +
            `👑 Модератор/Адміністратор: <@${interaction.user.id}> (\`${interaction.user.tag}\`)\n` +
            `**Причина 2-го виговору:** ${reason}\n\n` +
            `❌ **Ваш ключ та роль <@&${keyRoleId}> було автоматично анульовано!**`
          ).catch(() => {});
        }

        // Log to shopLog
        const logChannel = await guild.channels.fetch(config.channels.shopLog).catch(() => null);
        if (logChannel) {
          const logEmbed = new EmbedBuilder()
            .setTitle('⛔ [КЛЮЧ АНУЛЬОВАНО] Отримано 2-й виговор')
            .setColor('#ED4245')
            .addFields(
              { name: '👑 Хто покарав:', value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`, inline: true },
              { name: '👤 Користувач:', value: `<@${targetUser.id}> (\`${targetUser.tag}\`)`, inline: true },
              { name: '🔑 Ключ:', value: `<@&${keyRoleId}> (\`🔑\`)`, inline: true },
              { name: '⚠️ Виговори:', value: '`2 з 2 (Ключ знято)`', inline: true },
              { name: '💬 Причина останнього виговору:', value: `\`${reason}\``, inline: false },
              { name: '⏰ Дата та час:', value: `\`${nowText}\``, inline: false }
            )
            .setFooter({ text: 'Система ключа • Автоматичне зняття' })
            .setTimestamp();

          await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
        }

        return interaction.reply({
          content: `⛔ Користувачу <@${targetUser.id}> видано **2-й виговор (2/2)** по ключу 🔑!\nРоль <@&${keyRoleId}> автоматично вилучено, ключ анульовано.`
        });
      } else {
        // 1st warning
        if (targetMember) {
          targetMember.send(
            `⚠️ **Вам видано виговор (1/2) по ключу 🔑 на сервері ${guild.name}!**\n` +
            `👑 Модератор: <@${interaction.user.id}> (\`${interaction.user.tag}\`)\n` +
            `**Причина:** ${reason}\n\n` +
            `*Пам'ятайте: при отриманні 2-го виговору ключ та роль будуть автоматично анульовані!*`
          ).catch(() => {});
        }

        // Log to shopLog
        const logChannel = await guild.channels.fetch(config.channels.shopLog).catch(() => null);
        if (logChannel) {
          const logEmbed = new EmbedBuilder()
            .setTitle('⚠️ [ВИГОВОР ПО КЛЮЧУ] Видано виговор (1/2)')
            .setColor('#FFA500')
            .addFields(
              { name: '👑 Хто видав:', value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`, inline: true },
              { name: '👤 Користувач:', value: `<@${targetUser.id}> (\`${targetUser.tag}\`)`, inline: true },
              { name: '🔑 Ключ:', value: `<@&${keyRoleId}> (\`🔑\`)`, inline: true },
              { name: '⚠️ Поточні виговори:', value: '`1 з 2`', inline: true },
              { name: '💬 Причина:', value: `\`${reason}\``, inline: false },
              { name: '⏰ Дата та час:', value: `\`${nowText}\``, inline: false }
            )
            .setFooter({ text: 'Система ключа • Попередження' })
            .setTimestamp();

          await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
        }

        return interaction.reply({
          content: `⚠️ Користувачу <@${targetUser.id}> видано **виговор (1/2)** по ключу 🔑.\n**Причина:** ${reason}\nСповіщення надіслано в ЛС.`
        });
      }
    }

    // /key unwarn
    if (sub === 'unwarn') {
      const targetUser = interaction.options.getUser('user');

      const res = db.removeKeyWarn(guild.id, targetUser.id, 'key');
      if (!res) {
        return interaction.reply({
          content: `⚠️ У користувача <@${targetUser.id}> немає активних виговорів по ключу 🔑!`,
          ephemeral: true
        });
      }

      return interaction.reply({
        content: `✅ Знято 1 виговор по ключу 🔑 для користувача <@${targetUser.id}>.\nЗалишилось виговорів: **${res.remaining} / 2**.`
      });
    }

    // /key revoke
    if (sub === 'revoke') {
      const targetUser = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      const keyRoleId = config.roles.keyRole || config.keyRole.id;

      let targetMember = null;
      try {
        targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
      } catch {}

      if (targetMember && keyRoleId) {
        const roleObj = guild.roles.cache.get(keyRoleId);
        if (roleObj && targetMember.roles.cache.has(roleObj.id)) {
          await targetMember.roles.remove(roleObj, `Дострокове вилучення ключа ${interaction.user.tag}: ${reason}`).catch(() => {});
        }
      }

      db.revokeKey(guild.id, targetUser.id, 'key');
      await revokeProkhodkaAccess(guild, targetUser.id);

      if (targetMember) {
        targetMember.send(
          `⛔ **Ваш ключ 🔑 на сервері ${guild.name} було вилучено керівництвом!**\n` +
          `👑 Хто вилучив: <@${interaction.user.id}>\n` +
          `**Причина:** ${reason}`
        ).catch(() => {});
      }

      return interaction.reply({
        content: `✅ Ключ 🔑 (<@&${keyRoleId}>) успішно вилучено у користувача <@${targetUser.id}>.`
      });
    }

    // /key list
    if (sub === 'list') {
      const holders = db.getAllKeyHolders(guild.id).filter(h => h.keyType === 'key' || !h.keyType);
      const keyRoleId = config.roles.keyRole || config.keyRole.id;

      const embed = new EmbedBuilder()
        .setTitle('🔑 Активні держателі ключа стаффа')
        .setColor('#2B2D31')
        .setFooter({ text: `Всього активних ключів: ${holders.length}` })
        .setTimestamp();

      if (holders.length === 0) {
        embed.setDescription('Наразі немає жодного зареєстрованого держателя ключа 🔑.');
      } else {
        const lines = holders.map((h, idx) => {
          const warnCount = Array.isArray(h.warns) ? h.warns.length : 0;
          const grantedDate = formatUkrainianDateTime(h.grantedAt);
          return (
            `**${idx + 1}. <@${h.userId}>** — <@&${keyRoleId}>\n` +
            `    ├ ⚠️ **Виговори:** \`${warnCount} / 2\`\n` +
            `    ├ 👑 **Хто видав:** <@${h.grantedBy}>\n` +
            `    └ 📅 **Дата:** \`${grantedDate}\``
          );
        });
        embed.setDescription(lines.join('\n\n'));
      }

      return interaction.reply({ embeds: [embed] });
    }
  }
}

// Logic for /staff manage
async function handleStaffManage(interaction) {
  const { guild, member } = interaction;

  // Check if user is Master or higher
  if (!canManageStaff(member)) {
    return interaction.reply({
      content: '❌ Управління персоналом доступно лише для ролі **Master** та вище!',
      ephemeral: true
    });
  }

  const targetUser = interaction.options.getUser('user');

  if (targetUser) {
    let targetMember = null;
    try {
      targetMember = await guild.members.fetch(targetUser.id);
    } catch (e) {
      return interaction.reply({
        content: '❌ Учасника не знайдено на сервері!',
        ephemeral: true
      });
    }

    if (targetMember.id === guild.ownerId) {
      return interaction.reply({
        content: '❌ Ви не можете керувати Власником сервера!',
        ephemeral: true
      });
    }

    const executorTier = getStaffTier(member);
    const targetTier = getStaffTier(targetMember);

    if (executorTier <= targetTier && member.id !== guild.ownerId) {
      return interaction.reply({
        content: `❌ Ви не можете керувати учасником <@${targetMember.id}>, оскільки його посада дорівнює або вища за вашу!`,
        ephemeral: true
      });
    }

    await interaction.deferReply();
    const panelData = await createStaffManagePanel(targetMember, member);
    return interaction.editReply(panelData);
  } else {
    // Show select menu to pick member
    const selectMenu = new UserSelectMenuBuilder()
      .setCustomId('stf_select_user')
      .setPlaceholder('Оберіть співробітника для управління...')
      .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    return interaction.reply({
      content: '👑 Будь ласка, оберіть співробітника для управління персоналом:',
      components: [row],
      ephemeral: true
    });
  }
}

// Handle User Select Menus
async function handleUserSelect(interaction) {
  // Action User Select
  if (interaction.customId === 'select_action_user') {
    const selectedUserId = interaction.values[0];
    let targetMember = null;
    try {
      targetMember = await interaction.guild.members.fetch(selectedUserId);
    } catch (e) {
      return interaction.update({
        content: '❌ Учасника не знайдено!',
        components: []
      });
    }

    const panelData = createActionPanel(targetMember);
    return interaction.reply(panelData);
  }

  // Staff Manage User Select
  if (interaction.customId === 'stf_select_user') {
    const selectedUserId = interaction.values[0];
    let targetMember = null;
    try {
      targetMember = await interaction.guild.members.fetch(selectedUserId);
    } catch (e) {
      return interaction.update({
        content: '❌ Учасника не знайдено!',
        components: []
      });
    }

    if (targetMember.id === interaction.guild.ownerId) {
      return interaction.update({
        content: '❌ Ви не можете керувати Власником сервера!',
        components: []
      });
    }

    const executorTier = getStaffTier(interaction.member);
    const targetTier = getStaffTier(targetMember);

    if (executorTier <= targetTier && interaction.user.id !== interaction.guild.ownerId) {
      return interaction.update({
        content: `❌ Ви не можете керувати учасником <@${targetMember.id}>, оскільки його посада дорівнює або вища за вашу!`,
        components: []
      });
    }

    await interaction.deferReply();
    const panelData = await createStaffManagePanel(targetMember, interaction.member);
    return interaction.editReply(panelData);
  }
}

module.exports = {
  commands: [acationCommand, staffCommand, appealCommand, reportCommand, voicesetupCommand, callCommand, blacklistCommand, keyCommand],
  handleChatInputCommand,
  handleUserSelect
};
