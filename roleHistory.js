const { AuditLogEvent } = require('discord.js');
const db = require('./database');
const config = require('./config');

/**
 * Format timestamp or ISO string to Ukrainian format:
 * e.g. "15.10.2026 о 11:30:22"
 */
function formatUkrainianDateTime(dateInput) {
  if (!dateInput) return 'Невідомо (давній запис)';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return 'Невідомо (давній запис)';

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  const secs = String(d.getSeconds()).padStart(2, '0');

  return `${day}.${month}.${year} о ${hours}:${mins}:${secs}`;
}

/**
 * Get Staff Level for a specific role:
 * Level 5: Team Lead
 * Level 4: Administrator
 * Level 3: Curator / Lame
 * Level 2: Master
 * Level 1: Junior Staff (moder, support, closer, creative, etc.)
 * Level 0: Non-staff
 */
function getRoleStaffLevel(role) {
  if (!role) return 0;
  const id = role.id;
  const name = role.name.toLowerCase();

  // Level 5: Team Lead
  if (id === config.roles.teamLead || name.includes('team leed') || name.includes('team lead') || name.includes('тімлід')) {
    return 5;
  }

  // Level 4: Administrator
  if (id === config.roles.admin || name.includes('administrator') || name.includes('admin') || name.includes('адміністратор') || name.includes('админ')) {
    return 4;
  }

  // Level 3: Curator / Lame
  if (id === config.roles.curator || id === '1558593166938996850' || name.includes('curator') || name.includes('куратор') || name.includes('lame')) {
    return 3;
  }

  // Level 2: Master
  if (id === config.roles.master || name.includes('master') || name.includes('мастер')) {
    return 2;
  }

  // Level 1: Junior Staff
  if (
    id === config.roles.moder ||
    id === config.roles.support ||
    id === config.roles.closeMode ||
    id === config.roles.creative ||
    (config.roles.staffRoles || []).includes(id) ||
    name.includes('moder') || name.includes('модер') ||
    name.includes('support') || name.includes('suport') ||
    name.includes('closer') || name.includes('closemode') ||
    name.includes('creative') || name.includes('content') ||
    name.includes('evente') || name.includes('tribune') ||
    name.includes('steamer') || name.includes('backsist')
  ) {
    return 1;
  }

  return 0;
}

/**
 * Get overall staff level of a member:
 * Owner: 6
 * Team Lead: 5
 * Administrator: 4
 * Curator: 3
 * Master: 2
 * Junior Staff: 1
 * Member: 0
 */
function getMemberStaffLevel(member) {
  if (!member) return 0;
  const guild = member.guild;
  if (member.id === guild.ownerId) return 6;

  let highestLevel = 0;
  for (const [, r] of member.roles.cache) {
    const lvl = getRoleStaffLevel(r);
    if (lvl > highestLevel) highestLevel = lvl;
  }

  if (highestLevel < 4 && member.permissions.has(8n)) {
    highestLevel = 4;
  }

  return highestLevel;
}

/**
 * Alias for backward compatibility
 */
function getStaffTier(member) {
  return getMemberStaffLevel(member);
}

/**
 * Get human-readable level title
 */
function getStaffLevelTitle(level) {
  switch (level) {
    case 5: return 'Team Lead';
    case 4: return 'Administrator';
    case 3: return 'Curator';
    case 2: return 'Master';
    case 1: return 'Модерація / Персонал';
    default: return 'Учасник';
  }
}

/**
 * Get all roles that the executor is allowed to grant to the target
 */
function getGrantableStaffRoles(guild, executorMember, targetMember) {
  const executorLevel = getMemberStaffLevel(executorMember);
  if (executorLevel < 2) return []; // Master (2) or higher required

  const botHighest = guild.members.me.roles.highest.position;

  const grantable = guild.roles.cache.filter(role => {
    if (role.id === guild.id) return false;
    if (role.managed) return false;
    if (role.position >= botHighest) return false;

    // Check if target already has this role
    if (targetMember && targetMember.roles.cache.has(role.id)) return false;

    const roleLevel = getRoleStaffLevel(role);
    // Role must be a recognized staff role and strictly lower rank than the executor
    return roleLevel > 0 && roleLevel < executorLevel;
  });

  return Array.from(grantable.values()).sort((a, b) => {
    const lvlA = getRoleStaffLevel(a);
    const lvlB = getRoleStaffLevel(b);
    if (lvlB !== lvlA) return lvlB - lvlA;
    return b.position - a.position;
  });
}

/**
 * Fetch who gave a specific role to a user and when
 */
async function getRoleGrantInfo(guild, targetUserId, roleId) {
  // 1. Check local DB cache
  const cached = db.getRoleGrant(guild.id, targetUserId, roleId);
  if (cached && cached.executorTag) {
    return cached;
  }

  // 2. Query Discord Audit Logs
  try {
    const logs = await guild.fetchAuditLogs({
      type: AuditLogEvent.MemberRoleUpdate,
      limit: 100
    }).catch(() => null);

    if (logs) {
      for (const [, entry] of logs.entries) {
        if (entry.targetId === targetUserId) {
          const addChange = entry.changes?.find(c => c.key === '$add');
          if (addChange && Array.isArray(addChange.new)) {
            if (addChange.new.some(r => r.id === roleId)) {
              const info = {
                executorId: entry.executor ? entry.executor.id : null,
                executorTag: entry.executor ? (entry.executor.tag || entry.executor.username) : 'Невідомо',
                timestamp: entry.createdTimestamp,
                createdAt: entry.createdAt ? entry.createdAt.toISOString() : new Date().toISOString()
              };
              db.saveRoleGrant(guild.id, targetUserId, roleId, info);
              return info;
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('Audit fetch error in getRoleGrantInfo:', err.message);
  }

  return {
    executorId: null,
    executorTag: 'Невідомо (давній запис)',
    timestamp: null,
    createdAt: null
  };
}

/**
 * Listen to role changes and automatically record who added the role
 */
async function trackMemberRoleUpdate(oldMember, newMember) {
  try {
    const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    if (addedRoles.size === 0) return;

    // Small delay to allow Discord to write the audit log entry
    await new Promise(r => setTimeout(r, 1200));

    const guild = newMember.guild;
    const logs = await guild.fetchAuditLogs({
      type: AuditLogEvent.MemberRoleUpdate,
      limit: 5
    }).catch(() => null);

    if (!logs) return;

    for (const [roleId, role] of addedRoles) {
      for (const [, entry] of logs.entries) {
        if (entry.targetId === newMember.id) {
          const addChange = entry.changes?.find(c => c.key === '$add');
          if (addChange && Array.isArray(addChange.new) && addChange.new.some(r => r.id === roleId)) {
            const info = {
              executorId: entry.executor ? entry.executor.id : null,
              executorTag: entry.executor ? (entry.executor.tag || entry.executor.username) : 'Невідомо',
              timestamp: entry.createdTimestamp,
              createdAt: entry.createdAt.toISOString()
            };
            db.saveRoleGrant(guild.id, newMember.id, roleId, info);
            console.log(`[RoleAudit] Збережено видачу ролі ${role.name} для ${newMember.user.tag} від ${info.executorTag}`);
            break;
          }
        }
      }
    }
  } catch (err) {
    console.error('Error tracking role update:', err);
  }
}

module.exports = {
  formatUkrainianDateTime,
  getRoleStaffLevel,
  getMemberStaffLevel,
  getStaffTier,
  getStaffLevelTitle,
  getGrantableStaffRoles,
  getRoleGrantInfo,
  trackMemberRoleUpdate
};
