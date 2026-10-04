# Tanjiro WhatsApp Bot

Tanjiro is a small WhatsApp assistant that responds to commands beginning with `!`.

## Keep Tanjiro Online

A bot running in Termux cannot receive WhatsApp messages while the phone has no internet or the app is stopped. To keep Tanjiro available, run it on an always-on VPS with Docker Engine and Docker Compose; the phone can then be offline while the server has internet.

1. Copy this project to the VPS.
2. Create the environment file with `cp .env.example .env` and edit `.env`. Set `WHATSAPP_PHONE_NUMBER` to the linked WhatsApp account's country code and number using digits only. Leave it empty to use the QR code instead. Set `OPENAI_API_KEY` for AI features and `YOUTUBE_API_KEY` for music search; both are optional.
3. Stop any Tanjiro instance already running in Termux or on another computer. Do not run two copies with the same WhatsApp account.
4. Start the cloud instance with `docker compose up -d --build`.
5. Watch its first-run pairing prompt with `docker compose logs -f tanjiro`.
6. In WhatsApp, open Settings > Linked devices > Link with phone number and enter the pairing code from the server logs. If using QR pairing, scan the QR code from the logs.

Docker Compose stores the linked session, settings, reminders, and game scores in the persistent `tanjiro-data` volume, so container restarts do not require pairing again. Keep that volume and back it up securely; it contains WhatsApp session credentials. Use `docker compose down` to stop the service without deleting its data. The VPS must remain online and have internet access, and WhatsApp can still require the linked device to be paired again if its session expires.

## Free Cloud Deployment (Oracle Always Free)

Oracle Cloud Always Free includes eligible compute resources that can run Tanjiro continuously. Availability depends on region capacity, and Oracle asks for payment details during signup; stay within resources marked Always Free and review the cost estimate before creating anything. The free allocation can change, so verify current limits in the Oracle console.

1. Create an Oracle Cloud Free Tier account and choose the intended home region carefully; Always Free compute is provisioned in that region. Account verification may require a phone number and payment card, but Oracle says the card is not charged unless you upgrade.
2. Create a VM instance using an Ubuntu Arm image and the Ampere A1 Flex shape. Keep the total at or below 2 OCPUs and 12 GB memory for the Always Free allocation. If the shape reports no capacity, try again later or another available home region before creating a paid instance.
3. Add an SSH public key when creating the VM. Connect from your computer using the VM's public IP and your private key.
4. Install Docker Engine and its Compose plugin using Docker's official Ubuntu instructions. Clone this repository onto the VM.
5. In the project folder, copy `.env.example` to `.env`; keep `WHATSAPP_PHONE_NUMBER=233507488053`, and add API keys only for features you use. Protect `.env` because it contains credentials.
6. Run `docker compose up -d --build`, then follow pairing with `docker compose logs -f tanjiro`. Link the code in WhatsApp under Settings > Linked devices > Link with phone number.

The existing Compose file retains the WhatsApp session, settings, reminders, and scores in a named local volume. Keep the VM and volume; deleting the VM deletes this data unless you backed it up. Avoid provisioning resources outside Oracle's Always Free allowance, and monitor the billing dashboard. Cloud capacity and free-tier terms are controlled by Oracle, not this project.

## Deploy on Render

1. Push this project to a GitHub repository connected to your Render account.
2. In Render, create a new Blueprint from that repository and let it read `render.yaml`.
3. Review the worker and persistent-disk pricing, then create the service. The blueprint selects Frankfurt and configures the WhatsApp number `233507488053`.
4. Open the `tanjiro` worker logs. On first startup, use the pairing code in WhatsApp under Settings > Linked devices > Link with phone number.

The Render disk is mounted at `/data` and retains the linked session and bot settings across deploys. Do not create a second running instance with the same WhatsApp account. Add `OPENAI_API_KEY` for AI or `YOUTUBE_API_KEY` for music search in the worker's Environment settings; neither is required for deployment. Render deployments and persistent disks may have charges, so check the current pricing before creating the service. After setup, pushes to the connected branch trigger deployment automatically.

The deployment is a web service so Render assigns it a public URL. Open that URL for the live status page; `/healthz` is the JSON health check and `/api/status` reports WhatsApp connection state and uptime. The status endpoint does not expose controls or credentials. Use an always-on paid plan for reliable WhatsApp availability: Render's free web services can spin down while idle and do not support persistent disks.

## Run on Android

1. Install Termux from F-Droid or the official Termux GitHub releases. Avoid the outdated Play Store build.
2. In Termux, install Node.js: `pkg update && pkg upgrade -y`, then `pkg install nodejs-lts -y`.
3. Copy or clone this project onto the phone, open its folder in Termux, and run `npm install`.
4. Set the WhatsApp number Tanjiro will link to in international format with digits only, including country code. For example: `export WHATSAPP_PHONE_NUMBER=233507488053`. The owner number is already set to `233507488053`.
5. To enable `!ask` and AI auto-replies, set `OPENAI_API_KEY`; to enable music search, set `YOUTUBE_API_KEY` in the Termux environment.
6. Start Tanjiro with `npm start`.
7. In WhatsApp, open Settings > Linked devices > Link with phone number, then enter the pairing code shown in Termux.

If `WHATSAPP_PHONE_NUMBER` is not set, Tanjiro prints a QR code instead; scan it using WhatsApp > Linked devices > Link a device.

Keep Termux running for Tanjiro to stay online. Android may stop background processes to save battery, so allow Termux unrestricted background battery use in Android settings. You can also run `termux-wake-lock` while the bot is active; use `termux-wake-unlock` when you stop it.

The linked-device session is stored in `.tanjiro_auth`, so you do not need to pair again on every start. Do not share that folder; it grants access to the linked session.

## Run on a computer

With Node.js 20 or newer installed, run `npm install` and then `npm start`. Pair using the QR code or phone-number flow above.

The local status page is at `http://localhost:3000` by default, with `/healthz` and `/api/status` endpoints. Docker Compose publishes port 3000.

## Commands

- `!help` - List commands
- `!settings` - Show bot mode, automation toggles, and integration readiness (owner only; secrets are never displayed)
- `!ask <question>` - Ask the AI assistant a question
- `!forget` - Clear your recent in-memory AI conversation context
- `!anime <title>` - Search anime by title and show summaries with AniList links
- `!anime trending` - Browse currently trending anime
- `!group info` - Show the current group's name, size, description, and admins
- `!group admins` - List current group admins
- `!group adminbot` - Check whether Tanjiro is an admin and show how an existing admin can promote it
- `!group add <phone number>` - Add a participant (group admin and bot admin required)
- `!group remove|promote|demote <@mention>` - Change a participant's membership or role (group admin and bot admin required)
- `!group announce on|off` - Restrict/unrestrict who can send messages (group admin and bot admin required)
- `!group lock on|off` - Restrict/unrestrict who can edit group info (group admin and bot admin required)
- `!group welcome on|off` - Toggle join greetings (group admin required)
- `!group goodbye on|off` - Toggle leave notices (group admin required)
- `!welcome on|off` - Shortcut to toggle join greetings in this group
- `!leave on|off` - Shortcut to toggle member departure notices in this group
- `!group settings` - Show current announcement, lock, disappearing-message, add-mode, and approval settings (group admin)
- `!group subject <name>` - Change the group name (group admin and bot admin required)
- `!group description` - Show the current description
- `!group description set <text>` - Set the description (group admin and bot admin required)
- `!group description clear` - Remove the description (group admin and bot admin required)
- `!group invite show` - Get the current invite link (group admin and bot admin required)
- `!group invite revoke` - Revoke the old invite link and create a new one (group admin and bot admin required)
- `!group ephemeral off|24h|7d|90d` - Set disappearing messages (group admin and bot admin required)
- `!group addmode admins|everyone` - Choose who may add members (group admin and bot admin required)
- `!group joinapproval on|off` - Toggle approval for join requests (group admin and bot admin required)
- `!group pending` - List pending join requests (group admin)
- `!group approve <@mention>` - Approve a pending request (group admin and bot admin required)
- `!group reject <@mention>` - Reject a pending request (group admin and bot admin required)
- `!group leave` - Start a one-minute confirmation to make Tanjiro leave
- `!group leave confirm <code>` - Confirm Tanjiro leaving the group
- `!tagall <message>` - Prepare a mention of all members; confirm with the one-minute code (group admin only, up to 100 members)
- `!music search <query>` - Search for music videos on YouTube
- `!music play <query>` - Get the top result link to play
- `!play music <query>` - Shortcut for the top music result
- `!setpp` - Set Tanjiro's profile picture by sending an image with `!setpp` as its caption (owner only; maximum 5 MB)
- `!games` - Show available games
- `!daily` - Get today's shared trivia challenge; answer with `!daily answer <answer>` for 5 points and a streak
- `!event add HH:MM <message>` - Schedule a daily message in the current chat (owner only, 24-hour time)
- `!event list` - List scheduled daily messages (owner only)
- `!event remove <id>` - Remove a scheduled daily message (owner only)
- `!score` - Show your game points in the current chat
- `!leaderboard` - Show the top 10 players in the current chat
- `!guess` - Start a number guessing game from 1 to 100; submit guesses with `!guess <number>`
- `!rps <rock|paper|scissors>` - Play rock-paper-scissors against Tanjiro
- `!trivia` - Ask a trivia question; submit an answer with `!answer <answer>`
- `!hint` - Use one hint in a trivia, hangman, or word scramble round
- `!hangman` - Start hangman; submit letters with `!letter <letter>`
- `!scramble` - Start a word scramble; submit your solution with `!solve <word>`
- `!coin` - Flip a coin
- `!dice [sides]` - Roll a die, defaulting to six sides
- `!quit` - End an active game
- `!ping` - Check whether Tanjiro is online
- `!date [YYYY-MM-DD]` - Show today's date or format a chosen date
- `!time [timezone]` - Show the current date and time, optionally in an IANA timezone such as `Africa/Accra`
- `!timezone` - Show the device's local timezone
- `!calendar [YYYY-MM]` - Show this month's calendar or a chosen month, such as `!calendar 2026-10`
- `!remind <duration> <message>` - Set a reminder, for example `!remind 20m stretch`, `!remind 2h call home`, or `!remind 1d submit report`
- `!reminders` - List your pending reminders
- `!cancelreminder <id>` - Cancel one of your reminders
- `!autoreply on|off` - Enable or disable automatic replies
- `!autoreply ai on|off` - Use AI-generated responses for unmatched direct messages
- `!autoreply set <message>` - Set the automatic reply text
- `!autoreply add <keyword> | <reply>` - Add or update a keyword-specific reply
- `!autoreply remove <keyword>` - Remove a keyword reply
- `!autoreply list` - List saved keyword rules
- `!autoreply show` - Show the current auto-reply settings
- `!about` - Show bot information
- `!echo <message>` - Repeat a message
- `!statusview on|off` - Automatically mark new statuses as viewed
- `!statuslike on|off` - Automatically react to new statuses with a heart
- `!autoread on|off` - Automatically mark incoming chat messages as read
- `!mode public|private` - Allow everyone or only the configured owner to use commands

Status automation, auto-read, and auto-reply are off by default; mode defaults to private. Settings are saved in `.tanjiro_settings.json`. Only `233507488053` can change them. `!autoread` marks incoming chat messages as read; `!statusview` views new status updates. In private mode, non-owner commands are ignored. Existing installations with a saved public mode should run `!mode private` once.

Auto-reply is limited to direct chats, ignores commands and groups, and sends at most one reply per chat every 30 minutes. Set the reply text to 500 characters or fewer. Keyword rules match case-insensitively when an incoming message contains the keyword; the longest matching keyword wins and takes precedence over AI replies. Up to 20 rules are supported, with keywords up to 50 characters and replies up to 500 characters. Use `{name}` and `{time}` in static replies for the sender's WhatsApp display name and the bot's local time. To use AI instead of the default message for unmatched chats, set `OPENAI_API_KEY`, then enable both `!autoreply on` and `!autoreply ai on`. If the AI service is unavailable, Tanjiro uses the default auto-reply message.

Music search uses YouTube Data API v3 and requires `YOUTUBE_API_KEY`. Only the owner can search by default; set `MUSIC_ALLOWED_NUMBERS` to a comma-separated list to allow other numbers. `play` returns a YouTube link for the user to open; Tanjiro does not download or retransmit music audio. YouTube API quota limits apply.

`!ask` requires an OpenAI API key in `OPENAI_API_KEY` and defaults to `gpt-6-astra` with maximum reasoning effort. This can increase latency and API costs. Tanjiro uses a fictional, benevolent mythic-guide voice, without claiming real divinity or omniscience. Configure `OPENAI_MODEL` and `OPENAI_REASONING_EFFORT` to choose another supported model/effort. AI auto-replies use the separate, lower-cost `OPENAI_AUTOREPLY_MODEL` (default: `gpt-4o-mini`). By default, only the bot owner can use `!ask`; set `OPENAI_ALLOWED_NUMBERS` to a comma-separated list of international-format numbers to authorize others. Questions are limited to 4000 characters, the reasoning-plus-answer budget to 6000 output tokens, and each sender has a 10-second cooldown. Explicit `!ask` conversations replay up to 24 recent Responses items (about eight exchanges) held in memory only; `!forget` clears them, and they are lost when the bot restarts. Requests set `store: false` and are sent to OpenAI for processing. GPT-6 Astra is substantially more expensive than the mini model; check current API pricing and set `OPENAI_MODEL` to a lower-cost option if needed. Avoid sending sensitive information.

Guessing, trivia, hangman, and word scramble sessions are separate for each player in each chat and expire after 15 minutes. Game sessions are kept in memory and reset when Tanjiro restarts. RPS tracks recent moves in memory and adapts after two rounds, while retaining randomness. Dice can be configured from 2 to 1000 sides.

Game wins award points: guessing scores more for fewer attempts, trivia and word scramble award 3, hangman awards 5, and a rock-paper-scissors win awards 1. The shared daily trivia challenge awards 5 once per local day and tracks a completion streak. Scores persist in `.tanjiro_scores.json` and leaderboards are separate for each chat. Trivia, hangman, and word scramble each allow one hint per round.

Daily announcements are saved in `.tanjiro_events.json` and sent to the chat where the owner created them. They are delivered once per day at or after the configured time, including after a same-day reconnect. Times use the server timezone (`TZ`); deployments default to UTC. Set `TZ` to an IANA timezone such as `Africa/Accra` if preferred. Up to 20 events are supported, with messages up to 500 characters.

Reminders can be scheduled from 1 minute to 30 days ahead. They are saved in `.tanjiro_reminders.json`, delivered in the chat where they were created, and remain pending while WhatsApp is disconnected. Tanjiro must be running to deliver them; overdue reminders are sent after it reconnects or restarts. `!time` uses the device timezone by default and accepts an IANA timezone name for an alternate view.

When WhatsApp disconnects or startup fails, Tanjiro retries with exponential backoff and jitter, capped at 60 seconds. A successful connection resets the retry delay. If the linked device is logged out, Tanjiro exits so its process supervisor can restart it after the session is repaired.

By default, Tanjiro responds to commands starting with `!`. When auto-reply is enabled, it also responds to ordinary direct messages under the cooldown above. This project uses an unofficial WhatsApp Web protocol client, not Meta's official WhatsApp Business Cloud API. Protocol changes can interrupt it, and automated use may be restricted by WhatsApp. Android Termux is supported; iOS does not allow a local process like this to stay running reliably in the background. For reliable, always-on service or iPhone-based administration, host the bot on a server instead.