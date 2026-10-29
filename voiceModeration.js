const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ChannelType,
  PermissionsBitField
} = require('discord.js');
const config = require('./config');
const db = require('./database');
const { createActionPanel } = require('./panel');
const { isStaff } = require('./handlers');
const { sendReportToKorzina } = require('./report');

/**
 * 1. Synchronize Voice Permissions:
 * In "Модер-зона 1", disable text chat for regular members (@everyone)
 * while keeping it accessible to staff and bot.
 */
async function setupVoicePermissions(guild) {
  try {
    const moderZoneCatId = config.categories?.moderZone;
    if (!moderZoneCatId) return;

    const moderZoneCategory = await guild.channels.fetch(moderZoneCatId).catch(() => null);
    if (!moderZoneCategory) {
      console.warn(`[VoiceMod] Категория Модер-зона 1 (${moderZoneCatId}) не найдена.`);
      return;
    }

    console.log(`[VoiceMod] Настройка прав для категории: ${moderZoneCategory.name}...`);

    const everyoneRole = guild.roles.everyone;
    const botMember = await guild.members.fetchMe().catch(() => null);

    // 1. Category Overwrites: Deny @everyone text chat in voice channels
    await moderZoneCategory.permissionOverwrites.edit(everyoneRole, {
      SendMessages: false,
      SendMessagesInThreads: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false
    }).catch(err => console.error('[VoiceMod] Ошибка настройки @everyone на категории:', err));

    // Allow Bot full text and embed access
    if (botMember) {
      await moderZoneCategory.permissionOverwrites.edit(botMember, {
        ViewChannel: true,
        SendMessages: true,
        EmbedLinks: true,
        AttachFiles: true,
        ManageMessages: true
      }).catch(() => {});
    }

    // Allow Staff roles to write in text chats
    const staffRoleIds = [
      config.roles.moder,
      config.roles.staffModer,
      config.roles.admin,
      config.roles.master,
      config.roles.curator,
      config.roles.support,
      config.roles.closeMode,
      ...(config.roles.staffRoles || [])
    ].filter(Boolean);

    for (const rId of staffRoleIds) {
      const role = guild.roles.cache.get(rId);
      if (role) {
        const existing = moderZoneCategory.permissionOverwrites.cache.get(role.id);
        if (existing && existing.allow.has(PermissionsBitField.Flags.SendMessages)) continue;

        await moderZoneCategory.permissionOverwrites.edit(role, {
          SendMessages: true,
          ViewChannel: true,
          EmbedLinks: true,
          AttachFiles: true
        }).catch(() => {});
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // 2. Apply directly to all 50 voice channels in Модер-зона 1 (⚪ · R ¹ to ⚪ · R ⁵⁰)
    const childVoiceChannels = moderZoneCategory.children.cache.filter(
      c => c.type === ChannelType.GuildVoice
    );

    console.log(`[VoiceMod] Блокировка текстового чата для ${childVoiceChannels.size} войсов (1-50) в Модер-зона 1...`);

    for (const [, voiceChannel] of childVoiceChannels) {
      try {
        const currentOverwrite = voiceChannel.permissionOverwrites.cache.get(everyoneRole.id);
        const alreadyDenied = currentOverwrite && currentOverwrite.deny.has(PermissionsBitField.Flags.SendMessages);

        if (!alreadyDenied) {
          await voiceChannel.permissionOverwrites.edit(everyoneRole, {
            SendMessages: false,
            SendMessagesInThreads: false,
            CreatePublicThreads: false,
            CreatePrivateThreads: false
          });
          await new Promise(r => setTimeout(r, 100));
        }
      } catch (e) {
        // Continue silently on single channel errors
      }
    }

    console.log('✅ [VoiceMod] Права в Модер-зона 1 успешно настроены (чат заблокирован для пользователей)!');
  } catch (error) {
    console.error('❌ [VoiceMod] Ошибка при настройке прав войс-чатов:', error);
  }
}

/**
 * 2. Deploy Summon & Quick Report Panels in voice channels (1-50 and public rooms)
 * Excludes private rooms (config.categories.privateRooms).
 */
async function deployVoiceSummonPanels(guild) {
  try {
    const privateCatId = config.categories?.privateRooms;
    const channels = await guild.channels.fetch();

    const publicVoiceChannels = channels.filter(c => {
      if (c.type !== ChannelType.GuildVoice) return false;
      if (privateCatId && c.parentId === privateCatId) return false;
      if (c.name.includes('Створити кімнату') || c.name.startsWith('🔒')) return false;
      return true;
    });

    console.log(`[VoiceMod] Развертывание панелей модерации в ${publicVoiceChannels.size} голосовых комнатах...`);

    let deployedCount = 0;

    for (const [, voiceChannel] of publicVoiceChannels) {
      try {
        // Check if bot already posted the panel in the last 10 messages
        const recentMessages = await voiceChannel.messages.fetch({ limit: 10 }).catch(() => null);
        const alreadyHasPanel = recentMessages && recentMessages.some(m =>
          m.author.id === guild.client.user.id &&
          m.components?.some(row => row.components?.some(b => b.customId === 'voice:summon' || b.customId === 'voice:quick_report'))
        );

        if (!alreadyHasPanel) {
          const summonEmbed = new EmbedBuilder()
            .setTitle(`🛡️ Модерация голосового канала • ${voiceChannel.name}`)
            .setDescription(
              `В этой комнате **отключен текстовый чат** для поддержания порядка.\n\n` +
              `**Нужна помощь или возник конфликт?**\n` +
              `• **🔔 Позвать модератора** — позвать администратора или модератора в этот канал.\n` +
              `• **🚨 Пожаловаться на нарушителя** — отправить быструю жалобу на нарушителя из этого войса (без необходимости писать /report в корзину).`
            )
            .setColor('#2B2D31')
            .setFooter({ text: 'Система безопасности голосовых каналов • LUVEX' });

          const summonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('voice:summon')
              .setLabel('Позвать модератора')
              .setEmoji('🔔')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId('voice:quick_report')
              .setLabel('Пожаловаться на нарушителя')
              .setEmoji('🚨')
              .setStyle(ButtonStyle.Danger)
          );

          await voiceChannel.send({ embeds: [summonEmbed], components: [summonRow] });
          deployedCount++;
          await new Promise(r => setTimeout(r, 200)); // Respect Discord rate limits
        }
      } catch (err) {
        // Channel might have restrictive bot permissions
      }
    }

    console.log(`✅ [VoiceMod] Панели голосовой модерации проверены. Новых отправлено: ${deployedCount}.`);
  } catch (error) {
    console.error('❌ [VoiceMod] Ошибка при развертывании кнопок вызова:', error);
  }
}

/**
 * 3. Handle Voice Button Clicks
 */
async function handleVoiceButton(interaction) {
  const { customId, guild, member, user } = interaction;

  // A. [🔔 Позвать модератора]
  if (customId === 'voice:summon') {
    const voiceChannel = member.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ Вы должны находиться в голосовом канале, чтобы позвать персонал!',
        ephemeral: true
      });
    }

    const privateCatId = config.categories?.privateRooms;
    if (privateCatId && voiceChannel.parentId === privateCatId) {
      return interaction.reply({
        content: '❌ Вызовы модератора недоступны в приватных комнатах.',
        ephemeral: true
      });
    }

    // Check if channel already has an active pending call
    const activeCall = db.getActiveVoiceCallForChannel(guild.id, voiceChannel.id);
    if (activeCall && activeCall.status === 'pending') {
      return interaction.reply({
        content: `⚠️ В комнате **${voiceChannel.name}** уже отправлен вызов модератора! Ожидайте подключения персонала.`,
        ephemeral: true
      });
    }

    // Show modal to specify reason
    const modal = new ModalBuilder()
      .setCustomId('modal:voice:summon')
      .setTitle('Вызов персонала в войс');

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

  // B. [🚨 Пожаловаться на нарушителя] (Fast report directly from voice channel)
  if (customId === 'voice:quick_report') {
    const voiceChannel = member.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ Вы должны находиться в голосовом канале, чтобы подать жалобу на нарушителя!',
        ephemeral: true
      });
    }

    const privateCatId = config.categories?.privateRooms;
    if (privateCatId && voiceChannel.parentId === privateCatId) {
      return interaction.reply({
        content: '❌ Быстрые жалобы недоступны в приватных комнатах.',
        ephemeral: true
      });
    }

    // Get members currently in the channel (excluding caller and bots)
    const otherMembers = Array.from(voiceChannel.members.values()).filter(
      m => m.id !== user.id && !m.user.bot
    );

    const components = [];

    if (otherMembers.length > 0) {
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`voice:rep_target_str:${voiceChannel.id}`)
        .setPlaceholder('🎯 Выберите нарушителя из вашей комнаты...');

      for (const m of otherMembers.slice(0, 25)) {
        selectMenu.addOptions({
          label: (m.displayName || m.user.username).slice(0, 25),
          description: `@${m.user.tag} (ID: ${m.id})`.slice(0, 50),
          value: m.id,
          emoji: '🎯'
        });
      }

      components.push(new ActionRowBuilder().addComponents(selectMenu));
    }

    // Also add UserSelectMenu so user can select any member (e.g. if the violator just left)
    const userSelectMenu = new UserSelectMenuBuilder()
      .setCustomId(`voice:rep_target_usr:${voiceChannel.id}`)
      .setPlaceholder('🔍 Или выберите участника из общего списка сервера...')
      .setMaxValues(1);

    components.push(new ActionRowBuilder().addComponents(userSelectMenu));

    return interaction.reply({
      content: `🚨 **Быстрая жалоба из канала <#${voiceChannel.id}>**\nВыберите нарушителя из списка участников ниже:`,
      components,
      ephemeral: true
    });
  }

  // C. [✋ Принять вызов]
  if (customId.startsWith('voice:claim:')) {
    const callId = customId.split(':')[2];

    if (!isStaff(member)) {
      return interaction.reply({
        content: '❌ Только персонал сервера может принимать вызовы!',
        ephemeral: true
      });
    }

    const call = db.getVoiceCall(guild.id, callId);
    if (!call) {
      return interaction.reply({
        content: '❌ Вызов не найден в базе данных.',
        ephemeral: true
      });
    }

    if (call.status === 'in_progress') {
      return interaction.reply({
        content: `⚠️ Этот вызов уже принял модератор <@${call.claimedBy}>!`,
        ephemeral: true
      });
    }

    if (call.status === 'resolved') {
      return interaction.reply({
        content: `✅ Этот вызов уже был закрыт модератором <@${call.resolvedBy}>!`,
        ephemeral: true
      });
    }

    // Update in database
    db.updateVoiceCall(guild.id, callId, {
      status: 'in_progress',
      claimedBy: user.id,
      claimedAt: new Date().toISOString()
    });

    // Add to staff statistics
    db.addStaffAction(guild.id, user.id, 'moderator');

    // Update Embed in войс-репрт
    const participantsList = call.participants?.map(p => `• <@${p.id}> (\`${p.tag}\`)`).join('\n') || 'Неизвестно';

    const updatedEmbed = new EmbedBuilder()
      .setTitle(`🟢 Взят вызов: ${call.voiceChannelName}`)
      .setColor('#FEE75C')
      .addFields(
        { name: '🔊 Голосовой канал:', value: `<#${call.voiceChannelId}> (\`${call.voiceChannelName}\`)`, inline: true },
        { name: '👤 Инициатор вызова:', value: `<@${call.authorId}>`, inline: true },
        { name: '👮 Взят модератором:', value: `<@${user.id}> (\`${user.tag}\`)`, inline: true },
        { name: '👥 Участники на момент вызова:', value: participantsList.slice(0, 1024), inline: false },
        { name: '📝 Причина:', value: call.reason || 'Не указана', inline: false },
        { name: '📋 Дополнительно:', value: call.details && call.details.trim() ? call.details.trim() : '`Не указано`', inline: false },
        { name: '📌 Статус вызова:', value: `🟢 **В обработке модератором <@${user.id}>**`, inline: false }
      )
      .setFooter({ text: `Вызов #${call.id} • LUVEX Staff` })
      .setTimestamp(new Date(call.createdAt));

    const updatedRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`voice:claimed_by:${user.id}`)
        .setLabel(`Принял: ${user.username}`)
        .setEmoji('👮')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`voice:act:${call.id}`)
        .setLabel('Действие / Наказать')
        .setEmoji('⚡')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`voice:resolve:${call.id}`)
        .setLabel('Завершить')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
    );

    await interaction.update({ embeds: [updatedEmbed], components: [updatedRow] }).catch(() => {});

    // Notify in voice channel text chat
    const voiceChannel = guild.channels.cache.get(call.voiceChannelId);
    if (voiceChannel) {
      await voiceChannel.send({
        content: `🟢 Модератор <@${user.id}> принял вызов и подключается в комнату!`
      }).catch(() => {});
    }

    // Send log to #log1
    const logChannel = guild.channels.cache.get(config.channels.log);
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setTitle('📋 Лог: Принят вызов в голосовой канал')
        .setColor('#57F287')
        .addFields(
          { name: '👮 Модератор:', value: `<@${user.id}> (\`${user.tag}\`)\n\`ID: ${user.id}\``, inline: true },
          { name: '🔊 Голосовой канал:', value: `<#${call.voiceChannelId}> (\`${call.voiceChannelName}\`)`, inline: true },
          { name: '👤 Инициатор:', value: `<@${call.authorId}>`, inline: true },
          { name: '📝 Причина:', value: call.reason || 'Не указана', inline: false },
          { name: '👥 Участники в канале:', value: participantsList.slice(0, 1024), inline: false }
        )
        .setFooter({ text: `Вызов #${call.id} • Лог войс-репорта` })
        .setTimestamp();

      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }

    return interaction.followUp({
      content: `✅ Вы успешно приняли вызов! Подключитесь в канал <#${call.voiceChannelId}>.`,
      ephemeral: true
    }).catch(() => {});
  }

  // D. [⚡ Действие / Наказать]
  if (customId.startsWith('voice:act:')) {
    const callId = customId.split(':')[2];

    if (!isStaff(member)) {
      return interaction.reply({
        content: '❌ Только персонал сервера может использовать действия!',
        ephemeral: true
      });
    }

    const call = db.getVoiceCall(guild.id, callId);
    if (!call) {
      return interaction.reply({ content: '❌ Вызов не найден.', ephemeral: true });
    }

    const voiceChannel = guild.channels.cache.get(call.voiceChannelId);
    const usersMap = new Map();

    if (call.participants) {
      for (const p of call.participants) {
        usersMap.set(p.id, p.tag);
      }
    }

    if (voiceChannel && voiceChannel.members) {
      for (const [, m] of voiceChannel.members) {
        usersMap.set(m.id, m.user.tag);
      }
    }

    if (usersMap.size === 0) {
      return interaction.reply({
        content: '❌ В голосовом канале не найдено участников для выбора.',
        ephemeral: true
      });
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`voice:select_target:${call.id}`)
      .setPlaceholder('Выберите участника для применения действий (/acation)...');

    let count = 0;
    for (const [id, tag] of usersMap.entries()) {
      if (count >= 25) break;
      selectMenu.addOptions({
        label: tag.slice(0, 25),
        description: `ID: ${id}`,
        value: id,
        emoji: '👤'
      });
      count++;
    }

    const row = new ActionRowBuilder().addComponents(selectMenu);

    return interaction.reply({
      content: '⚡ Выберите участника из голосового канала, чтобы открыть панель модерации:',
      components: [row],
      ephemeral: true
    });
  }

  // E. [✅ Завершить вызов]
  if (customId.startsWith('voice:resolve:')) {
    const callId = customId.split(':')[2];

    if (!isStaff(member)) {
      return interaction.reply({
        content: '❌ Только персонал сервера может закрывать вызовы!',
        ephemeral: true
      });
    }

    const call = db.getVoiceCall(guild.id, callId);
    if (!call) {
      return interaction.reply({ content: '❌ Вызов не найден.', ephemeral: true });
    }

    db.updateVoiceCall(guild.id, callId, {
      status: 'resolved',
      resolvedBy: user.id,
      resolvedAt: new Date().toISOString()
    });

    const participantsList = call.participants?.map(p => `• <@${p.id}> (\`${p.tag}\`)`).join('\n') || 'Неизвестно';

    const closedEmbed = new EmbedBuilder()
      .setTitle(`✅ Вызов закрыт: ${call.voiceChannelName}`)
      .setColor('#57F287')
      .addFields(
        { name: '🔊 Голосовой канал:', value: `<#${call.voiceChannelId}> (\`${call.voiceChannelName}\`)`, inline: true },
        { name: '👤 Инициатор вызова:', value: `<@${call.authorId}>`, inline: true },
        { name: '👮 Закрыл модератор:', value: `<@${user.id}> (\`${user.tag}\`)`, inline: true },
        { name: '👥 Участники на момент вызова:', value: participantsList.slice(0, 1024), inline: false },
        { name: '📝 Причина:', value: call.reason || 'Не указана', inline: false },
        { name: '📌 Статус:', value: `✅ **Рассмотрен и закрыт** модератором <@${user.id}>`, inline: false }
      )
      .setFooter({ text: `Вызов #${call.id} • LUVEX Staff` })
      .setTimestamp();

    const closedRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`voice:closed`)
        .setLabel(`Закрыт модератором ${user.username}`)
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
        .setDisabled(true)
    );

    await interaction.update({ embeds: [closedEmbed], components: [closedRow] }).catch(() => {});

    // Notify voice channel
    const voiceChannel = guild.channels.cache.get(call.voiceChannelId);
    if (voiceChannel) {
      await voiceChannel.send({
        content: `✅ Вызов модератора в этой комнате завершен модератором <@${user.id}>.`
      }).catch(() => {});
    }

    // Log to #log1
    const logChannel = guild.channels.cache.get(config.channels.log);
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setTitle('✅ Лог: Вызов в войс успешно закрыт')
        .setColor('#57F287')
        .addFields(
          { name: '👮 Модератор:', value: `<@${user.id}> (\`${user.tag}\`)`, inline: true },
          { name: '🔊 Канал:', value: `<#${call.voiceChannelId}> (\`${call.voiceChannelName}\`)`, inline: true },
          { name: '👤 Инициатор:', value: `<@${call.authorId}>`, inline: true }
        )
        .setFooter({ text: `Вызов #${call.id} • Лог закрытия` })
        .setTimestamp();

      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }

    return interaction.followUp({
      content: `✅ Вызов в канале <#${call.voiceChannelId}> успешно закрыт!`,
      ephemeral: true
    }).catch(() => {});
  }
}

/**
 * 4. Handle Voice Selection Menus (Target Selection for Quick Report or Action)
 */
async function handleVoiceSelect(interaction) {
  const { customId, guild, values } = interaction;

  // A. Target selection from Quick Report dropdown
  if (customId.startsWith('voice:rep_target_str:') || customId.startsWith('voice:rep_target_usr:')) {
    const targetUserId = values[0];
    const targetMember = await guild.members.fetch(targetUserId).catch(() => null);

    if (!targetMember) {
      return interaction.reply({
        content: '❌ Участник не найден на сервере!',
        ephemeral: true
      });
    }

    if (targetMember.id === interaction.user.id) {
      return interaction.reply({
        content: '❌ Вы не можете пожаловаться на самого себя!',
        ephemeral: true
      });
    }

    if (targetMember.user.bot) {
      return interaction.reply({
        content: '❌ Вы не можете пожаловаться на бота!',
        ephemeral: true
      });
    }

    // Open modal to submit report on this target
    const modal = new ModalBuilder()
      .setCustomId(`modal:voice:quick_report:${targetMember.id}`)
      .setTitle(`Жалоба на ${targetMember.user.username}`.slice(0, 45));

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Причина жалобы (что нарушил)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Оскорбления, помехи в войсе, voicemode, провокация...')
      .setRequired(true)
      .setMaxLength(300);

    const proofInput = new TextInputBuilder()
      .setCustomId('proof')
      .setLabel('Доказательства или ссылка (необязательно)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('https://... (скриншот или ссылка)')
      .setRequired(false)
      .setMaxLength(250);

    modal.addComponents(
      new ActionRowBuilder().addComponents(reasonInput),
      new ActionRowBuilder().addComponents(proofInput)
    );

    return interaction.showModal(modal);
  }

  // B. Target selection from Voice Action Menu
  if (customId.startsWith('voice:select_target:')) {
    const targetUserId = values[0];
    const targetMember = await guild.members.fetch(targetUserId).catch(() => null);

    if (!targetMember) {
      return interaction.reply({
        content: '❌ Участник не найден на сервере (возможно, вышел).',
        ephemeral: true
      });
    }

    // Build Action Panel for the selected target
    const panel = createActionPanel(targetMember, targetMember.user);

    return interaction.reply({
      embeds: [panel.embed],
      components: panel.components,
      ephemeral: true
    });
  }
}

/**
 * 5. Handle Voice Modals
 */
async function handleVoiceModal(interaction) {
  const { customId, guild, member, user } = interaction;

  // A. Modal for [🔔 Позвать модератора]
  if (customId === 'modal:voice:summon') {
    const reason = interaction.fields.getTextInputValue('reason');
    const details = interaction.fields.getTextInputValue('details') || '';

    const voiceChannel = member.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ Вы покинули голосовой канал. Вызов отменен.',
        ephemeral: true
      });
    }

    const membersInVoice = Array.from(voiceChannel.members.values());
    const participantsList = membersInVoice.map(m => `• <@${m.id}> (\`${m.user.tag}\`)`).join('\n') || 'Только вы';

    // Save call to database
    const call = db.addVoiceCall(guild.id, {
      voiceChannelId: voiceChannel.id,
      voiceChannelName: voiceChannel.name,
      authorId: user.id,
      participants: membersInVoice.map(m => ({ id: m.id, tag: m.user.tag })),
      reason,
      details
    });

    // Send Alert to #войс-репрт
    const voiceReportChannelId = config.channels.voiceReport;
    const voiceReportChannel = guild.channels.cache.get(voiceReportChannelId);

    const alertEmbed = new EmbedBuilder()
      .setTitle(`🚨 Вызов в голосовой канал: ${voiceChannel.name}`)
      .setColor('#ED4245')
      .addFields(
        { name: '🔊 Голосовой канал:', value: `<#${voiceChannel.id}> (\`${voiceChannel.name}\`)`, inline: true },
        { name: '👤 Инициатор вызова:', value: `<@${user.id}> (\`${user.tag}\`)\n\`ID: ${user.id}\``, inline: true },
        { name: `👥 Участники в комнате (${membersInVoice.length}):`, value: participantsList.slice(0, 1024), inline: false },
        { name: '📝 Причина вызова:', value: reason, inline: false },
        { name: '📋 Дополнительно:', value: details.trim() ? details.trim() : '`Не указано`', inline: false },
        { name: '📌 Статус вызова:', value: '🟡 **Ожидает ответа модератора**', inline: false }
      )
      .setFooter({ text: `Вызов #${call.id} • Войс-Репорт` })
      .setTimestamp();

    const alertRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`voice:claim:${call.id}`)
        .setLabel('Принять вызов')
        .setEmoji('✋')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`voice:act:${call.id}`)
        .setLabel('Действие / Наказать')
        .setEmoji('⚡')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`voice:resolve:${call.id}`)
        .setLabel('Завершить')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
    );

    if (voiceReportChannel) {
      await voiceReportChannel.send({
        content: '🚨 **Внимание модераторам!** Поступил новый вызов в голосовой канал:',
        embeds: [alertEmbed],
        components: [alertRow]
      }).catch(err => console.error('[VoiceMod] Ошибка отправки в войс-репрт:', err));
    }

    // Post notification in the voice channel's chat
    await voiceChannel.send({
      content: `🔔 <@${user.id}> вызвал модерацию сервера в этот канал!\n> **Причина:** ${reason}\nМодератор уведомлен и скоро подключится.`
    }).catch(() => {});

    return interaction.reply({
      content: `✅ Ваш вызов успешно передан модераторам!\n🔊 Канал: <#${voiceChannel.id}>\nОжидайте подключения персонала.`,
      ephemeral: true
    });
  }

  // B. Modal for [🚨 Быстрая жалоба на нарушителя]
  if (customId.startsWith('modal:voice:quick_report:')) {
    const targetUserId = customId.split(':')[3];
    const reason = interaction.fields.getTextInputValue('reason');
    const proof = interaction.fields.getTextInputValue('proof') || '';

    const targetMember = await guild.members.fetch(targetUserId).catch(() => null);
    const authorMember = interaction.member;
    const voiceChannel = authorMember.voice?.channel;

    // Send report to #корзина and log
    const report = await sendReportToKorzina(
      guild,
      authorMember,
      targetMember,
      reason,
      proof,
      voiceChannel
    );

    // Also send duplicate alert to #войс-репрт with direct voice focus
    const voiceReportChannelId = config.channels.voiceReport;
    const voiceReportChannel = guild.channels.cache.get(voiceReportChannelId);
    if (voiceReportChannel) {
      const participantsList = voiceChannel
        ? Array.from(voiceChannel.members.values()).map(m => `• <@${m.id}> (\`${m.user.tag}\`)`).join('\n')
        : '`Не в войсе`';

      const voiceRepEmbed = new EmbedBuilder()
        .setTitle(`🚨 Быстрая жалоба из войса #${report.id.slice(-4)} • ${voiceChannel ? voiceChannel.name : 'Голосовой'}`)
        .setColor('#ED4245')
        .addFields(
          { name: '👤 Автор жалобы:', value: `<@${user.id}> (\`${user.tag}\`)`, inline: true },
          { name: '🎯 Нарушитель:', value: targetMember ? `<@${targetMember.id}> (\`${targetMember.user.tag}\`)` : `<@${targetUserId}>`, inline: true },
          { name: '🔊 Голосовой канал:', value: voiceChannel ? `<#${voiceChannel.id}> (\`${voiceChannel.name}\`)` : '`Не в канале`', inline: true },
          { name: `👥 Участники в комнате (${voiceChannel ? voiceChannel.members.size : 0}):`, value: participantsList.slice(0, 1024), inline: false },
          { name: '📝 Причина:', value: reason, inline: false },
          { name: '🔗 Доказательства:', value: proof && proof.trim() ? proof.trim() : '`Не указаны`', inline: false },
          { name: '📌 Статус:', value: '🟡 **Ожидает рассмотрения модератором**', inline: false }
        )
        .setFooter({ text: `Жалоба #${report.id.slice(-4)} • Войс-Репорт` })
        .setTimestamp();

      const voiceRepRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rep:claim:${report.id}`)
          .setLabel('Взять репорт')
          .setEmoji('✋')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`rep:act:${targetUserId}`)
          .setLabel('Наказать: Нарушитель')
          .setEmoji('⚡')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`rep:act:${user.id}`)
          .setLabel('Действие: Автор')
          .setEmoji('⚠️')
          .setStyle(ButtonStyle.Secondary)
      );

      await voiceReportChannel.send({
        content: '🚨 **Быстрая жалоба из голосового канала:**',
        embeds: [voiceRepEmbed],
        components: [voiceRepRow]
      }).catch(() => {});
    }

    // Post notification in the voice channel's chat
    if (voiceChannel) {
      await voiceChannel.send({
        content: `🚨 <@${user.id}> отправил быструю жалобу на <@${targetUserId}> в этой комнате. Модерация сервера уведомлена!`
      }).catch(() => {});
    }

    return interaction.reply({
      content: `✅ Ваша жалоба на пользователя <@${targetUserId}> успешно отправлена персоналу сервера!\n🔊 Канал: <#${voiceChannel ? voiceChannel.id : ''}>\nОжидайте рассмотрения модератором.`,
      ephemeral: true
    });
  }
}

module.exports = {
  setupVoicePermissions,
  deployVoiceSummonPanels,
  handleVoiceButton,
  handleVoiceSelect,
  handleVoiceModal
};
