require('dotenv').config();

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID || '1559624585148891217',
  guildId: process.env.GUILD_ID || '1349497010251632660',

  // Pre-configured role IDs for guild 1349497010251632660
  roles: {
    genderBoy: '1558131283844923472',      // 🩵
    genderGirl: '1558132089658802257',     // 🩷
    unverified: '1558161233218379968',     // unvefiry
    creative: '1558593881451397171',       // Creative
    mutedChat: '1559293276261982247',      // mutedchat
    mutedVoice: '1559293309372080209',     // mutedvoice
    staffModer: '1559623655497924770',     // staffmoder
    moder: '1558593441359859802',          // moder
    support: '1558593637632184320',        // Suport
    closeMode: '1558593720608362516',      // CloseMode
    teamLead: '1558592734816772096',       // Team leed
    curator: '1558593274883874897',        // Curator
    admin: '1558592841041838232',          // Administrator
    master: '1558593550176755743',         // Master
    lame: '1558593166938996850',           // Lame
    ownerRole: '1559634990009024532',      // Owner
    keyRole: '1558596783314182164',        // 🔑
    blacklist: '1559823821777801257',      // Черный Список
    staffRoles: [
      '1558593550176755743', // Master
      '1558593441359859802', // moder
      '1559625001403940878', // moder
      '1559623655497924770', // staffmoder
      '1558593637632184320', // Suport
      '1558593720608362516', // CloseMode
      '1558593786513330196', // Content Maker
      '1558593881451397171', // Creative
      '1558593959964446772', // Evente
      '1558594030932197408', // Tribune mod
      '1558592581770805350', // Steamer
      '1558592734816772096', // Team leed
      '1558593274883874897', // Curator
      '1558593166938996850', // Lame
      '1558592841041838232', // Administrator
      '1559293186424311930'  // backsist
    ]
  },

  // Categories
  categories: {
    moderZone: '1349499821136019658',     // Модер-зона 1
    privateRooms: '1559874543047413761',  // 🔊 │ ПРИВАТНІ КІМНАТИ
    prokhodka: '1558605122244837386'      // <Проходка>
  },

  // Channels
  channels: {
    appeal: '1559824304772743230',        // апиляцію
    log: '1559820960515883079',           // log1
    korzina: '1558604530172821544',       // 🗑️корзина (жалобы / репорты)
    voiceReport: '1559889478007660594',   // войс-репрт
    keysShop: '1560629829106147408',      // 🎁︙・магазин-ключей
    keyRequests: '1561368798710341712',   // запрос-на-ключ
    shopLog: '1559913189926375435',       // log-shop
    support: '1561314306203590816'        // support
  },

  // Key Role definition (Секретная админка / Ключ стаффа)
  keyRole: {
    id: '1558596783314182164',
    name: '🔑',
    label: '🔑 Ключ',
    title: 'Ключ',
    desc: 'Роль ключа стаффа',
    emoji: '🔑',
    privileges: [
      'У вас нет нормы по часам и поинтам',
      'Вы можете выдавать пользователям пкм муты микрофона',
      'У вас появляется доступ к функционалу модератора',
      'У вас появляется доступ к локальному серверу модераторов',
      'Открывается возможность участвовать во всех мероприятиях модераторов',
      'Нахождение в приватном канале модераторов по своему желанию'
    ]
  },

  // Color scheme
  colors: {
    primary: '#2B2D31',
    success: '#57F287',
    warning: '#FEE75C',
    danger: '#ED4245'
  }
};
