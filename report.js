const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const config = require('./config');
const db = require('./database');
const { createActionPanel } = require('./panel');
const { isStaff } = require('./handlers');

// Build Embed and Buttons for a Report Card in #🗑️корзина
function buildReportCard(report, authorUser, targetUser, claimedMemberName = null) {
  let color = '#ED4245'; // default red
  let statusText = '🟡 **В ожидании рассмотрения**';

  if (report.status === 'in_progress') {
    color = '#FEE75C'; // yellow
    statusText = `🟢 **В обработке** (Взял: <@${report.claimedBy}>)`;
  } else if (report.status === 'resolved') {
    color = '#57F287'; // green
    statusText = `✅ **Рассмотрен и закрыт** (Модератор: <@${report.resolvedBy}>)`;
  } else if (report.status === 'rejected') {
    color = '#747F8D'; // grey
    statusText = `❌ **Отклонен** (Модератор: <@${report.resolvedBy}>)\n> **Причина отказа:** ${report.rejectReason || 'Не указана'}`;
  }

  const targetVoice = report.targetVoiceId
    ? `<#${report.targetVoiceId}> (\`${report.targetVoiceName}\`)`
    : '`Не в голосовом канале`';

  const authorVoice = report.authorVoiceId
    ? `<#${report.authorVoiceId}> (\`${report.authorVoiceName}\`)`
    : '`Не в голосовом канале`';

  const textChannelText = report.textChannelId
    ? `<#${report.textChannelId}>`
    : '`Не указан`';

  const embed = new EmbedBuilder()
    .setTitle(`🚨 Жалоба #${report.id.slice(-4)}`)
    .setColor(color)
    .setThumbnail(targetUser ? targetUser.displayAvatarURL({ dynamic: true, size: 256 }) : null)
    .addFields(
      {
        name: '👤 Отправитель:',
        value: authorUser ? `<@${authorUser.id}> (\`${authorUser.tag || authorUser.username}\`)` : `<@${report.authorId}>`,
        inline: true
      },
      {
        name: '🔊 Войс отправителя:',
        value: authorVoice,
        inline: true
      },
      {
        name: '\u200B',
        value: '\u200B',
        inline: true
      },
      {
        name: '🎯 Нарушитель:',
        value: targetUser ? `<@${targetUser.id}> (\`${targetUser.tag || targetUser.username}\`)\n\`ID: ${targetUser.id}\`` : `<@${report.targetId}>`,
        inline: true
      },
      {
        name: '🔊 Войс нарушителя:',
        value: targetVoice,
        inline: true
      },
      {
        name: '💬 Текстовый канал:',
        value: textChannelText,
        inline: true
      },
      {
        name: '📝 Причина жалобы:',
        value: report.reason || 'Не указана',
        inline: false
      },
      {
        name: '🔗 Доказательства:',
        value: report.proof && report.proof.trim() ? report.proof.trim() : '`Не прикреплены`',
        inline: false
      },
      {
        name: '📌 Статус жалобы:',
        value: statusText,
        inline: false
      }
    )
    .setFooter({ text: 'Система жалоб • Корзина' })
    .setTimestamp(new Date(report.createdAt));

  const rows = [];

  if (report.status === 'pending') {
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rep:claim:${report.id}`)
        .setLabel('Взять репорт')
        .setEmoji('✋')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`rep:act:${report.targetId}`)
        .setLabel('Действие: Нарушитель')
        .setEmoji('⚡')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`rep:act:${report.authorId}`)
        .setLabel('Действие: Автор')
        .setEmoji('⚠️')
        .setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rep:resolve:${report.id}`)
        .setLabel('Закрыть репорт')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`rep:reject:${report.id}`)
        .setLabel('Отклонить')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger)
    );

    rows.push(row1, row2);
  } else if (report.status === 'in_progress') {
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rep:claimed_info`)
        .setLabel(`Взят модератором`)
        .setEmoji('👮')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`rep:act:${report.targetId}`)
        .setLabel('Действие: Нарушитель')
        .setEmoji('⚡')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`rep:act:${report.authorId}`)
        .setLabel('Действие: Автор')
        .setEmoji('⚠️')
        .setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rep:resolve:${report.id}`)
        .setLabel('Закрыть репорт')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`rep:reject:${report.id}`)
        .setLabel('Отклонить')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger)
    );

    rows.push(row1, row2);
  }

  return {
    embeds: [embed],
    components: rows
  };
}

// Send Report to #🗑️корзина and log to #log1
async function sendReportToKorzina(guild, authorMember, targetMember, reason, proof = '', textChannel = null) {
  const authorUser = authorMember.user || authorMember;
  const targetUser = targetMember ? (targetMember.user || targetMember) : null;

  const targetVoice = targetMember?.voice?.channel;
  const authorVoice = authorMember?.voice?.channel;

  const report = db.addReport(guild.id, {
    authorId: authorUser.id,
    targetId: targetUser ? targetUser.id : (targetMember.id || 'unknown'),
    reason,
    proof,
    targetVoiceId: targetVoice ? targetVoice.id : null,
    targetVoiceName: targetVoice ? targetVoice.name : null,
    authorVoiceId: authorVoice ? authorVoice.id : null,
    authorVoiceName: authorVoice ? authorVoice.name : null,
    textChannelId: textChannel ? textChannel.id : null
  });

  // 1. Send card to #🗑️корзина
  const korzinaChannel = await guild.channels.fetch(config.channels.korzina).catch(() => null);
  if (korzinaChannel) {
    const cardData = buildReportCard(report, authorUser, targetUser);
    await korzinaChannel.send(cardData).catch(e => console.error('Ошибка отправки в корзину:', e.message));
  } else {
    console.error('❌ Канал корзины не найден!');
  }

  // 1b. If it involves a voice channel, also send to #войс-репрт
  if (config.channels.voiceReport && (authorVoice || targetVoice)) {
    const voiceReportChannel = await guild.channels.fetch(config.channels.voiceReport).catch(() => null);
    if (voiceReportChannel && voiceReportChannel.id !== config.channels.korzina) {
      const cardData = buildReportCard(report, authorUser, targetUser);
      await voiceReportChannel.send(cardData).catch(() => {});
    }
  }

  // 2. Send log to #log1
  const logChannel = await guild.channels.fetch(config.channels.log).catch(() => null);
  if (logChannel) {
    const logEmbed = new EmbedBuilder()
      .setTitle(`🚨 [НОВЫЙ РЕПОРТ #${report.id.slice(-4)}]`)
      .setColor('#E67E22')
      .addFields(
        { name: '👤 Отправитель:', value: `<@${authorUser.id}> (\`${authorUser.tag || authorUser.username}\`)`, inline: true },
        { name: '🔊 Войс отправителя:', value: authorVoice ? `<#${authorVoice.id}> (\`${authorVoice.name}\`)` : '`Не в войсе`', inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        { name: '🎯 Нарушитель:', value: targetUser ? `<@${targetUser.id}> (\`${targetUser.tag || targetUser.username}\`)` : `<@${report.targetId}>`, inline: true },
        { name: '🔊 Войс нарушителя:', value: targetVoice ? `<#${targetVoice.id}> (\`${targetVoice.name}\`)` : '`Не в войсе`', inline: true },
        { name: '💬 Канал:', value: textChannel ? `<#${textChannel.id}>` : '`Не указан`', inline: true },
        { name: '📝 Причина:', value: reason || 'Не указана', inline: false }
      )
      .setFooter({ text: 'Логирование репортов • Log' })
      .setTimestamp();

    await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
  }

  return report;
}

// Handle Report Buttons
async function handleReportButton(interaction) {
  const customId = interaction.customId;
  const parts = customId.split(':');
  const action = parts[1];
  const id = parts[2];
  const guild = interaction.guild;

  // Verify staff permissions
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: '❌ У вас нет прав для работы с репортами!',
      ephemeral: true
    });
  }

  // Quick Action Panel on member (offender or author)
  if (action === 'act') {
    const targetId = id;
    let targetMember = null;
    try {
      targetMember = await guild.members.fetch(targetId);
    } catch (e) {
      return interaction.reply({ content: '❌ Участник не найден на сервере!', ephemeral: true });
    }

    const panelData = createActionPanel(targetMember);
    return interaction.reply({ ...panelData, ephemeral: true });
  }

  const report = db.getReport(guild.id, id);
  if (!report) {
    return interaction.reply({ content: '❌ Репорт не найден в базе данных!', ephemeral: true });
  }

  let authorUser = null;
  let targetUser = null;
  try {
    authorUser = await interaction.client.users.fetch(report.authorId);
    targetUser = await interaction.client.users.fetch(report.targetId);
  } catch (e) {}

  const logChannel = await guild.channels.fetch(config.channels.log).catch(() => null);

  // 1. Claim Report
  if (action === 'claim') {
    if (report.status !== 'pending') {
      return interaction.reply({ content: '⚠️ Этот репорт уже взят в работу или закрыт!', ephemeral: true });
    }

    const updated = db.updateReport(guild.id, id, {
      status: 'in_progress',
      claimedBy: interaction.user.id
    });

    db.addStaffAction(guild.id, interaction.user.id, 'support');

    // Notify author in DM
    if (authorUser) {
      authorUser.send(
        `ℹ️ Вашу жалобу на пользователя <@${report.targetId}> взял на рассмотрение модератор <@${interaction.user.id}>.`
      ).catch(() => {});
    }

    // Send Log to #log1
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setTitle(`📋 [РЕПОРТ #${report.id.slice(-4)} ВЗЯТ В РАБОТУ]`)
        .setColor('#3498DB')
        .addFields(
          { name: '👮 Взял модератор:', value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`, inline: true },
          { name: '🎯 Нарушитель:', value: `<@${report.targetId}>`, inline: true },
          { name: '🔊 Войс нарушителя:', value: report.targetVoiceId ? `<#${report.targetVoiceId}> (\`${report.targetVoiceName}\`)` : '`Не в войсе`', inline: true },
          { name: '👤 Отправитель:', value: `<@${report.authorId}>`, inline: true },
          { name: '🔊 Войс отправителя:', value: report.authorVoiceId ? `<#${report.authorVoiceId}> (\`${report.authorVoiceName}\`)` : '`Не в войсе`', inline: true },
          { name: '📝 Причина:', value: report.reason || 'Не указана', inline: false }
        )
        .setFooter({ text: 'Логирование репортов • Log' })
        .setTimestamp();

      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }

    const cardData = buildReportCard(updated, authorUser, targetUser);
    return interaction.update(cardData);
  }

  // 2. Resolve Report
  if (action === 'resolve') {
    const updated = db.updateReport(guild.id, id, {
      status: 'resolved',
      resolvedBy: interaction.user.id
    });

    db.addStaffAction(guild.id, interaction.user.id, 'moderator');

    if (authorUser) {
      authorUser.send(
        `✅ Вашу жалобу на пользователя <@${report.targetId}> успешно рассмотрено и закрыто модератором <@${interaction.user.id}>. Спасибо за помощь серверу!`
      ).catch(() => {});
    }

    // Send Log to #log1
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setTitle(`✅ [РЕПОРТ #${report.id.slice(-4)} РАССМОТРЕН И ЗАКРЫТ]`)
        .setColor('#2ECC71')
        .addFields(
          { name: '👮 Закрыл модератор:', value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`, inline: true },
          { name: '🎯 Нарушитель:', value: `<@${report.targetId}>`, inline: true },
          { name: '👤 Отправитель:', value: `<@${report.authorId}>`, inline: true },
          { name: '📝 Причина:', value: report.reason || 'Не указана', inline: false }
        )
        .setFooter({ text: 'Логирование репортов • Log' })
        .setTimestamp();

      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }

    const cardData = buildReportCard(updated, authorUser, targetUser);
    return interaction.update(cardData);
  }

  // 3. Reject Report
  if (action === 'reject') {
    const modal = new ModalBuilder()
      .setCustomId(`modal:rep:reject:${id}`)
      .setTitle('Отклонение жалобы');

    const input = new TextInputBuilder()
      .setCustomId('reject_reason')
      .setLabel('Причина отклонения жалобы')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Например: ложная жалоба / нарушений нет / по приколу...')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }
}

// Handle Report Modals
async function handleReportModal(interaction) {
  const customId = interaction.customId;
  const guild = interaction.guild;

  // User submits report via modal
  if (customId.startsWith('modal:rep:submit:')) {
    const targetId = customId.split(':')[3];
    const reason = interaction.fields.getTextInputValue('reason');
    const proof = interaction.fields.getTextInputValue('proof') || '';

    let targetMember = null;
    try {
      targetMember = await guild.members.fetch(targetId);
    } catch (e) {}

    await sendReportToKorzina(guild, interaction.member, targetMember, reason, proof, interaction.channel);

    return interaction.reply({
      content: `✅ Ваша жалоба на пользователя <@${targetId}> успешно отправлена в канал модерации!`,
      ephemeral: true
    });
  }

  // Staff rejects report via modal
  if (customId.startsWith('modal:rep:reject:')) {
    const id = customId.split(':')[3];
    const rejectReason = interaction.fields.getTextInputValue('reject_reason');

    const updated = db.updateReport(guild.id, id, {
      status: 'rejected',
      resolvedBy: interaction.user.id,
      rejectReason
    });

    let authorUser = null;
    let targetUser = null;
    try {
      authorUser = await interaction.client.users.fetch(updated.authorId);
      targetUser = await interaction.client.users.fetch(updated.targetId);
    } catch (e) {}

    if (authorUser) {
      authorUser.send(
        `❌ Вашу жалобу на пользователя <@${updated.targetId}> было отклонено модератором <@${interaction.user.id}>.\n**Причина:** ${rejectReason}`
      ).catch(() => {});
    }

    // Log rejection to #log1
    const logChannel = await guild.channels.fetch(config.channels.log).catch(() => null);
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setTitle(`❌ [РЕПОРТ #${updated.id.slice(-4)} ОТКЛОНЕН]`)
        .setColor('#E74C3C')
        .addFields(
          { name: '👮 Отклонил модератор:', value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`, inline: true },
          { name: '🎯 Нарушитель:', value: `<@${updated.targetId}>`, inline: true },
          { name: '👤 Отправитель:', value: `<@${updated.authorId}>`, inline: true },
          { name: '❌ Причина отказа:', value: rejectReason, inline: false }
        )
        .setFooter({ text: 'Логирование репортов • Log' })
        .setTimestamp();

      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }

    const cardData = buildReportCard(updated, authorUser, targetUser);
    return interaction.update(cardData);
  }
}

module.exports = {
  sendReportToKorzina,
  handleReportButton,
  handleReportModal
};
