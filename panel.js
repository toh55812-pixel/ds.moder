const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require('discord.js');
const db = require('./database');
const config = require('./config');
const {
  getRoleGrantInfo,
  formatUkrainianDateTime,
  getGrantableStaffRoles,
  getRoleStaffLevel,
  getMemberStaffLevel,
  getStaffLevelTitle
} = require('./roleHistory');

function formatDate(date) {
  if (!date) return 'Неизвестно';
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}.${m}.${y}`;
}

// Action Panel for /action (Regular Moderator Panel)
function createActionPanel(member) {
  const user = member.user;
  const joinDate = formatDate(member.joinedAt);

  const embed = new EmbedBuilder()
    .setTitle('Взаимодействие с участником')
    .setColor('#2B2D31')
    .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setDescription(
      `**Никнейм:** ${user.username}\n` +
      `**ID:** ${user.id}\n` +
      `**Дата входа:** ${joinDate}`
    );

  const targetId = member.id;

  // Row 1: Выдать пред, Выдать варн, Выдать мут, Выдать бан
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`act:pred:add:${targetId}`)
      .setLabel('Выдать пред')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`act:warn:add:${targetId}`)
      .setLabel('Выдать варн')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`act:mute:add:${targetId}`)
      .setLabel('Выдать мут')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`act:ban:add:${targetId}`)
      .setLabel('Выдать бан')
      .setStyle(ButtonStyle.Secondary)
  );

  // Row 2: Снять пред, Снять варн, Снять мут, Снять бан
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`act:pred:rem:${targetId}`)
      .setLabel('Снять пред')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`act:warn:rem:${targetId}`)
      .setLabel('Снять варн')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`act:mute:rem:${targetId}`)
      .setLabel('Снять мут')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`act:ban:rem:${targetId}`)
      .setLabel('Снять бан')
      .setStyle(ButtonStyle.Secondary)
  );

  // Row 3: Сменить гендер, Верифицировать, Выдать недопуск, Снять недопуск
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`act:gender:toggle:${targetId}`)
      .setLabel('Сменить гендер')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`act:verify:${targetId}`)
      .setLabel('Верифицировать')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`act:denied:add:${targetId}`)
      .setLabel('Выдать недопуск')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`act:denied:rem:${targetId}`)
      .setLabel('Снять недопуск')
      .setStyle(ButtonStyle.Secondary)
  );

  // Row 4: Выдать отстранение, Снять отстранение, Выдать креативную роль
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`act:suspend:add:${targetId}`)
      .setLabel('Выдать отстранение')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`act:suspend:rem:${targetId}`)
      .setLabel('Снять отстранение')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`act:creative:toggle:${targetId}`)
      .setLabel('Выдать креативную роль')
      .setStyle(ButtonStyle.Secondary)
  );

  // Row 5: Отмена (Danger red button)
  const row5 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`act:cancel:${targetId}`)
      .setLabel('Отмена')
      .setStyle(ButtonStyle.Danger)
  );

  return {
    embeds: [embed],
    components: [row1, row2, row3, row4, row5]
  };
}

// Staff Management Panel for /staff manage (Master & Higher)
async function createStaffManagePanel(targetMember, executorMember) {
  const user = targetMember.user;
  const guild = targetMember.guild;
  const targetId = targetMember.id;

  const preds = db.getInfractionsCount(guild.id, targetId, 'pred');
  const warns = db.getInfractionsCount(guild.id, targetId, 'warn');
  const isBL = db.isBlacklisted(guild.id, targetId);

  // Identify staff roles that the target currently has
  const staffIds = config.roles.staffRoles || [];
  const staffKeywords = [
    'moder', 'модер', 'staffmoder', 'support', 'suport', 'closemode', 'closer',
    'creative', 'content maker', 'evente', 'tribune mod', 'steamer', 'curator',
    'team leed', 'lame', 'master', 'admin', 'administrator'
  ];

  const targetStaffRoles = targetMember.roles.cache.filter(r =>
    r.id !== guild.id && !r.managed && (staffIds.includes(r.id) || staffKeywords.some(k => r.name.toLowerCase().includes(k)))
  );

  // Fetch who granted each staff role and when
  const staffRoleLines = [];
  const roleSelectOptions = [];

  for (const [, role] of targetStaffRoles) {
    const grantInfo = await getRoleGrantInfo(guild, targetId, role.id);
    const issuerText = grantInfo.executorId ? `<@${grantInfo.executorId}> (\`${grantInfo.executorTag}\`)` : `\`${grantInfo.executorTag || 'Невідомо'}\``;
    const dateText = formatUkrainianDateTime(grantInfo.timestamp || grantInfo.createdAt);

    staffRoleLines.push(`• <@&${role.id}> (\`${role.name}\`)\n  └ 👤 **Хто видав:** ${issuerText}\n  └ 📅 **Коли видано:** \`${dateText}\``);

    roleSelectOptions.push({
      label: `Зняти посаду: ${role.name}`.slice(0, 100),
      value: role.id,
      description: `Видав: ${grantInfo.executorTag || 'Невідомо'} • ${dateText}`.slice(0, 100),
      emoji: '👔'
    });
  }

  const staffRolesSection = staffRoleLines.length > 0
    ? staffRoleLines.join('\n')
    : '`Немає активних посад персоналу`';

  // Compute staff roles that the executor is allowed to grant to this target
  const executorLevel = executorMember ? getMemberStaffLevel(executorMember) : 0;
  const grantableRoles = executorMember ? getGrantableStaffRoles(guild, executorMember, targetMember) : [];

  let grantableRolesSection = '';
  if (executorMember && executorLevel >= 2) {
    const executorLevelName = getStaffLevelTitle(executorLevel);
    if (grantableRoles.length > 0) {
      const roleList = grantableRoles.map(r => {
        const lvl = getRoleStaffLevel(r);
        return `• <@&${r.id}> (\`${r.name}\` — ранг: ${getStaffLevelTitle(lvl)})`;
      }).join('\n');
      grantableRolesSection = `\n\n🎁 **Посади, які ви можете видати (<@${executorMember.id}> — ${executorLevelName}):**\n${roleList}`;
    } else {
      grantableRolesSection = `\n\n🎁 **Посади, які ви можете видати (<@${executorMember.id}> — ${executorLevelName}):**\n• \`Немає доступних посад для видачі (або учасник вже має всі можливі посади вашого рівня)\``;
    }
  }

  const embed = new EmbedBuilder()
    .setTitle('👑 Управління персоналом')
    .setColor('#2B2D31')
    .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setDescription(
      `**Учасник:** <@${user.id}> (\`${user.username}\`)\n` +
      `**ID:** \`${user.id}\`\n` +
      `**Вища роль:** <@&${targetMember.roles.highest.id}>\n\n` +
      `📋 **Посади та ролі персоналу:**\n${staffRolesSection}` +
      grantableRolesSection + `\n\n` +
      `**Попередження:** \`${preds}\` | **Варни:** \`${warns}\` | **ЧС:** \`${isBL ? '⚠️ В ЧС' : 'Ні'}\``
    )
    .setFooter({ text: 'Система управління персоналом • LUVEX Staff' });

  // Row 1: Выдать пред, Выдать варн, Выдать мут, Кикнуть, Выдать бан
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`stf:pred:add:${targetId}`)
      .setLabel('Выдать пред')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`stf:warn:add:${targetId}`)
      .setLabel('Выдать варн')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`stf:mute:add:${targetId}`)
      .setLabel('Выдать мут')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`stf:kick:${targetId}`)
      .setLabel('Кикнуть')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`stf:ban:add:${targetId}`)
      .setLabel('Выдать бан')
      .setStyle(ButtonStyle.Danger)
  );

  // Row 2: Черный список, Снять ЧС, Снять пред, Снять варн, Снять мут
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`stf:bl:add:${targetId}`)
      .setLabel('В Черный Список')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`stf:bl:rem:${targetId}`)
      .setLabel('Снять ЧС')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`stf:pred:rem:${targetId}`)
      .setLabel('Снять пред')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`stf:warn:rem:${targetId}`)
      .setLabel('Снять варн')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`stf:mute:rem:${targetId}`)
      .setLabel('Снять мут')
      .setStyle(ButtonStyle.Secondary)
  );

  // Row 3: Снять все роли стаффа, Снять бан, Отмена
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`stf:roles:strip:${targetId}`)
      .setLabel('Снять роли стаффа')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`stf:ban:rem:${targetId}`)
      .setLabel('Снять бан')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`stf:cancel:${targetId}`)
      .setLabel('Отмена')
      .setStyle(ButtonStyle.Danger)
  );

  const components = [row1, row2, row3];

  // Row 4: Select Menu for granting specific roles (if executor has grantable roles)
  if (grantableRoles.length > 0) {
    const grantOptions = grantableRoles.slice(0, 25).map(r => ({
      label: `Видати: ${r.name}`.slice(0, 100),
      value: r.id,
      description: `Рівень: ${getStaffLevelTitle(getRoleStaffLevel(r))}`.slice(0, 100),
      emoji: '➕'
    }));

    const addSelect = new StringSelectMenuBuilder()
      .setCustomId(`stf:roles:add:${targetId}`)
      .setPlaceholder('➕ Оберіть посаду для видачі...')
      .addOptions(grantOptions);

    components.push(new ActionRowBuilder().addComponents(addSelect));
  }

  // Row 5: Select Menu for removing specific roles
  // Allows Master and higher to remove any staff role or manageable role below bot
  const botHighest = guild.members.me.roles.highest.position;
  const otherRemovable = targetMember.roles.cache.filter(r =>
    r.id !== guild.id &&
    !r.managed &&
    r.position < botHighest &&
    !targetStaffRoles.has(r.id)
  );

  for (const [, r] of otherRemovable) {
    if (roleSelectOptions.length >= 25) break;
    roleSelectOptions.push({
      label: `Зняти роль: ${r.name}`.slice(0, 100),
      value: r.id,
      description: `ID: ${r.id}`.slice(0, 100),
      emoji: '🏷️'
    });
  }

  if (roleSelectOptions.length > 0) {
    const roleSelect = new StringSelectMenuBuilder()
      .setCustomId(`stf:roles:remove:${targetId}`)
      .setPlaceholder('🗑️ Оберіть посаду або роль для зняття...')
      .addOptions(roleSelectOptions.slice(0, 25));

    components.push(new ActionRowBuilder().addComponents(roleSelect));
  }

  return {
    embeds: [embed],
    components
  };
}

module.exports = {
  createActionPanel,
  createStaffManagePanel,
  formatDate
};
