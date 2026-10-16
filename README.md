# Discord Music Bot Foundation

A modern Discord bot foundation built using Node.js native ES Modules and `discord.js` v14.

## Prerequisites

- [Node.js](https://nodejs.org/) v16.11.0 or higher (v18, v20, v22, v24+ recommended).
- A Discord Bot Application created via the [Discord Developer Portal](https://discord.com/developers/applications).
  - Copy your **Bot Token**.
  - Copy your **Client ID** (Application ID).
  - Copy your **Guild ID** (Server ID with Developer Mode enabled).
  - **Required Privileged Intent:** Enable **Message Content Intent** under **Discord Developer Portal → Applications → [Your Bot] → Bot → Privileged Gateway Intents**. This is required for text prefix commands to read message content.

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
   ```
   *(Note: `PREFIX` defaults to `!` if omitted)*

> **Security Note:** The `.env` file is excluded from git tracking via `.gitignore`. Never share or commit your bot token.

## Installation

Install required dependencies:

```bash
npm install
```

## Slash-Command Registration

To avoid redundant API calls on startup, command registration is decoupled from bot launch. Register your commands specifically to your development guild using:

```bash
npm run deploy-commands
```

## Commands (Dual Slash & Prefix)

Commands can be invoked either as slash commands or with the configured prefix (default: `!`):
- `/ping` or `!ping`: Responds with `Pong!` and calculates roundtrip latency and WebSocket ping.
- `/help` or `!help`: Lists available commands and displays both invocation styles.

## Running the Bot

### Development Mode (with automatic restart on changes)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```
