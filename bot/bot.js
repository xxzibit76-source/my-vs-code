const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const baileys = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');

const { DisconnectReason, downloadMediaMessage, useMultiFileAuthState } = baileys;
const makeWASocket = baileys.default;
const dataDirectory = path.resolve(process.env.TANJIRO_DATA_DIR || '.');
fs.mkdirSync(dataDirectory, { recursive: true });
const authDirectory = path.join(dataDirectory, '.tanjiro_auth');
const settingsPath = path.join(dataDirectory, '.tanjiro_settings.json');
const remindersPath = path.join(dataDirectory, '.tanjiro_reminders.json');
const gameScoresPath = path.join(dataDirectory, '.tanjiro_scores.json');
const dailyEventsPath = path.join(dataDirectory, '.tanjiro_events.json');
const phoneNumber = (process.env.WHATSAPP_PHONE_NUMBER || '').replace(/\D/g, '');
const ownerNumber = (process.env.WHATSAPP_OWNER_NUMBER || '233507488053').replace(/\D/g, '');
const aiModel = process.env.OPENAI_MODEL || 'gpt-6-astra';
const autoReplyModel = process.env.OPENAI_AUTOREPLY_MODEL || 'gpt-4o-mini';
const requestedReasoningEffort = (process.env.OPENAI_REASONING_EFFORT || 'max').toLowerCase();
const reasoningEffort = ['low', 'medium', 'high', 'xhigh', 'max'].includes(requestedReasoningEffort)
  ? requestedReasoningEffort
  : 'max';
const aiAllowedNumbers = (process.env.OPENAI_ALLOWED_NUMBERS || ownerNumber)
  .split(',')
  .map((number) => number.replace(/\D/g, ''))
  .filter(Boolean);
const musicAllowedNumbers = (process.env.MUSIC_ALLOWED_NUMBERS || ownerNumber)
  .split(',')
  .map((number) => number.replace(/\D/g, ''))
  .filter(Boolean);
const defaultSettings = {
  statusView: false,
  statusLike: false,
  autoRead: false,
  mode: 'private',
  autoReply: false,
  autoReplyAI: false,
  autoReplyMessage: "Thanks for your message. I'm away right now and will reply when I can.",
  autoReplyRules: [],
  groupPreferences: [],
};

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return {
      statusView: saved.statusView === true,
      statusLike: saved.statusLike === true,
      autoRead: saved.autoRead === true,
      mode: saved.mode === 'private' ? 'private' : 'public',
      autoReply: saved.autoReply === true,
      autoReplyAI: saved.autoReplyAI === true,
      autoReplyMessage: typeof saved.autoReplyMessage === 'string'
        ? saved.autoReplyMessage
        : defaultSettings.autoReplyMessage,
      autoReplyRules: Array.isArray(saved.autoReplyRules)
        ? saved.autoReplyRules
          .filter((rule) => rule && typeof rule.keyword === 'string' && rule.keyword.trim()
            && typeof rule.reply === 'string' && rule.reply.trim())
          .slice(0, 20)
          .map((rule) => ({ keyword: rule.keyword.trim().toLowerCase(), reply: rule.reply.trim() }))
        : [],
      groupPreferences: Array.isArray(saved.groupPreferences)
        ? saved.groupPreferences
          .filter((group) => group && typeof group.jid === 'string' && group.jid.endsWith('@g.us'))
          .slice(0, 200)
          .map((group) => ({ jid: group.jid, welcome: group.welcome === true, goodbye: group.goodbye === true }))
        : [],
    };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not load settings:', error.message);
    return { ...defaultSettings };
  }
}

function saveSettings() {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

let settings = loadSettings();

function loadReminders() {
  try {
    const saved = JSON.parse(fs.readFileSync(remindersPath, 'utf8'));
    if (!Array.isArray(saved)) return [];
    return saved.filter((reminder) => (
      reminder
      && typeof reminder.id === 'string'
      && typeof reminder.jid === 'string'
      && typeof reminder.owner === 'string'
      && typeof reminder.text === 'string'
      && Number.isFinite(reminder.dueAt)
    ));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not load reminders:', error.message);
    return [];
  }
}

function saveReminders() {
  fs.writeFileSync(remindersPath, JSON.stringify(reminders, null, 2));
}

let reminders = loadReminders();

function loadGameScores() {
  try {
    const saved = JSON.parse(fs.readFileSync(gameScoresPath, 'utf8'));
    if (!Array.isArray(saved)) return [];
    return saved.filter((score) => (
      score
      && typeof score.chatJid === 'string'
      && typeof score.playerJid === 'string'
      && typeof score.name === 'string'
      && Number.isSafeInteger(score.points)
      && score.points >= 0
    ));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not load game scores:', error.message);
    return [];
  }
}

function saveGameScores() {
  fs.writeFileSync(gameScoresPath, JSON.stringify(gameScores, null, 2));
}

let gameScores = loadGameScores();

function loadDailyEvents() {
  try {
    const saved = JSON.parse(fs.readFileSync(dailyEventsPath, 'utf8'));
    if (!Array.isArray(saved)) return [];
    return saved.filter((event) => (
      event
      && typeof event.id === 'string'
      && typeof event.jid === 'string'
      && /^([01]\d|2[0-3]):[0-5]\d$/.test(event.time)
      && typeof event.text === 'string'
      && (event.lastSentDate === null || typeof event.lastSentDate === 'string')
    ));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not load daily events:', error.message);
    return [];
  }
}

function saveDailyEvents() {
  fs.writeFileSync(dailyEventsPath, JSON.stringify(dailyEvents, null, 2));
}

let dailyEvents = loadDailyEvents();

const helpMessage = [
  'Hi, I am Tanjiro. Here are the commands I can help with:',
  '!help - Show this command list',
  '!ask <question> - Ask Tanjiro an AI question',
  '!forget - Clear your recent AI conversation context',
  '!anime <title|trending> - Search anime or browse trending titles',
  '!group info|admins - Show group details or admins',
  '!group adminbot - Check Tanjiro admin status and show promotion steps',
  '!group add|remove|promote|demote <@mention|number> - Admin member tools',
  '!group announce|lock|welcome|goodbye on|off - Admin group settings',
  '!welcome on|off - Toggle join greetings in this group',
  '!leave on|off - Toggle member departure notices in this group',
  '!group settings - Show current group settings',
  '!group subject <name> - Change the group name',
  '!group description [set <text>|clear] - View or update the group description',
  '!group invite show|revoke - View or renew the invite link',
  '!group ephemeral off|24h|7d|90d - Set disappearing messages',
  '!group addmode admins|everyone - Choose who can add members',
  '!group joinapproval on|off - Require approval for new members',
  '!group pending - List join requests',
  '!group approve|reject <@mention> - Process a join request',
  '!group leave - Confirmed command for Tanjiro to leave the group',
  '!tagall <message> - Prepare an everyone mention; confirm with its code',
  '!music search <query> - Search YouTube music videos',
  '!music play <query> - Get the top YouTube result to play',
  '!setpp - Set the bot profile picture using an image captioned with this command',
  '!play music <query> - Find the top music result',
  '!music search <query> - Search YouTube music videos',
  '!music play <query> - Get the top YouTube result to play',
  '!games - List the games',
  '!daily [answer <answer>] - Take the daily trivia challenge',
  '!event add HH:MM <message> - Schedule a daily message in this chat (owner only)',
  '!event list|remove <id> - Manage daily messages (owner only)',
  '!score - Show your game points in this chat',
  '!leaderboard - Show this chat\'s top players',
  '!guess - Start a number guessing game (1-100); guess with !guess <number>',
  '!rps <rock|paper|scissors> - Play rock-paper-scissors',
  '!trivia - Get a trivia question; answer with !answer <answer>',
  '!hint - Use one hint in hangman, scramble, or trivia',
  '!hangman - Start hangman; guess with !letter <letter>',
  '!scramble - Unscramble a word; answer with !solve <word>',
  '!coin - Flip a coin',
  '!dice [sides] - Roll a die (default 6 sides)',
  '!quit - End your active game',
  '!ping - Check that I am online',
  '!date [YYYY-MM-DD] - Show the current date or a date you choose',
  '!time [timezone] - Show the current date and time',
  '!timezone - Show the bot device timezone',
  '!calendar [YYYY-MM] - Show a monthly calendar',
  '!remind <duration> <message> - Set a reminder (duration: 10m, 2h, 1d)',
  '!reminders - List your reminders',
  '!cancelreminder <id> - Cancel one of your reminders',
  '!autoreply on|off - Toggle automatic direct-message replies',
  '!autoreply ai on|off - Use AI for automatic replies',
  '!autoreply set <message> - Set the automatic reply text',
  '!autoreply add <keyword> | <reply> - Add a keyword reply rule',
  '!autoreply remove <keyword> - Remove a keyword reply rule',
  '!autoreply list - List keyword reply rules',
  '!autoreply show - Show auto-reply settings',
  '!about - Learn about this bot',
  '!echo <message> - Repeat a message',
  '!statusview on|off - Automatically mark new statuses as viewed',
  '!statuslike on|off - Automatically react to new statuses with a heart',
  '!autoread on|off - Automatically mark incoming messages as read',
  '!mode public|private - Choose who can use the bot',
].join('\n');

let activeSocket;
let shouldReconnect = true;
let isConnected = false;
let deliveringReminders = false;
let deliveringDailyEvents = false;
let reconnectAttempts = 0;
let reconnectTimer;

function startStatusServer() {
  const port = Number(process.env.PORT || 3000);
  const server = http.createServer((request, response) => {
    const pathname = (request.url || '/').split('?')[0];
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }).end('Method not allowed');
      return;
    }

    if (pathname === '/healthz' || pathname === '/api/status') {
      const body = JSON.stringify({
        service: 'tanjiro',
        whatsapp: isConnected ? 'connected' : 'connecting',
        uptimeSeconds: Math.floor(process.uptime()),
        checkedAt: new Date().toISOString(),
      });
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      }).end(body);
      return;
    }

    if (pathname !== '/') {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }

    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    }).end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#14241f">
  <title>Tanjiro | Service status</title>
  <style>
    :root{color-scheme:dark;--ink:#f3f4e9;--muted:#b5c1b6;--green:#a8e6a1;--amber:#ffd27d;--panel:#1c302a;--line:#395148}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 15% 0%,#314b3e 0,transparent 44%),linear-gradient(145deg,#101d1a,#172722 58%,#24372e);color:var(--ink);font-family:Georgia,'Times New Roman',serif;display:grid;place-items:center;padding:24px}
    main{width:min(100%,620px);border:1px solid var(--line);background:rgba(20,36,31,.88);padding:clamp(26px,7vw,58px);box-shadow:0 24px 80px #07100d88}
    .eyebrow{font:600 12px/1.4 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--green)}h1{font-size:clamp(38px,8vw,64px);font-weight:500;margin:18px 0 8px}.intro{font:16px/1.6 system-ui,sans-serif;color:var(--muted);margin:0 0 34px}
    .status{display:flex;align-items:center;gap:14px;padding:18px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font:600 18px/1.4 system-ui,sans-serif}.lamp{width:13px;height:13px;border-radius:50%;background:var(--amber);box-shadow:0 0 18px currentColor}.lamp.online{background:var(--green)}.details{display:flex;justify-content:space-between;gap:14px;margin-top:20px;font:13px/1.5 system-ui,sans-serif;color:var(--muted)}
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">WhatsApp assistant</div>
    <h1>Tanjiro</h1>
    <p class="intro">A small service-status page for the Tanjiro WhatsApp bot.</p>
    <div class="status"><span id="lamp" class="lamp"></span><span id="state">Checking connection…</span></div>
    <div class="details"><span id="uptime">Uptime: —</span><span id="checked">Updated just now</span></div>
  </main>
  <script>
    async function refresh(){try{const r=await fetch('/api/status',{cache:'no-store'});const d=await r.json();const online=d.whatsapp==='connected';document.getElementById('state').textContent=online?'WhatsApp connected':'WhatsApp reconnecting';document.getElementById('lamp').classList.toggle('online',online);document.getElementById('uptime').textContent='Uptime: '+Math.floor(d.uptimeSeconds/3600)+'h '+Math.floor(d.uptimeSeconds%3600/60)+'m';document.getElementById('checked').textContent='Updated '+new Date(d.checkedAt).toLocaleTimeString()}catch{document.getElementById('state').textContent='Status unavailable'}}refresh();setInterval(refresh,15000);
  </script>
</body>
</html>`);
  });

  server.on('error', (error) => {
    console.error('Status server failed:', error.message);
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`Tanjiro status page listening on port ${port}.`);
  });
  return server;
}

const statusServer = startStatusServer();
const autoReplyCooldowns = new Map();
const aiRequestCooldowns = new Map();
const musicSearchCooldowns = new Map();
const animeSearchCooldowns = new Map();
const aiConversations = new Map();
const gameSessions = new Map();
const rpsHistory = new Map();
const tagAllConfirmations = new Map();
const groupLeaveConfirmations = new Map();
const triviaQuestions = [
  { question: 'What is the largest planet in our solar system?', answers: ['jupiter'] },
  { question: 'What is the largest ocean on Earth?', answers: ['pacific', 'pacificocean'] },
  { question: 'What is the chemical symbol for gold?', answers: ['au'] },
  { question: 'How many sides does a hexagon have?', answers: ['6', 'six'] },
  { question: 'Which planet is known as the Red Planet?', answers: ['mars'] },
  { question: 'What is the fastest land animal?', answers: ['cheetah'] },
  { question: 'What is the capital city of Japan?', answers: ['tokyo'] },
  { question: 'Which gas do plants absorb from the atmosphere?', answers: ['carbondioxide', 'co2'] },
  { question: 'How many bones are in the adult human body?', answers: ['206', 'twohundredsix'] },
  { question: 'What is the hardest naturally occurring substance?', answers: ['diamond'] },
  { question: 'Which instrument has 88 keys on a standard version?', answers: ['piano'] },
  { question: 'What is the smallest prime number?', answers: ['2', 'two'] },
  { question: 'Which continent contains the Sahara Desert?', answers: ['africa'] },
  { question: 'What is the main language spoken in Brazil?', answers: ['portuguese'] },
  { question: 'How many minutes are in two hours?', answers: ['120', 'onetwenty'] },
  { question: 'What is the chemical formula for water?', answers: ['h2o'] },
  { question: 'Which planet is closest to the Sun?', answers: ['mercury'] },
  { question: 'What is the capital of Ghana?', answers: ['accra'] },
  { question: 'How many sides does an octagon have?', answers: ['8', 'eight'] },
  { question: 'Which animal is the largest mammal?', answers: ['bluewhale', 'bluewhales'] },
  { question: 'What is the currency of Japan?', answers: ['yen', 'japaneseyen'] },
  { question: 'Which organ pumps blood around the human body?', answers: ['heart'] },
  { question: 'What is the freezing point of water in degrees Celsius?', answers: ['0', 'zerodegrees', 'zerodegreescelsius'] },
  { question: 'Who wrote Romeo and Juliet?', answers: ['shakespeare', 'williamshakespeare'] },
  { question: 'What is the largest hot desert in the world?', answers: ['sahara', 'saharadesert'] },
  { question: 'Which language is primarily spoken in Mexico?', answers: ['spanish'] },
  { question: 'How many colors are traditionally named in a rainbow?', answers: ['7', 'seven'] },
  { question: 'What is the process by which plants make food using sunlight?', answers: ['photosynthesis'] },
  { question: 'Which country is home to the city of Kyoto?', answers: ['japan'] },
  { question: 'What is the square root of 81?', answers: ['9', 'nine'] },
  { question: 'Which metal is liquid at room temperature?', answers: ['mercury'] },
  { question: 'What is the name of the galaxy that contains Earth?', answers: ['milkyway', 'themilkyway'] },
  { question: 'Which sport uses a shuttlecock?', answers: ['badminton'] },
  { question: 'What is the largest country in the world by land area?', answers: ['russia'] },
  { question: 'What is the chemical symbol for sodium?', answers: ['na'] },
  { question: 'Who wrote The Hobbit?', answers: ['tolkien', 'jrrtolkien'] },
  { question: 'How many pieces does each player start with in chess?', answers: ['16', 'sixteen'] },
  { question: 'What is the capital city of Canada?', answers: ['ottawa'] },
  { question: 'How many planets are in our solar system?', answers: ['8', 'eight'] },
  { question: 'What is the name of the star at the center of our solar system?', answers: ['sun', 'thesun'] },
  { question: 'Which instrument is used to measure temperature?', answers: ['thermometer'] },
  { question: 'What is the process called when liquid water changes into vapor?', answers: ['evaporation'] },
  { question: 'How many rings are on the Olympic symbol?', answers: ['5', 'five'] },
  { question: 'What does CPU stand for?', answers: ['centralprocessingunit'] },
  { question: 'Which blood cells carry oxygen around the body?', answers: ['redbloodcells', 'erythrocytes'] },
  { question: 'What is the first letter of the Greek alphabet?', answers: ['alpha'] },
  { question: 'In Roman numerals, what number does X represent?', answers: ['10', 'ten'] },
  { question: 'What is the currency used in the United Kingdom?', answers: ['pound', 'poundsterling', 'sterling'] },
  { question: 'Which ocean lies between Africa and Australia?', answers: ['indianocean'] },
  { question: 'What is the name of the closest star to Earth after the Sun?', answers: ['proximacentauri'] },
  { question: 'In Greek mythology, who is the king of the gods?', answers: ['zeus'] },
  { question: 'What is the name of the force that pulls objects toward Earth?', answers: ['gravity'] },
  { question: 'Which artist painted the Mona Lisa?', answers: ['leonardodavinci', 'davinci'] },
];
const gameWords = [
  'garden', 'lantern', 'journey', 'planet', 'whisper', 'diamond', 'library', 'sunrise', 'mystery', 'harbor',
  'compass', 'volcano', 'festival', 'velocity', 'puzzle', 'rainbow', 'mountain', 'courage', 'triangle', 'bicycle',
  'notebook', 'wildlife', 'electric', 'discover', 'fireworks', 'starlight', 'waterfall', 'blueprint', 'adventure', 'keyboard',
];

function scheduleReconnect() {
  if (!shouldReconnect || reconnectTimer) return;
  const baseDelay = Math.min(3_000 * (2 ** reconnectAttempts), 60_000);
  const delay = Math.min(Math.round(baseDelay * (0.8 + Math.random() * 0.4)), 60_000);
  reconnectAttempts = Math.min(reconnectAttempts + 1, 5);
  console.log(`Reconnecting in ${Math.ceil(delay / 1000)} seconds...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    startTanjiro().catch((error) => {
      console.error('Reconnect failed:', error.message);
      scheduleReconnect();
    });
  }, delay);
  reconnectTimer.unref?.();
}

function getMessageText(message) {
  const content = message.message;
  return content?.conversation
    || content?.extendedTextMessage?.text
    || content?.imageMessage?.caption
    || content?.videoMessage?.caption;
}

function formatAutoReply(reply, message) {
  const name = (message.pushName || 'there').trim().slice(0, 60);
  const time = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date());
  return reply.replaceAll('{name}', name).replaceAll('{time}', time);
}

async function getAIReply(question, message, forAutoReply = false) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return forAutoReply ? null : 'AI is not configured. Set OPENAI_API_KEY in the environment.';
  if (!question) return forAutoReply ? null : 'Usage: !ask <question>';
  if (question.length > 4000) return forAutoReply ? null : 'Questions must be 4000 characters or fewer.';
  const senderNumber = getSenderJid(message).split('@')[0];
  if (!forAutoReply && !aiAllowedNumbers.includes(senderNumber)) return 'AI access is not enabled for this number.';

  const conversationKey = `${message.key.remoteJid}:${getSenderJid(message)}`;
  const requestKey = `${forAutoReply ? 'autoreply' : 'ask'}:${conversationKey}`;
  const now = Date.now();
  for (const [key, timestamp] of aiRequestCooldowns) {
    if (now - timestamp >= 60_000) aiRequestCooldowns.delete(key);
  }
  if (now - (aiRequestCooldowns.get(requestKey) || 0) < 10_000) {
    return 'Please wait a few seconds before asking another AI question.';
  }
  aiRequestCooldowns.set(requestKey, now);

  try {
    const input = forAutoReply
      ? question
      : [...(aiConversations.get(conversationKey) || []), { role: 'user', content: question }];
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: forAutoReply ? autoReplyModel : aiModel,
        store: false,
        ...(!forAutoReply && /^(gpt-[56]|o[134])/.test(aiModel)
          ? { reasoning: { effort: reasoningEffort } }
          : {}),
        instructions: forAutoReply
          ? 'Speak as Tanjiro, a benevolent mythic guide with a calm, wise, quietly majestic voice. Reply naturally in at most two short sentences and answer the message directly. This is a fictional style: never claim to be an actual deity, to know everything, or to have supernatural powers. Do not invent personal experiences or claim actions you did not perform.'
          : 'You are Tanjiro, a benevolent mythic guide: speak with calm wisdom, quiet majesty, and gentle authority, like a fictional god from an epic tale. Keep this as a literary persona; never claim to be an actual deity, omniscient, infallible, or supernaturally powerful. Understand the user\'s goal before answering. Give accurate, useful, well-structured answers with practical steps or examples when helpful. Explain assumptions, distinguish facts from uncertainty, and correct false premises tactfully. For complex questions, organize the response with short headings or numbered steps. Be concise when the question is simple, and never expose hidden chain-of-thought; provide a brief rationale or summary instead. Do not invent sources or claim actions you did not perform.',
        input,
        max_output_tokens: forAutoReply ? 220 : 6000,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || `OpenAI returned HTTP ${response.status}`);

    const answer = (result.output || [])
      .flatMap((item) => item.content || [])
      .filter((item) => item.type === 'output_text')
      .map((item) => item.text)
      .join('\n')
      .trim();
    if (!answer) return forAutoReply ? null : 'The AI did not return a text answer. Please try again.';
    if (!forAutoReply) {
      const conversation = [...input, ...(result.output || [])].slice(-24);
      if (!aiConversations.has(conversationKey) && aiConversations.size >= 1000) {
        aiConversations.delete(aiConversations.keys().next().value);
      }
      aiConversations.set(conversationKey, conversation);
    }
    return answer.length > 7000 ? `${answer.slice(0, 6997)}...` : answer;
  } catch (error) {
    aiRequestCooldowns.delete(requestKey);
    console.error('AI request failed:', error.message);
    return forAutoReply
      ? null
      : 'I could not reach the AI service. Check the API key, model, and connection, then try again.';
  }
}

async function searchMusic(query, action, message) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return 'Music search is not configured. Set YOUTUBE_API_KEY in the environment.';
  if (!query) return 'Usage: !music search <query> or !music play <query>';
  if (query.length > 150) return 'Music searches must be 150 characters or fewer.';

  const senderNumber = getSenderJid(message).split('@')[0];
  if (!musicAllowedNumbers.includes(senderNumber)) return 'Music search is not enabled for this number.';
  const requestKey = `${message.key.remoteJid}:${getSenderJid(message)}`;
  const now = Date.now();
  if (now - (musicSearchCooldowns.get(requestKey) || 0) < 10_000) {
    return 'Please wait a few seconds before searching again.';
  }
  musicSearchCooldowns.set(requestKey, now);

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('videoCategoryId', '10');
    url.searchParams.set('maxResults', action === 'play' ? '1' : '5');
    url.searchParams.set('safeSearch', 'moderate');
    url.searchParams.set('q', query);
    url.searchParams.set('key', apiKey);

    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || `YouTube API returned HTTP ${response.status}`);

    const items = (result.items || []).filter((item) => item.id?.videoId);
    if (!items.length) return 'No music results found.';
    return items.map((item, index) => {
      const title = (item.snippet?.title || 'Untitled').replace(/\s+/g, ' ').slice(0, 120);
      const channel = (item.snippet?.channelTitle || 'YouTube').replace(/\s+/g, ' ').slice(0, 80);
      const videoUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(item.id.videoId)}`;
      return `${index + 1}. ${title} - ${channel}\n${videoUrl}`;
    }).join('\n\n');
  } catch (error) {
    musicSearchCooldowns.delete(requestKey);
    console.error('Music search failed:', error.message);
    return 'Music search is unavailable. Check YOUTUBE_API_KEY and try again.';
  }
}

async function searchAnime(query, trending, message) {
  if (!trending && !query) return 'Usage: !anime <title> or !anime trending';
  if (query.length > 100) return 'Anime searches must be 100 characters or fewer.';

  const requestKey = `${message.key.remoteJid}:${getSenderJid(message)}`;
  const now = Date.now();
  if (now - (animeSearchCooldowns.get(requestKey) || 0) < 5_000) {
    return 'Please wait a few seconds before searching anime again.';
  }
  animeSearchCooldowns.set(requestKey, now);

  try {
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        query: `query ($search: String, $sort: [MediaSort]) {
          Page(page: 1, perPage: 5) {
            media(search: $search, type: ANIME, sort: $sort, isAdult: false) {
              title { romaji english }
              format status episodes seasonYear averageScore genres siteUrl description(asHtml: false)
            }
          }
        }`,
        variables: {
          search: trending ? null : query,
          sort: trending ? ['TRENDING_DESC'] : ['SEARCH_MATCH'],
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json();
    if (!response.ok || result.errors?.length) {
      throw new Error(result.errors?.[0]?.message || `AniList returned HTTP ${response.status}`);
    }

    const media = result.data?.Page?.media || [];
    if (!media.length) return 'No anime results found.';
    return media.map((anime, index) => {
      const title = anime.title?.english || anime.title?.romaji || 'Untitled';
      const details = [
        anime.seasonYear,
        anime.format?.replaceAll('_', ' '),
        anime.episodes ? `${anime.episodes} eps` : null,
        anime.averageScore ? `score ${anime.averageScore}/100` : null,
      ].filter(Boolean).join(' | ');
      const description = (anime.description || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#039;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
      const summary = description ? `${description.slice(0, 220)}${description.length > 220 ? '...' : ''}` : '';
      return `${index + 1}. ${title}${details ? `\n${details}` : ''}${summary ? `\n${summary}` : ''}\n${anime.siteUrl}`;
    }).join('\n\n');
  } catch (error) {
    animeSearchCooldowns.delete(requestKey);
    console.error('Anime search failed:', error.message);
    return 'Anime search is unavailable right now. Please try again later.';
  }
}

async function getReply(text, message) {
  const [rawCommand = '', ...args] = text.slice(1).trim().split(/\s+/);
    const command = rawCommand.toLowerCase().trim();
  const senderJid = getSenderJid(message);
  const senderNumber = senderJid.split('@')[0].split(':')[0];
  const isOwner = Boolean(ownerNumber && senderNumber === ownerNumber);

  if (settings.mode === 'private' && !isOwner) return null;
    if (['settings', 'statusview', 'statuslike', 'autoread', 'mode', 'autoreply', 'event'].includes(command) && !isOwner) {
    return ownerNumber
      ? 'Only the configured bot owner can change these settings.'
      : 'Set WHATSAPP_OWNER_NUMBER to your number (country code included) to manage bot settings.';
  }

  switch (command) {
    case 'help':
      return helpMessage;
    case 'forget': {
      const conversationKey = `${message.key.remoteJid}:${senderJid}`;
      const hadContext = aiConversations.delete(conversationKey);
      return hadContext ? 'Your recent AI conversation context was cleared.' : 'There is no saved AI conversation context to clear.';
    }
      case 'settings':
        return [
          'Tanjiro settings:',
          `Mode: ${settings.mode}`,
          `Auto-read messages: ${settings.autoRead ? 'on' : 'off'}`,
          `View statuses: ${settings.statusView ? 'on' : 'off'}`,
          `Like statuses: ${settings.statusLike ? 'on' : 'off'}`,
          `Auto-reply: ${settings.autoReply ? 'on' : 'off'}`,
          `AI auto-reply: ${settings.autoReplyAI ? 'on' : 'off'}`,
          `Auto-reply keyword rules: ${settings.autoReplyRules.length}`,
          `AI service: ${process.env.OPENAI_API_KEY ? `configured (${aiModel})` : 'not configured'}`,
          `Music search: ${process.env.YOUTUBE_API_KEY ? 'configured' : 'not configured'}`,
        ].join('\n');
    case 'ask':
      return getAIReply(args.join(' ').trim(), message);
    case 'anime': {
      const trending = args[0]?.toLowerCase() === 'trending';
      const query = args[0]?.toLowerCase() === 'search' ? args.slice(1).join(' ').trim() : args.join(' ').trim();
      return searchAnime(query, trending, message);
    }
    case 'event': {
      const action = args[0]?.toLowerCase();
      if (action === 'add') {
        const time = args[1];
        const eventText = args.slice(2).join(' ').trim();
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '') || !eventText) {
          return 'Usage: !event add HH:MM <message> (24-hour time)';
        }
        if (eventText.length > 500) return 'Daily event messages must be 500 characters or fewer.';
        if (dailyEvents.length >= 20) return 'You can schedule up to 20 daily events.';
        const event = {
          id: crypto.randomBytes(3).toString('hex').toUpperCase(),
          jid: message.key.remoteJid,
          time,
          text: eventText,
          lastSentDate: null,
        };
        dailyEvents.push(event);
        saveDailyEvents();
        return `Daily event ${event.id} scheduled for ${time} (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`;
      }
      if (action === 'list') {
        if (!dailyEvents.length) return 'No daily events are scheduled.';
        return ['Daily events:', ...dailyEvents.map((event) => (
          `${event.id} | ${event.time} | ${event.jid} | ${event.text}`
        ))].join('\n');
      }
      if (action === 'remove') {
        const id = args[1]?.toUpperCase();
        if (!id) return 'Usage: !event remove <id>';
        const existingCount = dailyEvents.length;
        dailyEvents = dailyEvents.filter((event) => event.id !== id);
        if (dailyEvents.length === existingCount) return `No daily event found with ID ${id}.`;
        saveDailyEvents();
        return `Daily event ${id} removed.`;
      }
      return 'Usage: !event add HH:MM <message>, !event list, or !event remove <id>';
    }
    case 'music': {
      const action = args[0]?.toLowerCase();
      const mode = action === 'play' ? 'play' : 'search';
      const query = action === 'play' || action === 'search'
        ? args.slice(1).join(' ').trim()
        : args.join(' ').trim();
      return searchMusic(query, mode, message);
    }
    case 'ping':
      return 'Pong! Tanjiro is online.';
    case 'date': {
      const date = parseLocalDate(args[0]);
      if (!date) return 'Usage: !date [YYYY-MM-DD]';
      return new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(date);
    }
    case 'time': {
      try {
        const timeZone = args[0];
        const formatted = new Intl.DateTimeFormat(undefined, {
          dateStyle: 'full',
          timeStyle: 'long',
          ...(timeZone ? { timeZone } : {}),
        }).format(new Date());
        return `Current date and time${timeZone ? ` in ${timeZone}` : ''}: ${formatted}`;
      } catch {
        return 'Use a valid IANA timezone, such as Africa/Accra or Europe/London.';
      }
    }
    case 'timezone':
      return `Bot timezone: ${new Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'}`;
    case 'calendar':
      return getCalendar(args[0]);
    case 'remind': {
      const match = args[0]?.match(/^(\d+)(m|h|d)$/i);
      if (!match || !args.slice(1).length) return 'Usage: !remind <duration> <message> (for example: !remind 20m stretch)';
      const amount = Number(match[1]);
      const unit = match[2].toLowerCase();
      const duration = amount * (unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000);
      if (!Number.isSafeInteger(duration) || duration < 60_000 || duration > 30 * 86_400_000) {
        return 'Reminder duration must be from 1 minute to 30 days.';
      }

      const reminder = {
        id: crypto.randomBytes(3).toString('hex').toUpperCase(),
        owner: senderJid,
        jid: message.key.remoteJid,
        text: args.slice(1).join(' '),
        dueAt: Date.now() + duration,
      };
      reminders.push(reminder);
      saveReminders();
      return `Reminder ${reminder.id} set for ${new Date(reminder.dueAt).toLocaleString()}.`;
    }
    case 'reminders': {
      const ownReminders = reminders.filter((reminder) => reminder.owner === senderJid);
      if (!ownReminders.length) return 'You have no pending reminders.';
      return ownReminders.map((reminder) => (
        `${reminder.id}: ${new Date(reminder.dueAt).toLocaleString()} - ${reminder.text}`
      )).join('\n');
    }
    case 'cancelreminder': {
      const id = args[0]?.toUpperCase();
      if (!id) return 'Usage: !cancelreminder <id>';
      const index = reminders.findIndex((reminder) => reminder.id === id && reminder.owner === senderJid);
      if (index === -1) return 'Reminder not found. Use !reminders to see your reminder IDs.';
      reminders.splice(index, 1);
      saveReminders();
      return `Reminder ${id} cancelled.`;
    }
    case 'autoreply': {
      const action = args[0]?.toLowerCase();
      if (!action || action === 'show') {
        return `Auto-reply is ${settings.autoReply ? 'on' : 'off'}.\nAI replies are ${settings.autoReplyAI ? 'on' : 'off'}.\nDefault message: ${settings.autoReplyMessage}\nKeyword rules: ${settings.autoReplyRules.length}`;
      }
      if (action === 'ai') {
        const value = args[1]?.toLowerCase();
        if (!value) return `AI auto-replies are ${settings.autoReplyAI ? 'on' : 'off'}. Use !autoreply ai on|off.`;
        if (!['on', 'off'].includes(value)) return 'Usage: !autoreply ai on|off';
        if (value === 'on' && !process.env.OPENAI_API_KEY) {
          return 'Set OPENAI_API_KEY before enabling AI auto-replies.';
        }
        settings.autoReplyAI = value === 'on';
        saveSettings();
        return `AI auto-replies turned ${value}.`;
      }
      if (action === 'list') {
        if (!settings.autoReplyRules.length) return 'No keyword rules are set.';
        return ['Keyword rules:', ...settings.autoReplyRules.map((rule) => `- ${rule.keyword}`)].join('\n');
      }
      if (action === 'add') {
        const ruleText = text.slice('!autoreply'.length).trim().slice(action.length).trim();
        const separator = ruleText.indexOf('|');
        if (separator < 1) return 'Usage: !autoreply add <keyword> | <reply>';
        const keyword = ruleText.slice(0, separator).trim().toLowerCase();
        const reply = ruleText.slice(separator + 1).trim();
        if (!keyword || keyword.length > 50 || !reply) return 'Use a keyword up to 50 characters and include a reply.';
        if (reply.length > 500) return 'Auto-reply messages must be 500 characters or fewer.';
        const existingIndex = settings.autoReplyRules.findIndex((rule) => rule.keyword === keyword);
        if (existingIndex === -1 && settings.autoReplyRules.length >= 20) {
          return 'You can save up to 20 keyword rules.';
        }
        const rule = { keyword, reply };
        if (existingIndex === -1) settings.autoReplyRules.push(rule);
        else settings.autoReplyRules[existingIndex] = rule;
        saveSettings();
        return `Keyword reply saved for "${keyword}".`;
      }
      if (action === 'remove') {
        const keyword = args.slice(1).join(' ').trim().toLowerCase();
        if (!keyword) return 'Usage: !autoreply remove <keyword>';
        const beforeCount = settings.autoReplyRules.length;
        settings.autoReplyRules = settings.autoReplyRules.filter((rule) => rule.keyword !== keyword);
        if (settings.autoReplyRules.length === beforeCount) return `No rule found for "${keyword}".`;
        saveSettings();
        return `Keyword reply removed for "${keyword}".`;
      }
      if (action === 'on' || action === 'off') {
        settings.autoReply = action === 'on';
        saveSettings();
        return `Auto-reply turned ${action}.`;
      }
      if (action === 'set') {
        const replyMessage = args.slice(1).join(' ').trim();
        if (!replyMessage) return 'Usage: !autoreply set <message>';
        if (replyMessage.length > 500) return 'Auto-reply messages must be 500 characters or fewer.';
        settings.autoReplyMessage = replyMessage;
        saveSettings();
        return 'Auto-reply message updated.';
      }
      return 'Usage: !autoreply on|off, !autoreply ai on|off, !autoreply set <message>, or !autoreply show';
    }
    case 'about':
      return 'I am Tanjiro, a small WhatsApp assistant running on this device.';
    case 'echo':
      return args.length ? args.join(' ') : 'Usage: !echo <message>';
    case 'statusview':
    case 'statuslike': {
      const setting = command === 'statusview' ? 'statusView' : 'statusLike';
      const label = command === 'statusview' ? 'Automatic status viewing' : 'Automatic status likes';
      const value = args[0]?.toLowerCase();
      if (!value) return `${label} is ${settings[setting] ? 'on' : 'off'}. Use !${command} on|off.`;
      if (!['on', 'off'].includes(value)) return `Usage: !${command} on|off`;
      settings[setting] = value === 'on';
      saveSettings();
      return `${label} turned ${value}.`;
    }
    case 'autoread': {
      const value = args[0]?.toLowerCase();
      if (!value) return `Auto-read is ${settings.autoRead ? 'on' : 'off'}. Use !autoread on|off.`;
      if (!['on', 'off'].includes(value)) return 'Usage: !autoread on|off';
      settings.autoRead = value === 'on';
      saveSettings();
      return `Auto-read turned ${value}.`;
    }
    case 'mode': {
      const value = args[0]?.toLowerCase();
      if (!value) return `Current mode: ${settings.mode}. Use !mode public|private.`;
      if (!['public', 'private'].includes(value)) return 'Usage: !mode public|private';
      settings.mode = value;
      saveSettings();
      return `Tanjiro is now in ${value} mode.`;
    }
    default:
      return 'I do not know that command yet. Send !help to see what I can do.';
  }
}

async function handleProfilePictureCommand(socket, message, text) {
  const [rawCommand = ''] = text.slice(1).trim().split(/\s+/);
  if (!['setpp', 'setprofilepic'].includes(rawCommand.toLowerCase())) return null;

  const senderNumber = getSenderJid(message).split('@')[0];
  if (senderNumber !== ownerNumber) return 'Only the bot owner can change the profile picture.';

  const imageMessage = message.message?.imageMessage;
  if (!imageMessage) return 'Send a regular image with !setpp as its caption.';
  const maximumImageBytes = 5 * 1024 * 1024;
  const declaredSize = Number(imageMessage.fileLength);
  if (Number.isFinite(declaredSize) && declaredSize > maximumImageBytes) {
    return 'Profile pictures must be 5 MB or smaller.';
  }

  try {
    const image = await downloadMediaMessage(message, 'buffer', {}, {
      logger: console,
      reuploadRequest: socket.updateMediaMessage,
    });
    if (image.length > maximumImageBytes) return 'Profile pictures must be 5 MB or smaller.';
    if (!socket.user?.id) return 'Tanjiro is not connected; try again after it reconnects.';
    await socket.updateProfilePicture(socket.user.id, image);
    return 'Tanjiro profile picture updated.';
  } catch (error) {
    console.error('Could not update profile picture:', error.message);
    return 'I could not update the profile picture. Try a different image.';
  }
}

function normalizeGroupUser(jid) {
  return (jid || '').replace(/:\d+(?=@)/, '').toLowerCase();
}

function isGroupAdmin(metadata, jid) {
  const normalizedJid = normalizeGroupUser(jid);
  return metadata.participants.some((participant) => (
    normalizeGroupUser(participant.id) === normalizedJid
    && (participant.admin === 'admin' || participant.admin === 'superadmin')
  ));
}

function getMentionedJids(message) {
  const content = message.message?.extendedTextMessage
    || message.message?.imageMessage
    || message.message?.videoMessage;
  return [...new Set(content?.contextInfo?.mentionedJid || [])];
}

async function handleGroupCommand(socket, message, text) {
  const [rawCommand = '', actionToken = '', ...remainingArgs] = text.slice(1).trim().split(/\s+/);
  const command = rawCommand.toLowerCase();
  const directAlias = ['welcome', 'leave', 'goodbye'].includes(command);
  if (command !== 'group' && !directAlias) return null;
  const normalizedAction = directAlias
    ? (command === 'leave' ? 'goodbye' : command)
    : actionToken.toLowerCase();
  const args = directAlias ? [actionToken, ...remainingArgs] : remainingArgs;
  const groupJid = message.key.remoteJid || '';
  if (!groupJid.endsWith('@g.us')) return 'Group commands only work inside a WhatsApp group.';

  let metadata;
  try {
    metadata = await socket.groupMetadata(groupJid);
  } catch (error) {
    console.error('Could not read group metadata:', error.message);
    return 'I could not read this group. Please try again.';
  }

  const senderJid = getSenderJid(message);
  if (!['info', 'admins', 'adminbot', ''].includes(normalizedAction) && !isGroupAdmin(metadata, senderJid)) {
    return 'Only group admins can use this command.';
  }

  if (normalizedAction === 'info' || !normalizedAction) {
    const admins = metadata.participants
      .filter((participant) => participant.admin === 'admin' || participant.admin === 'superadmin')
      .map((participant) => participant.id.split('@')[0].split(':')[0]);
    const description = metadata.desc ? `\nDescription: ${metadata.desc.slice(0, 300)}` : '';
    return `Group: ${metadata.subject}\nMembers: ${metadata.size}\nAdmins: ${admins.join(', ') || 'none'}${description}`;
  }
  if (normalizedAction === 'admins') {
    const admins = metadata.participants
      .filter((participant) => participant.admin === 'admin' || participant.admin === 'superadmin')
      .map((participant) => `${participant.admin === 'superadmin' ? 'Owner' : 'Admin'}: ${participant.id.split('@')[0].split(':')[0]}`);
    return admins.length ? admins.join('\n') : 'This group has no listed admins.';
  }
  if (normalizedAction === 'adminbot') {
    if (isGroupAdmin(metadata, socket.user?.id)) return 'Tanjiro is already a group admin.';
    const botName = socket.user?.name || 'Tanjiro';
    return `An existing group admin must promote ${botName} manually: open Group info, select ${botName} in the participants list, then choose Make group admin. WhatsApp does not let the bot promote itself.`;
  }

  if (normalizedAction === 'settings') {
    const expiration = metadata.ephemeralDuration
      ? `${metadata.ephemeralDuration / 86_400} day(s)`
      : 'off';
    return [
      `Announcements: ${metadata.announce ? 'admin-only' : 'all members'}`,
      `Group info edits: ${metadata.restrict ? 'admin-only' : 'all members'}`,
      `Disappearing messages: ${expiration}`,
      `Member invites: ${metadata.memberAddMode ? 'all members' : 'admins only'}`,
      `Join approval: ${metadata.joinApprovalMode ? 'on' : 'off'}`,
    ].join('\n');
  }

  if (normalizedAction === 'subject') {
    const subject = args.join(' ').trim();
    if (!subject) return 'Usage: !group subject <new name>';
    if (subject.length > 100) return 'Group names must be 100 characters or fewer.';
    if (!isGroupAdmin(metadata, socket.user?.id)) return 'Tanjiro must be a group admin to change the group name.';
    try {
      await socket.groupUpdateSubject(groupJid, subject);
      return 'Group name updated.';
    } catch (error) {
      console.error('Could not update group name:', error.message);
      return 'WhatsApp could not update the group name.';
    }
  }

  if (normalizedAction === 'description') {
    const descriptionAction = args[0]?.toLowerCase();
    if (!descriptionAction) return metadata.desc || 'This group has no description.';
    if (!['set', 'clear'].includes(descriptionAction)) return 'Usage: !group description [set <text>|clear]';
    if (!isGroupAdmin(metadata, socket.user?.id)) return 'Tanjiro must be a group admin to change the description.';
    const description = args.slice(1).join(' ').trim();
    if (descriptionAction === 'set' && !description) return 'Usage: !group description set <text>';
    if (description.length > 2048) return 'Group descriptions must be 2048 characters or fewer.';
    try {
      await socket.groupUpdateDescription(groupJid, descriptionAction === 'clear' ? undefined : description);
      return descriptionAction === 'clear' ? 'Group description cleared.' : 'Group description updated.';
    } catch (error) {
      console.error('Could not update group description:', error.message);
      return 'WhatsApp could not update the group description.';
    }
  }

  if (normalizedAction === 'invite') {
    const inviteAction = args[0]?.toLowerCase() || 'show';
    if (!['show', 'revoke'].includes(inviteAction)) return 'Usage: !group invite show|revoke';
    if (!isGroupAdmin(metadata, socket.user?.id)) return 'Tanjiro must be a group admin to manage invite links.';
    try {
      const code = inviteAction === 'revoke'
        ? await socket.groupRevokeInvite(groupJid)
        : await socket.groupInviteCode(groupJid);
      return code ? `Group invite link${inviteAction === 'revoke' ? ' renewed' : ''}: https://chat.whatsapp.com/${code}` : 'WhatsApp did not return an invite link.';
    } catch (error) {
      console.error('Could not get group invite link:', error.message);
      return 'WhatsApp could not access the group invite link.';
    }
  }

  if (normalizedAction === 'ephemeral') {
    const durations = { off: 0, '24h': 86_400, '7d': 604_800, '90d': 7_776_000 };
    const duration = durations[args[0]?.toLowerCase()];
    if (duration === undefined) return 'Usage: !group ephemeral off|24h|7d|90d';
    if (!isGroupAdmin(metadata, socket.user?.id)) return 'Tanjiro must be a group admin to change disappearing messages.';
    try {
      await socket.groupToggleEphemeral(groupJid, duration);
      return `Disappearing messages set to ${args[0].toLowerCase()}.`;
    } catch (error) {
      console.error('Could not update disappearing messages:', error.message);
      return 'WhatsApp could not update disappearing-message settings.';
    }
  }

  if (normalizedAction === 'addmode') {
    const value = args[0]?.toLowerCase();
    if (!['admins', 'everyone'].includes(value)) return 'Usage: !group addmode admins|everyone';
    if (!isGroupAdmin(metadata, socket.user?.id)) return 'Tanjiro must be a group admin to change who can add members.';
    try {
      await socket.groupMemberAddMode(groupJid, value === 'admins' ? 'admin_add' : 'all_member_add');
      return `Adding members is now ${value === 'admins' ? 'admin-only' : 'open to everyone'}.`;
    } catch (error) {
      console.error('Could not update member-add mode:', error.message);
      return 'WhatsApp could not update member-add settings.';
    }
  }

  if (normalizedAction === 'joinapproval') {
    const value = args[0]?.toLowerCase();
    if (!['on', 'off'].includes(value)) return 'Usage: !group joinapproval on|off';
    if (!isGroupAdmin(metadata, socket.user?.id)) return 'Tanjiro must be a group admin to change join approval.';
    try {
      await socket.groupJoinApprovalMode(groupJid, value);
      return `Join approval turned ${value}.`;
    } catch (error) {
      console.error('Could not update join approval:', error.message);
      return 'WhatsApp could not update join-approval settings.';
    }
  }

  if (normalizedAction === 'pending') {
    try {
      const requests = await socket.groupRequestParticipantsList(groupJid);
      return requests.length
        ? ['Pending join requests:', ...requests.map((request) => request.jid)].join('\n')
        : 'There are no pending join requests.';
    } catch (error) {
      console.error('Could not get join requests:', error.message);
      return 'WhatsApp could not retrieve join requests.';
    }
  }

  if (['approve', 'reject'].includes(normalizedAction)) {
    const targets = getMentionedJids(message);
    if (!targets.length) return `Usage: !group ${normalizedAction} <@mention>`;
    if (targets.length > 10) return 'Process up to 10 join requests at a time.';
    if (!isGroupAdmin(metadata, socket.user?.id)) return 'Tanjiro must be a group admin to process join requests.';
    try {
      const result = await socket.groupRequestParticipantsUpdate(
        groupJid,
        targets,
        normalizedAction === 'approve' ? 'approve' : 'reject',
      );
      const failures = result.filter((entry) => entry.status !== '200');
      return failures.length
        ? `Processed requests with ${failures.length} failure(s). Use !group pending to check the rest.`
        : `${normalizedAction === 'approve' ? 'Approved' : 'Rejected'} ${result.length} request(s).`;
    } catch (error) {
      console.error('Could not process join requests:', error.message);
      return 'WhatsApp could not process those join requests.';
    }
  }

  if (normalizedAction === 'leave') {
    const leaveAction = args[0]?.toLowerCase();
    if (leaveAction !== 'confirm') {
      const code = crypto.randomBytes(2).toString('hex').toUpperCase();
      groupLeaveConfirmations.set(groupJid, {
        code,
        requester: normalizeGroupUser(senderJid),
        expiresAt: Date.now() + 60_000,
      });
      return `Tanjiro will leave this group. Confirm within 60 seconds with !group leave confirm ${code}.`;
    }
    const pending = groupLeaveConfirmations.get(groupJid);
    const code = args[1]?.toUpperCase();
    if (!pending || pending.expiresAt < Date.now() || pending.requester !== normalizeGroupUser(senderJid) || pending.code !== code) {
      groupLeaveConfirmations.delete(groupJid);
      return 'That confirmation expired or is invalid. Start again with !group leave.';
    }
    try {
      await socket.groupLeave(groupJid);
      groupLeaveConfirmations.delete(groupJid);
      return '';
    } catch (error) {
      console.error('Could not leave group:', error.message);
      return 'WhatsApp could not remove Tanjiro from this group.';
    }
  }

  if (['welcome', 'goodbye'].includes(normalizedAction)) {
    const value = args[0]?.toLowerCase();
    if (!['on', 'off'].includes(value)) return `Usage: !group ${normalizedAction} on|off`;
    let preferences = settings.groupPreferences.find((group) => group.jid === groupJid);
    if (!preferences) {
      preferences = { jid: groupJid, welcome: false, goodbye: false };
      settings.groupPreferences.push(preferences);
    }
    preferences[normalizedAction] = value === 'on';
    saveSettings();
    return `${normalizedAction === 'welcome' ? 'Welcome messages' : 'Leave messages'} turned ${value}.`;
  }

  if (['announce', 'lock'].includes(normalizedAction)) {
    const value = args[0]?.toLowerCase();
    if (!['on', 'off'].includes(value)) return `Usage: !group ${normalizedAction} on|off`;
    if (!isGroupAdmin(metadata, socket.user?.id)) return 'Tanjiro must be a group admin to change group settings.';
    const setting = normalizedAction === 'announce'
      ? (value === 'on' ? 'announcement' : 'not_announcement')
      : (value === 'on' ? 'locked' : 'unlocked');
    try {
      await socket.groupSettingUpdate(groupJid, setting);
      return `${normalizedAction === 'announce' ? 'Admin-only messaging' : 'Group info editing'} turned ${value}.`;
    } catch (error) {
      console.error('Could not update group settings:', error.message);
      return 'WhatsApp could not update that group setting. Check Tanjiro admin permissions.';
    }
  }

  const actions = { add: 'add', remove: 'remove', kick: 'remove', promote: 'promote', demote: 'demote' };
  const participantAction = actions[normalizedAction];
  if (!participantAction) return 'Usage: !group info|admins|settings|subject|description|invite|ephemeral|addmode|joinapproval|pending|approve|reject|leave|add|remove|promote|demote|announce|lock|welcome|goodbye';
  if (!isGroupAdmin(metadata, socket.user?.id)) return 'Tanjiro must be a group admin to change participants.';

  const mentioned = getMentionedJids(message);
  const typedNumbers = args.join(' ').match(/\d{8,15}/g) || [];
  const targets = participantAction === 'add'
    ? [...new Set(typedNumbers.map((number) => `${number}@s.whatsapp.net`))]
    : (mentioned.length ? mentioned : [...new Set(typedNumbers.map((number) => `${number}@s.whatsapp.net`))]);
  if (!targets.length || targets.length > 10) {
    return `Usage: !group ${normalizedAction} <@mention|phone number> (up to 10 people)`;
  }

  try {
    const results = await socket.groupParticipantsUpdate(groupJid, targets, participantAction);
    const failures = results.filter((result) => result.status !== '200');
    if (failures.length) return `Action completed with ${failures.length} failure(s). Check that the targets and bot permissions are valid.`;
    return `${participantAction} request completed for ${targets.length} participant(s).`;
  } catch (error) {
    console.error('Group participant action failed:', error.message);
    return 'WhatsApp could not complete that participant action. Check admin permissions and the target.';
  }
}

async function handleTagAllCommand(socket, message, text) {
  if (!/^!tagall(?:\s|$)/i.test(text)) return null;
  const groupJid = message.key.remoteJid || '';
  if (!groupJid.endsWith('@g.us')) return 'Tag-all only works inside a WhatsApp group.';

  const [command, actionOrText = '', ...remaining] = text.slice(1).trim().split(/\s+/);
  let metadata;
  try {
    metadata = await socket.groupMetadata(groupJid);
  } catch (error) {
    console.error('Could not read group metadata:', error.message);
    return 'I could not read this group. Please try again.';
  }
  if (!isGroupAdmin(metadata, getSenderJid(message))) return 'Only group admins can tag everyone.';

  if (actionOrText.toLowerCase() === 'confirm') {
    const pending = tagAllConfirmations.get(groupJid);
    const code = remaining[0]?.toUpperCase();
    if (!pending || pending.expiresAt < Date.now() || pending.requester !== normalizeGroupUser(getSenderJid(message)) || pending.code !== code) {
      tagAllConfirmations.delete(groupJid);
      return 'That confirmation expired or is invalid. Start again with !tagall <message>.';
    }
    const mentions = metadata.participants.map((participant) => participant.id)
      .filter((jid) => normalizeGroupUser(jid) !== normalizeGroupUser(socket.user?.id));
    if (mentions.length > 100) return 'This group is too large for a single tag-all. Use a smaller group.';
    const tags = mentions.map((jid) => `@${jid.split('@')[0].split(':')[0]}`).join(' ');
    try {
      await socket.sendMessage(groupJid, { text: `${pending.text}\n${tags}`, mentions });
      tagAllConfirmations.delete(groupJid);
      return '';
    } catch (error) {
      console.error('Could not tag group participants:', error.message);
      return 'WhatsApp could not send the group mention.';
    }
  }

  const announcement = [actionOrText, ...remaining].join(' ').trim();
  if (!announcement) return 'Usage: !tagall <message>';
  if (announcement.length > 300) return 'Tag-all messages must be 300 characters or fewer.';
  const code = crypto.randomBytes(2).toString('hex').toUpperCase();
  tagAllConfirmations.set(groupJid, {
    code,
    text: announcement,
    requester: normalizeGroupUser(getSenderJid(message)),
    expiresAt: Date.now() + 60_000,
  });
  return `This will mention every group member. Confirm within 60 seconds with !tagall confirm ${code}.`;
}

async function handleGroupParticipantUpdate(socket, update) {
  if (!['add', 'remove'].includes(update.action)) return;
  const preferences = settings.groupPreferences.find((group) => group.jid === update.id);
  const enabled = update.action === 'add' ? preferences?.welcome : preferences?.goodbye;
  if (!enabled || !update.participants.length) return;
  const names = update.participants.map((jid) => `@${jid.split('@')[0].split(':')[0]}`).join(', ');
  const text = update.action === 'add' ? `Welcome ${names} to the group!` : `Goodbye ${names}.`;
  try {
    await socket.sendMessage(update.id, { text, mentions: update.participants });
  } catch (error) {
    console.error('Could not send group member notice:', error.message);
  }
}

async function handleStatus(socket, message) {
  if (settings.statusView) {
    try {
      await socket.readMessages([message.key]);
    } catch (error) {
      console.error('Could not mark status as viewed:', error.message);
    }
  }

  if (settings.statusLike && message.key.participant) {
    try {
      await socket.sendMessage(
        'status@broadcast',
        { react: { text: '\u2764\ufe0f', key: message.key } },
        { statusJidList: [message.key.participant] },
      );
    } catch (error) {
      console.error('Could not react to status:', error.message);
    }
  }
}

async function startTanjiro() {
  const { state, saveCreds } = await useMultiFileAuthState(authDirectory);
  isConnected = false;
  const socket = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,
  });
  let pairingCodeRequested = false;
  activeSocket = socket;

  socket.ev.on('creds.update', saveCreds);

  socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr && !state.creds.registered) {
      if (phoneNumber && !pairingCodeRequested) {
        pairingCodeRequested = true;
        try {
          const code = await socket.requestPairingCode(phoneNumber);
          console.log(`Link WhatsApp using this pairing code: ${code}`);
          console.log('On your phone: WhatsApp > Linked devices > Link with phone number.');
        } catch (error) {
          console.error('Could not create a pairing code:', error.message);
          console.log('Scan this QR code from WhatsApp > Linked devices:');
          qrcode.generate(qr, { small: true });
        }
      } else {
        console.log('Scan this QR code from WhatsApp > Linked devices:');
        qrcode.generate(qr, { small: true });
      }
    }

    if (connection === 'open') {
      isConnected = true;
      reconnectAttempts = 0;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      console.log('Tanjiro is ready. Send !help in WhatsApp to see commands.');
    }

    if (connection === 'close') {
      isConnected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        console.error('WhatsApp logged out. Remove the local session and pair again.');
        process.exit(1);
      } else if (shouldReconnect) {
        scheduleReconnect();
      }
    }
  });

  socket.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const message of messages) {
      handleIncomingMessage(socket, message).catch((error) => {
        console.error('Could not process incoming message:', error.message);
      });
    }
  });

  socket.ev.on('group-participants.update', (update) => {
    handleGroupParticipantUpdate(socket, update).catch((error) => {
      console.error('Could not process group participant update:', error.message);
    });
  });
}

async function handleIncomingMessage(socket, message) {
  if (message.key.remoteJid === 'status@broadcast') {
    if (message.message && !message.key.fromMe) await handleStatus(socket, message);
    return;
  }

  if (!message.message || message.key.fromMe) return;
  if (settings.autoRead) {
    socket.readMessages([message.key]).catch((error) => {
      console.error('Could not mark message as read:', error.message);
    });
  }

  const text = getMessageText(message)?.trim();
  if (!text) return;
  if (!text.startsWith('!')) {
    const remoteJid = message.key.remoteJid || '';
    const senderNumber = getSenderJid(message).split('@')[0];
    if (!settings.autoReply || !/@(?:s\.whatsapp\.net|lid)$/.test(remoteJid)) return;
    if (settings.mode === 'private' && senderNumber !== ownerNumber) return;

    const now = Date.now();
    if (now - (autoReplyCooldowns.get(remoteJid) || 0) < 30 * 60_000) return;
    autoReplyCooldowns.set(remoteJid, now);
    const matchingRule = [...settings.autoReplyRules]
      .sort((left, right) => right.keyword.length - left.keyword.length)
      .find((rule) => text.toLowerCase().includes(rule.keyword));
    const reply = matchingRule
      ? formatAutoReply(matchingRule.reply, message)
      : settings.autoReplyAI
        ? await getAIReply(text, message, true) || formatAutoReply(settings.autoReplyMessage, message)
        : formatAutoReply(settings.autoReplyMessage, message);

    try {
      await socket.sendMessage(remoteJid, { text: reply }, { quoted: message });
    } catch (error) {
      autoReplyCooldowns.delete(remoteJid);
      console.error('Could not send auto-reply:', error.message);
    }
    return;
  }

  let reply = await handleGroupCommand(socket, message, text);
  if (reply === null) reply = await handleTagAllCommand(socket, message, text);
  if (reply === null) reply = await handleProfilePictureCommand(socket, message, text);
  if (reply === null) {
    const musicShortcut = /^!play\s+music(?:\s+(.+))?$/i.exec(text);
    if (musicShortcut) {
      const musicArgs = musicShortcut[1] || '';
      const musicCommand = /^(search|play)\s+/i.test(musicArgs)
        ? `!music ${musicArgs}`
        : `!music play ${musicArgs}`;
      reply = await getReply(musicCommand, message);
    } else {
      const gameReply = handleGameCommand(text, message);
      reply = gameReply === null ? await getReply(text, message) : gameReply;
    }
  }
  if (!reply) return;

  try {
    await socket.sendMessage(message.key.remoteJid, { text: reply }, { quoted: message });
  } catch (error) {
    console.error('Could not send reply:', error.message);
  }
}

setInterval(async () => {
  if (!isConnected || !activeSocket || deliveringReminders) return;
  deliveringReminders = true;

  try {
    const dueReminders = reminders.filter((reminder) => reminder.dueAt <= Date.now());
    for (const reminder of dueReminders) {
      try {
        await activeSocket.sendMessage(reminder.jid, {
          text: `Reminder ${reminder.id}: ${reminder.text}`,
        });
        reminders = reminders.filter((item) => item.id !== reminder.id);
        saveReminders();
      } catch (error) {
        console.error(`Could not deliver reminder ${reminder.id}:`, error.message);
      }
    }
  } finally {
    deliveringReminders = false;
  }
}, 15_000);

setInterval(async () => {
  if (!isConnected || !activeSocket || deliveringDailyEvents || !dailyEvents.length) return;
  deliveringDailyEvents = true;

  try {
    const now = new Date();
    const dateKey = getLocalDateKey(now);
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    for (const event of dailyEvents) {
      if (event.lastSentDate === dateKey || currentTime < event.time) continue;
      try {
        await activeSocket.sendMessage(event.jid, { text: event.text });
        event.lastSentDate = dateKey;
        saveDailyEvents();
      } catch (error) {
        console.error(`Could not send daily event ${event.id}:`, error.message);
      }
    }
  } finally {
    deliveringDailyEvents = false;
  }
}, 15_000);

if (phoneNumber && phoneNumber.length < 8) {
  console.error('WHATSAPP_PHONE_NUMBER must include the country code and phone number.');
  process.exit(1);
}

startTanjiro().catch((error) => {
  console.error('Could not start Tanjiro:', error);
  scheduleReconnect();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    shouldReconnect = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    statusServer.close();
    activeSocket?.ws.close();
    process.exit(0);
  });
}

function getSenderJid(message) {
  const jid = message.key.participant || message.key.remoteJid || '';
  const [user = '', server = ''] = jid.split('@');
  return `${user.split(':')[0]}@${server}`;
}

function scrambleWord(word) {
  const letters = word.split('');
  for (let index = letters.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [letters[index], letters[swapIndex]] = [letters[swapIndex], letters[index]];
  }
  const scrambled = letters.join('');
  return scrambled === word ? `${word.slice(1)}${word[0]}` : scrambled;
}

function addGamePoints(message, points) {
  const chatJid = message.key.remoteJid;
  const playerJid = getSenderJid(message);
  let score = gameScores.find((entry) => entry.chatJid === chatJid && entry.playerJid === playerJid);
  if (!score) {
    score = {
      chatJid,
      playerJid,
      name: (message.pushName || 'Player').trim().slice(0, 40),
      points: 0,
    };
    gameScores.push(score);
  }
  if (message.pushName?.trim()) score.name = message.pushName.trim().slice(0, 40);
  score.points += points;
  saveGameScores();
  return score.points;
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function awardDailyChallenge(message, dateKey) {
  const chatJid = message.key.remoteJid;
  const playerJid = getSenderJid(message);
  let score = gameScores.find((entry) => entry.chatJid === chatJid && entry.playerJid === playerJid);
  if (!score) {
    score = {
      chatJid,
      playerJid,
      name: (message.pushName || 'Player').trim().slice(0, 40),
      points: 0,
      dailyStreak: 0,
    };
    gameScores.push(score);
  }

  const previousDate = new Date(`${dateKey}T00:00:00Z`);
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  const yesterday = previousDate.toISOString().slice(0, 10);
  score.dailyStreak = score.lastDailyDate === yesterday ? (score.dailyStreak || 0) + 1 : 1;
  score.lastDailyDate = dateKey;
  score.dailyPoints = (score.dailyPoints || 0) + 5;
  score.points += 5;
  if (message.pushName?.trim()) score.name = message.pushName.trim().slice(0, 40);
  saveGameScores();
  return score;
}

function handleGameCommand(text, message) {
  const [rawCommand = '', ...args] = text.slice(1).trim().split(/\s+/);
  const command = rawCommand.toLowerCase();
  const gameCommands = ['games', 'daily', 'score', 'leaderboard', 'hint', 'guess', 'rps', 'trivia', 'answer', 'hangman', 'letter', 'scramble', 'solve', 'coin', 'dice', 'quit'];
  if (!gameCommands.includes(command)) return null;

  const senderJid = getSenderJid(message);
  const senderNumber = senderJid.split('@')[0];
  if (settings.mode === 'private' && senderNumber !== ownerNumber) return null;

  const key = `${message.key.remoteJid}:${senderJid}`;
  let session = gameSessions.get(key);
  if (session && Date.now() - session.startedAt > 15 * 60_000) {
    gameSessions.delete(key);
    session = undefined;
  }

  switch (command) {
    case 'games':
      return [
        'Games:',
        '!score - View your points in this chat',
        '!leaderboard - See this chat\'s top players',
        '!daily - Take the shared daily trivia challenge for 5 points',
        '!guess - Guess a number from 1 to 100',
        '!rps <rock|paper|scissors> - Play against Tanjiro',
        '!trivia - Answer a trivia question',
        '!hangman - Guess the hidden word one letter at a time',
        '!scramble - Unscramble a word',
        '!coin - Flip a coin',
        '!dice [sides] - Roll a die',
        '!hint - Get one hint during trivia, hangman, or scramble',
        '!quit - End an active game',
      ].join('\n');
    case 'daily': {
      const dateKey = getLocalDateKey();
      const dateNumber = Number(dateKey.replaceAll('-', ''));
      const challenge = triviaQuestions[dateNumber % triviaQuestions.length];
      const score = gameScores.find((entry) => (
        entry.chatJid === message.key.remoteJid && entry.playerJid === senderJid
      ));
      if (score?.lastDailyDate === dateKey) {
        return `You completed today's challenge. Daily streak: ${score.dailyStreak || 1} days. Try again tomorrow!`;
      }
      if (args[0]?.toLowerCase() === 'answer') {
        const answer = args.slice(1).join(' ').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!answer) return 'Usage: !daily answer <answer>';
        if (!challenge.answers.includes(answer)) return 'Not correct. Try again, or use !daily to see the question.';
        const updatedScore = awardDailyChallenge(message, dateKey);
        return `Correct! +5 points. Daily streak: ${updatedScore.dailyStreak} days. Total game score: ${updatedScore.points}.`;
      }
      return `Daily challenge (${dateKey}): ${challenge.question}\nAnswer with !daily answer <answer>. One reward per day.`;
    }
    case 'score': {
      const score = gameScores.find((entry) => (
        entry.chatJid === message.key.remoteJid && entry.playerJid === senderJid
      ));
      return `Your game score in this chat: ${score?.points || 0} points.`;
    }
    case 'leaderboard': {
      const leaders = gameScores
        .filter((entry) => entry.chatJid === message.key.remoteJid)
        .sort((left, right) => right.points - left.points)
        .slice(0, 10);
      if (!leaders.length) return 'No scores yet. Win a game to get on the board!';
      return ['Leaderboard:', ...leaders.map((entry, index) => (
        `${index + 1}. ${entry.name} - ${entry.points} points`
      ))].join('\n');
    }
    case 'hint': {
      if (!session || !['hangman', 'scramble', 'trivia'].includes(session.type)) {
        return 'Start trivia, hangman, or word scramble to use a hint.';
      }
      if (session.hintUsed) return 'You have already used a hint this round.';
      session.hintUsed = true;
      if (session.type === 'hangman') {
        const letter = session.word.split('').find((character) => !session.guessed.includes(character));
        if (!letter) return 'There are no hidden letters left.';
        session.guessed.push(letter);
        const hiddenWord = session.word.split('').map((character) => (
          session.guessed.includes(character) ? character : '_'
        )).join(' ');
        return `Hint: revealed "${letter}".\n${hiddenWord}`;
      }
      if (session.type === 'scramble') {
        return `Hint: starts with "${session.word[0]}" and has ${session.word.length} letters.`;
      }
      return `Hint: the answer starts with "${session.answers[0][0]}".`;
    }
    case 'coin':
      return `Coin flip: ${Math.random() < 0.5 ? 'Heads' : 'Tails'}.`;
    case 'dice': {
      const sidesText = args[0] || '6';
      if (!/^\d+$/.test(sidesText)) return 'Usage: !dice [number of sides]';
      const sides = Number(sidesText);
      if (sides < 2 || sides > 1000) return 'Choose between 2 and 1000 sides.';
      return `Rolled a d${sides}: ${Math.floor(Math.random() * sides) + 1}.`;
    }
    case 'hangman': {
      const word = gameWords[Math.floor(Math.random() * gameWords.length)];
      session = { type: 'hangman', word, guessed: [], wrong: 0, startedAt: Date.now() };
      gameSessions.set(key, session);
      return `Hangman: ${word.replace(/./g, '_ ')}\nGuess a letter with !letter <letter>. You get 6 wrong guesses.`;
    }
    case 'letter': {
      if (!session || session.type !== 'hangman') return 'Start a game with !hangman first.';
      const letter = args[0]?.toLowerCase();
      if (!letter || !/^[a-z]$/.test(letter)) return 'Usage: !letter <single letter>';
      if (session.guessed.includes(letter)) return `You already guessed ${letter}.`;
      session.guessed.push(letter);
      const hiddenWord = session.word.split('').map((character) => (
        session.guessed.includes(character) ? character : '_'
      )).join(' ');
      if (!session.word.includes(letter)) session.wrong += 1;
      if (session.wrong >= 6) {
        gameSessions.delete(key);
        return `Out of guesses. The word was ${session.word}.`;
      }
      const guessedLetters = new Set(session.guessed);
      if ([...session.word].every((character) => guessedLetters.has(character))) {
        gameSessions.delete(key);
        const total = addGamePoints(message, 5);
        return `You got it: ${session.word}! +5 points (total: ${total}).`;
      }
      return `${hiddenWord}\nWrong guesses: ${session.wrong}/6.`;
    }
    case 'scramble': {
      const word = gameWords[Math.floor(Math.random() * gameWords.length)];
      session = { type: 'scramble', word, startedAt: Date.now() };
      gameSessions.set(key, session);
      return `Unscramble this word: ${scrambleWord(word)}\nAnswer with !solve <word>.`;
    }
    case 'solve': {
      if (!session || session.type !== 'scramble') return 'Start a game with !scramble first.';
      const answer = args.join('').toLowerCase().replace(/[^a-z]/g, '');
      if (!answer) return 'Usage: !solve <word>';
      if (answer === session.word) {
        gameSessions.delete(key);
        const total = addGamePoints(message, 3);
        return `Correct! The word was ${session.word}. +3 points (total: ${total}).`;
      }
      return 'Not quite. Try again, or send !quit to end the game.';
    }
    case 'guess': {
      if (!session || session.type !== 'guess') {
        if (args.length) return 'Start a new round with !guess, then send !guess <number>.';
        gameSessions.set(key, {
          type: 'guess',
          target: Math.floor(Math.random() * 100) + 1,
          attempts: 0,
          startedAt: Date.now(),
        });
        return 'I picked a number from 1 to 100. Send !guess <number> to guess.';
      }

      if (!args[0] || !/^\d+$/.test(args[0])) return 'Send a whole number with !guess <number>.';
      const guess = Number(args[0]);
      if (guess < 1 || guess > 100) return 'Choose a number from 1 to 100.';
      session.attempts += 1;
      if (guess === session.target) {
        gameSessions.delete(key);
        const points = Math.max(1, 11 - session.attempts);
        const total = addGamePoints(message, points);
        return `Correct! You got it in ${session.attempts} ${session.attempts === 1 ? 'guess' : 'guesses'}. +${points} points (total: ${total}).`;
      }
      return `${guess < session.target ? 'Higher' : 'Lower'}! Guesses: ${session.attempts}.`;
    }
    case 'rps': {
      const choices = ['rock', 'paper', 'scissors'];
      const playerChoice = args[0]?.toLowerCase();
      if (!choices.includes(playerChoice)) return 'Usage: !rps <rock|paper|scissors>';
      const history = rpsHistory.get(key) || { rock: 0, paper: 0, scissors: 0 };
      const previousChoices = history.rock + history.paper + history.scissors;
      const mostPlayed = choices.filter((choice) => history[choice] === Math.max(...Object.values(history)));
      const counters = { rock: 'paper', paper: 'scissors', scissors: 'rock' };
      const botChoice = previousChoices >= 2 && Math.random() < 0.7
        ? counters[mostPlayed[Math.floor(Math.random() * mostPlayed.length)]]
        : choices[Math.floor(Math.random() * choices.length)];
      history[playerChoice] += 1;
      rpsHistory.set(key, history);
      if (rpsHistory.size > 1000) rpsHistory.delete(rpsHistory.keys().next().value);
      if (playerChoice === botChoice) return `I chose ${botChoice}. It's a tie!`;
      const playerWins = (playerChoice === 'rock' && botChoice === 'scissors')
        || (playerChoice === 'paper' && botChoice === 'rock')
        || (playerChoice === 'scissors' && botChoice === 'paper');
      if (playerWins) {
        const total = addGamePoints(message, 1);
        return `I chose ${botChoice}. You win! +1 point (total: ${total}).`;
      }
      return `I chose ${botChoice}. I win!`;
    }
    case 'trivia': {
      const item = triviaQuestions[Math.floor(Math.random() * triviaQuestions.length)];
      gameSessions.set(key, { type: 'trivia', answers: item.answers, startedAt: Date.now() });
      return `Trivia: ${item.question}\nReply with !answer <answer>.`;
    }
    case 'answer': {
      if (!session || session.type !== 'trivia') return 'Start a question with !trivia first.';
      const answer = args.join(' ').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!answer) return 'Usage: !answer <answer>';
      if (session.answers.includes(answer)) {
        gameSessions.delete(key);
        const total = addGamePoints(message, 3);
        return `Correct! +3 points (total: ${total}). Send !trivia for another question.`;
      }
      return 'Not quite. Try again, or send !quit to end the game.';
    }
    case 'quit':
      if (!session) return 'You do not have an active game.';
      gameSessions.delete(key);
      return 'Game ended. Send !games to choose another.';
    default:
      return null;
  }
}

function parseLocalDate(value) {
  if (!value) return new Date();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const [year, month, day] = value.split('-').map(Number);
  if (year < 100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function getCalendar(value) {
  let year;
  let month;
  if (value) {
    const match = value.match(/^(\d{4})-(\d{2})$/);
    if (!match) return 'Usage: !calendar [YYYY-MM]';
    year = Number(match[1]);
    month = Number(match[2]);
    if (year < 100 || month < 1 || month > 12) return 'Use a valid month in YYYY-MM format.';
  } else {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }

  const monthName = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
    .format(new Date(year, month - 1, 1));
  const rows = ['Su Mo Tu We Th Fr Sa'];
  const cells = Array(7).fill('  ');
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells[(firstWeekday + day - 1) % 7] = String(day).padStart(2, ' ');
    if ((firstWeekday + day) % 7 === 0 || day === daysInMonth) {
      rows.push(cells.join(' '));
      cells.fill('  ');
    }
  }

  return `${monthName}\n${rows.join('\n')}`;
}