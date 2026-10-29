const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
const dbFile = path.join(dataDir, 'database.json');

// Ensure data folder and file exist
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db = {
  warns: {},      // guildId -> { userId: [ { id, type: 'warn'|'pred', reason, moderatorId, createdAt } ] }
  staffStats: {}, // guildId -> { moderatorId: { moderator: 0, support: 0, closer: 0, creative: 0, lastReset: timestamp } }
  blacklist: {},  // guildId -> { userId: { reason, moderatorId, previousRoles, createdAt } }
  appeals: {},    // guildId -> { userId: { status, reason, promise, createdAt, resolvedBy, resolvedAt, rejectReason } }
  reports: {},    // guildId -> { [reportId]: { id, authorId, targetId, reason, proof, status, claimedBy, createdAt } }
  voiceCalls: {}, // guildId -> { [callId]: { id, voiceChannelId, voiceChannelName, authorId, participants, reason, details, status, claimedBy, createdAt } }
  roleHistory: {}, // guildId -> { [userId]: { [roleId]: { executorId, executorTag, timestamp, createdAt } } }
  punishmentHistory: {}, // guildId -> { [userId]: [ { id, type, reason, moderatorId, moderatorTag, durationStr, extraInfo, createdAt } ] }
  keyRequests: {}, // guildId -> { [requestId]: { id, userId, userTag, keyType, roleId, reason, contacts, status, resolvedBy, resolvedAt, rejectReason, createdAt } }
  keyHolders: {}   // guildId -> { [userId]: { [keyType]: { userId, keyType, roleId, grantedBy, grantedAt, warns: [] } } }
};

if (fs.existsSync(dbFile)) {
  try {
    const raw = fs.readFileSync(dbFile, 'utf8');
    db = JSON.parse(raw);
    if (!db.warns) db.warns = {};
    if (!db.staffStats) db.staffStats = {};
    if (!db.blacklist) db.blacklist = {};
    if (!db.appeals) db.appeals = {};
    if (!db.reports) db.reports = {};
    if (!db.voiceCalls) db.voiceCalls = {};
    if (!db.roleHistory) db.roleHistory = {};
    if (!db.punishmentHistory) db.punishmentHistory = {};
    if (!db.keyRequests) db.keyRequests = {};
    if (!db.keyHolders) db.keyHolders = {};
  } catch (err) {
    console.error('Error reading database file:', err);
  }
}

function saveDB() {
  try {
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving database file:', err);
  }
}

module.exports = {
  // Add Warning or Pre-warn
  addInfraction(guildId, userId, moderatorId, reason, type = 'warn', moderatorTag = null) {
    if (!db.warns[guildId]) db.warns[guildId] = {};
    if (!db.warns[guildId][userId]) db.warns[guildId][userId] = [];

    const record = {
      id: Date.now().toString(),
      type, // 'warn' or 'pred'
      reason,
      moderatorId,
      moderatorTag: moderatorTag || null,
      createdAt: new Date().toISOString()
    };

    db.warns[guildId][userId].push(record);
    this.addPunishmentRecord(guildId, userId, { type, reason, moderatorId, moderatorTag });
    saveDB();
    return record;
  },

  // Remove latest infraction by type ('warn' or 'pred')
  removeInfraction(guildId, userId, type = 'warn') {
    if (!db.warns[guildId] || !db.warns[guildId][userId]) {
      return null;
    }

    const list = db.warns[guildId][userId];
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].type === type) {
        const removed = list.splice(i, 1)[0];
        saveDB();
        return removed;
      }
    }
    return null;
  },

  // Get infraction count
  getInfractionsCount(guildId, userId, type = 'warn') {
    if (!db.warns[guildId] || !db.warns[guildId][userId]) {
      return 0;
    }
    return db.warns[guildId][userId].filter(item => item.type === type).length;
  },

  // Get user infractions list
  getUserInfractions(guildId, userId) {
    return (db.warns[guildId] && db.warns[guildId][userId]) || [];
  },

  // Staff Stats tracking
  addStaffAction(guildId, moderatorId, actionType = 'moderator') {
    if (!db.staffStats[guildId]) db.staffStats[guildId] = {};
    if (!db.staffStats[guildId][moderatorId]) {
      db.staffStats[guildId][moderatorId] = {
        moderator: 0,
        support: 0,
        closer: 0,
        creative: 0,
        lastReset: Date.now()
      };
    }

    const stats = db.staffStats[guildId][moderatorId];
    if (stats[actionType] !== undefined) {
      stats[actionType] += 1;
    } else {
      stats[actionType] = 1;
    }
    saveDB();
    return stats;
  },

  // Get staff stats
  getStaffStats(guildId, moderatorId) {
    if (!db.staffStats[guildId] || !db.staffStats[guildId][moderatorId]) {
      return {
        moderator: 0,
        support: 0,
        closer: 0,
        creative: 0,
        lastReset: Date.now()
      };
    }
    return db.staffStats[guildId][moderatorId];
  },

  // Blacklist Management
  addBlacklist(guildId, userId, moderatorId, reason, previousRoles = [], durationStr = 'Назавжди', expiresAt = null, moderatorTag = null) {
    if (!db.blacklist[guildId]) db.blacklist[guildId] = {};
    const record = {
      userId,
      moderatorId,
      moderatorTag: moderatorTag || null,
      reason,
      previousRoles,
      durationStr: durationStr || 'Назавжди',
      expiresAt: expiresAt || null,
      history: [
        {
          action: 'add',
          moderatorId,
          moderatorTag: moderatorTag || null,
          createdAt: new Date().toISOString(),
          reason,
          durationStr: durationStr || 'Назавжди',
          expiresAt: expiresAt || null
        }
      ],
      createdAt: new Date().toISOString()
    };
    db.blacklist[guildId][userId] = record;
    this.addPunishmentRecord(guildId, userId, {
      type: 'blacklist',
      reason,
      moderatorId,
      moderatorTag,
      durationStr
    });
    saveDB();
    return record;
  },

  updateBlacklistDuration(guildId, userId, moderatorId, extraMs, newDurationStr, newExpiresAt, moderatorTag = null, reason = '') {
    if (!db.blacklist[guildId] || !db.blacklist[guildId][userId]) return null;
    const record = db.blacklist[guildId][userId];
    record.durationStr = newDurationStr;
    record.expiresAt = newExpiresAt;
    if (!Array.isArray(record.history)) {
      record.history = [
        {
          action: 'add',
          moderatorId: record.moderatorId,
          moderatorTag: record.moderatorTag || null,
          createdAt: record.createdAt,
          reason: record.reason,
          durationStr: record.durationStr || 'Назавжди',
          expiresAt: record.expiresAt || null
        }
      ];
    }
    record.history.push({
      action: extraMs ? 'extend' : 'set_duration',
      moderatorId,
      moderatorTag: moderatorTag || null,
      createdAt: new Date().toISOString(),
      extraMs: extraMs || null,
      newDurationStr,
      newExpiresAt,
      reason: reason || null
    });

    this.addPunishmentRecord(guildId, userId, {
      type: extraMs ? 'bl_extend' : 'bl_duration',
      reason: reason || (extraMs ? `Збільшення терміну на +${newDurationStr}` : `Встановлено термін: ${newDurationStr}`),
      moderatorId,
      moderatorTag,
      durationStr: newDurationStr
    });

    saveDB();
    return record;
  },

  getAllBlacklisted(guildId) {
    if (!db.blacklist[guildId]) return [];
    return Object.entries(db.blacklist[guildId]).map(([userId, data]) => ({
      userId,
      ...data
    }));
  },

  removeBlacklist(guildId, userId) {
    if (!db.blacklist[guildId] || !db.blacklist[guildId][userId]) {
      return null;
    }
    const record = db.blacklist[guildId][userId];
    delete db.blacklist[guildId][userId];
    this.addPunishmentRecord(guildId, userId, {
      type: 'bl_remove',
      reason: 'Зняття з Чорного Списку сервера',
      moderatorId: record.moderatorId,
      moderatorTag: record.moderatorTag
    });
    saveDB();
    return record;
  },

  isBlacklisted(guildId, userId) {
    return !!(db.blacklist[guildId] && db.blacklist[guildId][userId]);
  },

  getBlacklistRecord(guildId, userId) {
    return (db.blacklist[guildId] && db.blacklist[guildId][userId]) || null;
  },

  // Permanent Punishment History Management
  addPunishmentRecord(guildId, userId, { type, reason, moderatorId, moderatorTag = null, durationStr = null, extraInfo = null }) {
    if (!db.punishmentHistory) db.punishmentHistory = {};
    if (!db.punishmentHistory[guildId]) db.punishmentHistory[guildId] = {};
    if (!db.punishmentHistory[guildId][userId]) db.punishmentHistory[guildId][userId] = [];

    const record = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
      type, // 'blacklist', 'warn', 'pred', 'bl_extend', 'bl_duration', 'bl_remove', 'kick', 'mute'
      reason: reason || 'Не вказано',
      moderatorId,
      moderatorTag: moderatorTag || null,
      durationStr: durationStr || null,
      extraInfo: extraInfo || null,
      createdAt: new Date().toISOString()
    };

    db.punishmentHistory[guildId][userId].push(record);
    saveDB();
    return record;
  },

  // Aggregated punishment history of a user (punishmentHistory + warns + current blacklist)
  getUserPunishmentHistory(guildId, userId) {
    if (!db.punishmentHistory) db.punishmentHistory = {};
    const recorded = (db.punishmentHistory[guildId] && db.punishmentHistory[guildId][userId]) || [];

    const warnRecords = (db.warns && db.warns[guildId] && db.warns[guildId][userId]) || [];
    const blRecord = (db.blacklist && db.blacklist[guildId] && db.blacklist[guildId][userId]) || null;

    const all = [...recorded];

    // Merge previous/existing warns and preds
    for (const w of warnRecords) {
      const exists = all.some(r => r.type === w.type && (r.id === w.id || r.createdAt === w.createdAt));
      if (!exists) {
        all.push({
          id: w.id || Date.now().toString(),
          type: w.type, // 'warn' or 'pred'
          reason: w.reason || 'Не вказано',
          moderatorId: w.moderatorId,
          moderatorTag: null,
          createdAt: w.createdAt
        });
      }
    }

    // Merge current blacklist record if any
    if (blRecord) {
      const blHistory = Array.isArray(blRecord.history) && blRecord.history.length > 0
        ? blRecord.history
        : [
            {
              action: 'add',
              moderatorId: blRecord.moderatorId,
              moderatorTag: blRecord.moderatorTag,
              createdAt: blRecord.createdAt,
              reason: blRecord.reason,
              durationStr: blRecord.durationStr
            }
          ];

      for (const bh of blHistory) {
        let type = 'blacklist';
        if (bh.action === 'extend') type = 'bl_extend';
        else if (bh.action === 'set_duration') type = 'bl_duration';

        const exists = all.some(r => r.type === type && r.createdAt === bh.createdAt);
        if (!exists) {
          all.push({
            id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
            type,
            reason: bh.reason || blRecord.reason || 'Не вказано',
            moderatorId: bh.moderatorId,
            moderatorTag: bh.moderatorTag || blRecord.moderatorTag,
            durationStr: bh.durationStr || bh.newDurationStr || blRecord.durationStr,
            createdAt: bh.createdAt
          });
        }
      }
    }

    // Sort chronologically (newest first)
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return all;
  },

  // Appeals Management
  createAppeal(guildId, userId, data, extra = '') {
    if (!db.appeals[guildId]) db.appeals[guildId] = {};
    const appealData = (typeof data === 'object' && data !== null) ? data : { reason: data, promise: extra };
    const appeal = {
      userId,
      status: 'pending',
      ...appealData,
      createdAt: new Date().toISOString()
    };
    db.appeals[guildId][userId] = appeal;
    saveDB();
    return appeal;
  },

  hasPendingAppeal(guildId, userId) {
    return !!(db.appeals[guildId] && db.appeals[guildId][userId] && ['pending', 'in_progress'].includes(db.appeals[guildId][userId].status));
  },

  claimAppeal(guildId, userId, moderatorId) {
    if (!db.appeals[guildId] || !db.appeals[guildId][userId]) return null;
    const appeal = db.appeals[guildId][userId];
    appeal.status = 'in_progress';
    appeal.claimedBy = moderatorId;
    appeal.claimedAt = new Date().toISOString();
    saveDB();
    return appeal;
  },

  unclaimAppeal(guildId, userId) {
    if (!db.appeals[guildId] || !db.appeals[guildId][userId]) return null;
    const appeal = db.appeals[guildId][userId];
    appeal.status = 'pending';
    appeal.claimedBy = null;
    appeal.claimedAt = null;
    saveDB();
    return appeal;
  },

  getAppeal(guildId, userId) {
    return (db.appeals[guildId] && db.appeals[guildId][userId]) || null;
  },

  resolveAppeal(guildId, userId, status, moderatorId, rejectReason = null) {
    if (!db.appeals[guildId] || !db.appeals[guildId][userId]) return null;
    const appeal = db.appeals[guildId][userId];
    appeal.status = status;
    appeal.resolvedBy = moderatorId;
    appeal.resolvedAt = new Date().toISOString();
    if (rejectReason) {
      appeal.rejectReason = rejectReason;
    }
    saveDB();
    return appeal;
  },

  // Reports Management
  addReport(guildId, reportData) {
    if (!db.reports[guildId]) db.reports[guildId] = {};
    const reportId = Date.now().toString();
    const report = {
      id: reportId,
      ...reportData,
      status: 'pending', // 'pending', 'in_progress', 'resolved', 'rejected'
      createdAt: new Date().toISOString()
    };
    db.reports[guildId][reportId] = report;
    saveDB();
    return report;
  },

  getReport(guildId, reportId) {
    return (db.reports[guildId] && db.reports[guildId][reportId]) || null;
  },

  updateReport(guildId, reportId, data) {
    if (!db.reports[guildId] || !db.reports[guildId][reportId]) return null;
    db.reports[guildId][reportId] = {
      ...db.reports[guildId][reportId],
      ...data,
      updatedAt: new Date().toISOString()
    };
    saveDB();
    return db.reports[guildId][reportId];
  },

  // Voice Calls Management
  addVoiceCall(guildId, callData) {
    if (!db.voiceCalls[guildId]) db.voiceCalls[guildId] = {};
    const callId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const call = {
      id: callId,
      ...callData,
      status: 'pending', // 'pending', 'in_progress', 'resolved'
      createdAt: new Date().toISOString()
    };
    db.voiceCalls[guildId][callId] = call;
    saveDB();
    return call;
  },

  getVoiceCall(guildId, callId) {
    return (db.voiceCalls[guildId] && db.voiceCalls[guildId][callId]) || null;
  },

  getActiveVoiceCallForChannel(guildId, channelId) {
    if (!db.voiceCalls[guildId]) return null;
    return Object.values(db.voiceCalls[guildId]).find(
      c => c.voiceChannelId === channelId && (c.status === 'pending' || c.status === 'in_progress')
    ) || null;
  },

  updateVoiceCall(guildId, callId, data) {
    if (!db.voiceCalls[guildId] || !db.voiceCalls[guildId][callId]) return null;
    db.voiceCalls[guildId][callId] = {
      ...db.voiceCalls[guildId][callId],
      ...data,
      updatedAt: new Date().toISOString()
    };
    saveDB();
    return db.voiceCalls[guildId][callId];
  },

  // Role History Management
  saveRoleGrant(guildId, userId, roleId, info) {
    if (!db.roleHistory[guildId]) db.roleHistory[guildId] = {};
    if (!db.roleHistory[guildId][userId]) db.roleHistory[guildId][userId] = {};
    db.roleHistory[guildId][userId][roleId] = {
      ...info,
      updatedAt: new Date().toISOString()
    };
    saveDB();
    return db.roleHistory[guildId][userId][roleId];
  },

  getRoleGrant(guildId, userId, roleId) {
    return (db.roleHistory[guildId] && db.roleHistory[guildId][userId] && db.roleHistory[guildId][userId][roleId]) || null;
  },

  // ==========================
  // KEY SHOP MANAGEMENT
  // ==========================

  createKeyRequest(guildId, userId, userTag, keyType, roleId, reason, contacts = null) {
    if (!db.keyRequests[guildId]) db.keyRequests[guildId] = {};
    const id = Date.now().toString() + Math.random().toString(36).substring(2, 5);
    const req = {
      id,
      userId,
      userTag,
      keyType,
      roleId,
      reason,
      contacts: contacts || null,
      status: 'pending', // 'pending', 'approved', 'rejected'
      resolvedBy: null,
      resolvedAt: null,
      rejectReason: null,
      createdAt: new Date().toISOString()
    };
    db.keyRequests[guildId][id] = req;
    saveDB();
    return req;
  },

  getKeyRequest(guildId, requestId) {
    return (db.keyRequests[guildId] && db.keyRequests[guildId][requestId]) || null;
  },

  hasPendingKeyRequest(guildId, userId, keyType) {
    if (!db.keyRequests[guildId]) return false;
    return Object.values(db.keyRequests[guildId]).some(
      r => r.userId === userId && r.keyType === keyType && r.status === 'pending'
    );
  },

  resolveKeyRequest(guildId, requestId, status, resolvedBy, rejectReason = null) {
    if (!db.keyRequests[guildId] || !db.keyRequests[guildId][requestId]) return null;
    const req = db.keyRequests[guildId][requestId];
    req.status = status;
    req.resolvedBy = resolvedBy;
    req.resolvedAt = new Date().toISOString();
    if (rejectReason) req.rejectReason = rejectReason;
    saveDB();
    return req;
  },

  grantKey(guildId, userId, keyType, roleId, grantedBy) {
    if (!db.keyHolders[guildId]) db.keyHolders[guildId] = {};
    if (!db.keyHolders[guildId][userId]) db.keyHolders[guildId][userId] = {};
    const holder = {
      userId,
      keyType,
      roleId,
      grantedBy,
      grantedAt: new Date().toISOString(),
      warns: []
    };
    db.keyHolders[guildId][userId][keyType] = holder;
    saveDB();
    return holder;
  },

  revokeKey(guildId, userId, keyType) {
    if (!db.keyHolders[guildId] || !db.keyHolders[guildId][userId]) return null;
    const removed = db.keyHolders[guildId][userId][keyType];
    delete db.keyHolders[guildId][userId][keyType];
    saveDB();
    return removed;
  },

  getKeyHolder(guildId, userId, keyType) {
    return (db.keyHolders[guildId] && db.keyHolders[guildId][userId] && db.keyHolders[guildId][userId][keyType]) || null;
  },

  getAllKeyHolders(guildId) {
    if (!db.keyHolders[guildId]) return [];
    const list = [];
    for (const [userId, keys] of Object.entries(db.keyHolders[guildId])) {
      for (const [keyType, data] of Object.entries(keys)) {
        list.push({ userId, keyType, ...data });
      }
    }
    return list;
  },

  addKeyWarn(guildId, userId, keyType, moderatorId, reason) {
    if (!db.keyHolders[guildId]) db.keyHolders[guildId] = {};
    if (!db.keyHolders[guildId][userId]) db.keyHolders[guildId][userId] = {};
    if (!db.keyHolders[guildId][userId][keyType]) {
      db.keyHolders[guildId][userId][keyType] = {
        userId,
        keyType,
        grantedBy: moderatorId,
        grantedAt: new Date().toISOString(),
        warns: []
      };
    }
    const holder = db.keyHolders[guildId][userId][keyType];
    if (!Array.isArray(holder.warns)) holder.warns = [];
    const warnObj = {
      id: Date.now().toString(),
      moderatorId,
      reason: reason || 'Порушення правил ключа',
      createdAt: new Date().toISOString()
    };
    holder.warns.push(warnObj);
    saveDB();
    return { holder, warnCount: holder.warns.length, warnObj };
  },

  removeKeyWarn(guildId, userId, keyType) {
    if (!db.keyHolders[guildId] || !db.keyHolders[guildId][userId] || !db.keyHolders[guildId][userId][keyType]) {
      return null;
    }
    const holder = db.keyHolders[guildId][userId][keyType];
    if (!Array.isArray(holder.warns) || holder.warns.length === 0) return null;
    const removed = holder.warns.pop();
    saveDB();
    return { holder, remaining: holder.warns.length, removed };
  }
};
