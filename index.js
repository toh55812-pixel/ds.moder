require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes
} = require('discord.js');
const config = require('./config');
const { commands, handleChatInputCommand, handleUserSelect } = require('./commands');
const { handleButton, handleModal, handleStringSelect, canManageStaff } = require('./handlers');
const { setupBlacklistPermissions, handleAppealButton, handleAppealModal } = require('./appeal');
const { handleReportButton, handleReportModal } = require('./report');
const {
  setupVoicePermissions,
  deployVoiceSummonPanels,
  handleVoiceButton,
  handleVoiceSelect,
  handleVoiceModal
} = require('./voiceModeration');
const { trackMemberRoleUpdate } = require('./roleHistory');
const {
  handleBlacklistButton,
  handleBlacklistSelect,
  handleBlacklistModal,
  startBlacklistExpirationChecker
} = require('./blacklist');
const {
  handleKeyButton,
  handleKeyModal,
  deployKeyShopPanel,
  setupKeyRequestsChannelPermissions
} = require('./keyShop');

if (!config.token) {
  console.error('❌ ОШИБКА: Токен бота не указан в .env файле!');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// Register slash commands
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.token);
  const commandData = commands.map(cmd => cmd.toJSON());

  try {
    console.log('🔄 Регистрация слэш-команд (/acation, /staff, /appeal)...');

    // Register immediately for the guild for instantaneous availability
    if (config.guildId) {
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.guildId),
        { body: commandData }
      );
      console.log(`✅ Слэш-команды успешно зарегистрированы для сервера ID: ${config.guildId}!`);
    }

    // Ensure global commands are empty to prevent duplicate entries in Discord
    await rest.put(
      Routes.applicationCommands(config.clientId),
      { body: [] }
    );
    console.log('✅ Глобальные команды очищены (без дубликатов)!');
  } catch (error) {
    console.error('❌ Ошибка при регистрации команд:', error);
  }
}

// Bot ready event
client.once('clientReady', async (readyClient) => {
  console.log(`===========================================`);
  console.log(`🤖 Бот успешно запущен как: ${readyClient.user.tag}`);
  console.log(`🆔 ID Бота: ${readyClient.user.id}`);
  console.log(`===========================================`);

  await registerCommands();

  // Configure blacklist permissions, voice chat restrictions, and deploy panels
  if (config.guildId) {
    const guild = readyClient.guilds.cache.get(config.guildId);
    if (guild) {
      await setupBlacklistPermissions(guild);
      await setupVoicePermissions(guild);
      await setupKeyRequestsChannelPermissions(guild);
      await deployKeyShopPanel(guild);
      await deployVoiceSummonPanels(guild);
    }
  }

  // Start automated blacklist expiration checker
  startBlacklistExpirationChecker(readyClient);
});

// Automatic Role Grant History Tracking
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  await trackMemberRoleUpdate(oldMember, newMember);
});

// Interaction handler
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleChatInputCommand(interaction);
    } else if (interaction.isButton()) {
      if (interaction.customId.startsWith('key:')) {
        await handleKeyButton(interaction);
      } else if (interaction.customId.startsWith('appeal:')) {
        await handleAppealButton(interaction, canManageStaff);
      } else if (interaction.customId.startsWith('bl:')) {
        await handleBlacklistButton(interaction, canManageStaff);
      } else if (interaction.customId.startsWith('rep:')) {
        await handleReportButton(interaction);
      } else if (interaction.customId.startsWith('voice:')) {
        await handleVoiceButton(interaction);
      } else {
        await handleButton(interaction);
      }
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('modal:key:')) {
        await handleKeyModal(interaction);
      } else if (interaction.customId.startsWith('modal:appeal:')) {
        await handleAppealModal(interaction);
      } else if (interaction.customId.startsWith('modal:bl:')) {
        await handleBlacklistModal(interaction, canManageStaff);
      } else if (interaction.customId.startsWith('modal:rep:')) {
        await handleReportModal(interaction);
      } else if (interaction.customId.startsWith('modal:voice:')) {
        await handleVoiceModal(interaction);
      } else {
        await handleModal(interaction);
      }
    } else if (interaction.isUserSelectMenu()) {
      if (interaction.customId.startsWith('voice:')) {
        await handleVoiceSelect(interaction);
      } else {
        await handleUserSelect(interaction);
      }
    } else if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith('voice:')) {
        await handleVoiceSelect(interaction);
      } else if (interaction.customId.startsWith('bl:')) {
        await handleBlacklistSelect(interaction, canManageStaff);
      } else {
        await handleStringSelect(interaction);
      }
    }
  } catch (error) {
    console.error('❌ Ошибка при обработке взаимодействия:', error);

    const errorMessage = 'Произошла непредвиденная ошибка при выполнении действия!';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: `❌ ${errorMessage}`, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: `❌ ${errorMessage}`, ephemeral: true }).catch(() => {});
    }
  }
});

// Process error listeners to prevent crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception:', err);
});

client.login(config.token);
