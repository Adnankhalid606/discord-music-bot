# Discord Music Bot Foundation

A modern Discord bot foundation built using Node.js native ES Modules, `discord.js` v14, `@discordjs/voice`, `ffmpeg-static`, and `yt-dlp`.

## Prerequisites

- [Node.js](https://nodejs.org/) v16.11.0 or higher (v18, v20, v22, v24+ recommended).
- A Discord Bot Application created via the [Discord Developer Portal](https://discord.com/developers/applications).
  - Copy your **Bot Token**.
  - Copy your **Client ID** (Application ID).
  - Copy your **Guild ID** (Server ID with Developer Mode enabled).
  - **Required Privileged Intent:** Enable **Message Content Intent** under **Discord Developer Portal → Applications → [Your Bot] → Bot → Privileged Gateway Intents**. This is required for text prefix commands to read message content.
  - **Required OAuth2 Scope:** When authorizing the bot to your server, you **MUST** include the `applications.commands` scope in addition to `bot`.
  - **Voice Permissions:** The bot must have the **Connect** permission on target voice channels to join.
- **yt-dlp (for Online Music Playback):** Standalone executable used to resolve online tracks and streams.

### Installing yt-dlp on Windows

Choose one of the following methods:

**Method 1: Windows Package Manager (Winget - Recommended)**
```powershell
winget install yt-dlp
```
Restart your terminal after installation so `yt-dlp` is added to your `PATH`.

**Method 2: Standalone Binary**
1. Download `yt-dlp.exe` from the official [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases/latest).
2. Place `yt-dlp.exe` either in a folder included in your system `PATH`, or directly inside the bot directory (e.g. `d:\Tools\discord-music-bot\yt-dlp.exe`).
3. If not in system `PATH`, specify its exact path in `.env`:
   ```env
   YT_DLP_PATH=yt-dlp.exe
   ```

### Why Slash Commands May Not Appear (Reauthorization Steps)

If prefix commands work, but slash commands do not appear in the Discord client:

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Select your application and navigate to **OAuth2 → URL Generator**.
3. Under **SCOPES**, select:
   - [x] `bot`
   - [x] `applications.commands` *(CRITICAL: Without this scope, Discord hides slash commands for your bot in servers)*
4. Under **BOT PERMISSIONS**, select:
   - Send Messages
   - Embed Links
   - Read Message History
   - Connect *(Required for voice channel joining)*
   - Use Slash Commands (Application Commands)
5. Copy the generated authorization URL at the bottom, paste it into your browser, and authorize it for your server (`GUILD_ID`).
6. Run `npm run deploy-commands` to register the slash commands with Discord's API for your development guild.

## Environment Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Populate `.env` with your actual credentials:
   ```env
   DISCORD_TOKEN=your_bot_token_here
   CLIENT_ID=your_client_id_here
   GUILD_ID=your_development_guild_id_here
   PREFIX=!
   YT_DLP_PATH=yt-dlp
   COMMAND_TIMING_LOGS=true
   ```
   *(Note: `PREFIX` defaults to `!`, `YT_DLP_PATH` defaults to `yt-dlp`, and `COMMAND_TIMING_LOGS` defaults to `true`)*

> **Security Note:** The `.env` file is excluded from git tracking via `.gitignore`. Never share or commit your bot token.

## Installation

Install required dependencies:

```bash
npm install
```

## Local Audio Setup

Audio files for local playback can be placed in the root `audio/` directory:

1. Place your audio files (e.g., `track.mp3`, `demo.wav`) in the `audio/` folder.
2. Supported formats: MP3, WAV, OGG, Opus, FLAC, AAC, M4A, WebM.
3. Media files placed in `audio/` are excluded from git tracking via `.gitignore`.
4. Path traversal (e.g., `../`, subdirectories, absolute paths) is strictly blocked for security.

## Slash-Command Registration

To avoid redundant API calls and rate-limiting on startup, command registration is decoupled from bot launch. Register your commands specifically to your development guild using:

```bash
npm run deploy-commands
```

The deployment script:
- Loads the runtime command definitions dynamically.
- Verifies the commands using Discord REST PUT for `Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)`.
- Logs the target guild, command count, and command names.
- Catches and reports actionable explanations for any Discord REST errors (e.g. 401 Unauthorized, 50001 Missing Access, 10004 Unknown Guild).
- Redacts sensitive tokens from all error output.

## Automated Testing

Run the automated test suite using Node's built-in test runner:

```bash
npm test
```
*Tests use mocks and do not require active internet or Discord connections.*

## Project Architecture & Directory Structure

```text
discord-music-bot/
├── audio/                          # Local audio files storage
├── src/
│   ├── commands/                   # Categorized bot commands
│   │   ├── music/                  # Audio playback commands
│   │   │   ├── pause.js
│   │   │   ├── play.js
│   │   │   ├── playfile.js
│   │   │   ├── resume.js
│   │   │   └── stop.js
│   │   ├── utility/                # Bot utility & diagnostic commands
│   │   │   ├── help.js
│   │   │   └── ping.js
│   │   └── voice/                  # Voice connection lifecycle commands
│   │       ├── join.js
│   │       └── leave.js
│   ├── config/                     # Environment configuration & validation
│   ├── events/                     # Discord gateway event handlers
│   ├── handlers/                   # Recursive command discovery & loading
│   ├── music/                      # Voice connection, track resolver, & audio player managers
│   ├── scripts/                    # Slash-command deployment script
│   ├── utils/                      # Reusable embeds & diagnostic command timers
│   └── index.js                    # Application entry point & client lifecycle
├── test/                           # Automated test suites
├── .env.example                    # Environment template
└── package.json
```

## Commands (Dual Slash & Prefix)

Commands follow a consistent modern UI built with Discord's `EmbedBuilder` and can be invoked either as slash commands or with the configured prefix (default: `!`):

### Utility (`src/commands/utility/`)
- `/ping` or `!ping`: Measures roundtrip latency, Discord gateway WebSocket ping, local execution time, and HTTP REST response time.
- `/help` or `!help`: Redesigned Command Explorer dynamically grouped by category (Utility, Voice, Music) with dual invocation syntax, argument templates, and usage examples.

### Voice (`src/commands/voice/`)
- `/join` or `!join`: Connects the bot to the voice channel you are currently in. Validates channel presence and `Connect` permissions, reuses active connections, handles moving channels, and waits for connection readiness.
- `/leave` or `!leave`: Disconnects the bot from the current voice channel and tears down connection and player tracking cleanly.

### Music (`src/commands/music/`)
- `/play query:<song title or URL>` or `!play <song title or URL>`: Searches YouTube or resolves a video URL via standalone `yt-dlp` and streams audio directly into your voice channel.
- `/playfile file:<filename>` or `!playfile <filename>`: Validates and plays a local audio file from the `audio/` directory. Automatically connects to your voice channel if not already connected.
- `/pause` or `!pause`: Pauses active audio playback.
- `/resume` or `!resume`: Resumes paused audio playback.
- `/stop` or `!stop`: Stops audio playback and releases resources while keeping the bot connected in voice.

## Troubleshooting

- **`yt-dlp executable was not found`**:
  - Run `yt-dlp --version` in your terminal to verify installation.
  - If installed outside your system `PATH`, configure the full path in `.env`:
    `YT_DLP_PATH=C:\path\to\yt-dlp.exe`
- **`The requested video is unavailable or restricted`**:
  - The video may be private, age-restricted, or geo-blocked by YouTube. Try another search query or URL.
- **`Search and stream resolution timed out`**:
  - Check your internet connectivity or whether YouTube is temporarily rate-limiting requests.
- **Stream Drops or Expiration**:
  - YouTube media stream URLs are dynamic. If playback stops unexpectedly, reissue `/play` to resolve a fresh stream URL.

## Manual Testing Checklist

To manually verify voice and online audio playback in your Discord server:

1. **Verify yt-dlp**: Ensure `yt-dlp --version` works in your terminal (or `YT_DLP_PATH` is configured in `.env`).
2. **Start the bot**: `npm run dev`
3. **Test Online Playback**:
   - Join a voice channel (e.g., "General").
   - Run `/play query:Bohemian Rhapsody` or `!play Bohemian Rhapsody`.
   - Confirm the bot joins the voice channel, resolves the track, and begins streaming audio.
   - Confirm the bot sends a `Now Playing` embed containing the linked title, duration, uploader, and channel name.
4. **Test Direct URL**:
   - Run `/play query:https://www.youtube.com/watch?v=dQw4w9WgXcQ`.
   - Confirm direct video URLs resolve and play cleanly.
5. **Test Pause & Resume**:
   - Run `/pause` (or `!pause`) to pause playback.
   - Run `/resume` (or `!resume`) to resume playback.
6. **Test Stop**:
   - Run `/stop` (or `!stop`).
   - Confirm audio stops and resources are released, but the bot remains connected in voice.
7. **Test Local Playfile**:
   - Run `/playfile file:sample.mp3` or `!playfile sample.mp3`.
   - Confirm existing local playback continues working smoothly alongside online playback.
8. **Test Disconnect**:
   - Run `/leave` (or `!leave`).
   - Confirm the bot disconnects and cleans up all voice and player states.

## Running the Bot

### Development Mode (with automatic restart on changes)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```
