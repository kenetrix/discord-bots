# Jarvis

Discord bot for roles, moderation, scheduled message clean-up and League of Legends Clash scouting (Node.js, discord.js v14).

Jarvis is meant to run on the [bot machine](../README.md), but any machine with Node.js 20 or newer works.

## Setup

**1. Create the bot in Discord**

1. In the [Developer Portal](https://discord.com/developers/applications), create a *New Application* named `Jarvis`.
2. Under **Bot**: *Reset Token* and note the token. Under *Privileged Gateway Intents*, enable **Server Members Intent**.
3. Under **General Information**, note the *Application ID*.

**2. Add it to the bot machine**

In the web interface, click **Add bot** and enter:

| Field | Value |
| --- | --- |
| Name | `jarvis` |
| Git URL | `https://github.com/kenetrix/discord-bots.git` |
| Subfolder | `jarvis` |

Or with `botctl`: `botctl add jarvis https://github.com/kenetrix/discord-bots.git --path jarvis`.

Then open **Variables** (or `botctl env jarvis`), enter `DISCORD_TOKEN` and `CLIENT_ID`, and press **Start**. The **Invite** button opens the invite page; afterwards drag the bot's role **above** the roles it should assign or moderate.

**Variables** (`.env`, see [`.env.example`](.env.example)):

| Variable | Meaning |
| --- | --- |
| `DISCORD_TOKEN` | Bot token (Bot → Reset Token) |
| `CLIENT_ID` | Application ID (General Information) |
| `GUILD_ID` | Optional: server ID, so new slash commands show up instantly, on that server only |
| `TZ` | Time zone for cleaner schedules and log times, e.g. `Europe/Berlin` |
| `DB_PATH` | Optional: path to the SQLite file (default `./data/bot.db`) |
| `SCOUT_REGION` | Optional: default League of Legends server for `/scout` (default `EUW`) |
| `LOG_LEVEL` | Optional: `debug`, `info` (default), `warn` or `error` |
| `OPGG_MCP_URL`, `OPGG_SEARCH_URL` | Optional: override the OP.GG MCP endpoint and name search URL |

## Commands

All commands are slash commands; Discord's default permissions decide who sees them (adjustable under *Server Settings → Integrations*). When Jarvis joins a server, it posts the settings panel as its first message.

| Command | What it does | Permission |
| --- | --- | --- |
| `/config` | Settings panel: the moderation log channel (only channels where Jarvis has View Channel, Send Messages and Embed Links are offered) and the cleaner jobs with their settings | Manage Server |
| `/role add\|remove` | Give or take a role | Manage Roles |
| `/rolepanel` | Panel with up to 10 buttons for self-service roles | Manage Roles |
| `/ban add\|remove` | Ban (optionally deleting the last 7 days of messages) or unban | Ban Members |
| `/timeout add\|remove` | Timeout, e.g. `10m`, `2h`, `1d` (max. 28 days) | Timeout Members |
| `/clean` | Delete messages in this channel now | Manage Messages |
| `/cleaner add\|add-voice\|list\|remove\|run` | Scheduled clean-up jobs | Manage Messages |
| `/scout` | Scout a Clash enemy team and post ban and pick advice | Everyone |

**`/clean`** only reaches messages younger than 14 days. Options: `amount` (1 to 500), `user`, `later_than` (only the last X hours), `keep_latest` (keep the newest N messages) and `keep_pinned` (default: yes).

**`/cleaner`** runs jobs on a schedule: `hourly`, `daily` (04:00), `weekly` (Mondays, 04:00) or a cron expression like `30 3 * * *`. `add-voice` covers the chats of all voice channels of the server. Options: `older_than_hours`, `keep_latest` and `keep_pinned`. `remove` and `run` take the job's number from `/cleaner list` (the same numbers `/config` shows, always 1 to n, with autocomplete); after a job is deleted, the jobs after it move up one number. Messages older than 14 days are deleted one by one, up to 300 per run.

**`/scout`** takes up to five Riot IDs (`Name#TAG`, tag optional) in the options `summoner1` to `summoner5`, in any order, plus an optional `region` (default `EUW`, or `SCOUT_REGION`). Jarvis looks the players up on [OP.GG](https://op.gg) through its public [MCP server](https://github.com/opgginc/opgg-mcp) (no API key) and posts ban and counter-pick advice per lane into the text chat of your voice channel, or into the current channel. Buttons under the report show player and ban details only to the person who clicks.

- A name without tag is tried with the region's default tag, then with OP.GG's name search (unofficial, may break); Jarvis tells you which account it picked.
- Roles come from each player's recent games, not from the input order.
- Player data is cached for 30 minutes, matchups for 6 hours. Each user can scout once a minute, one scout per server at a time.
- Players that could not be scouted are listed in the report and in the reply.

## Logs

Jarvis writes one line per event with local time, level and source, e.g. `2026-10-24 09:35:12 INFO  [bot] /clean [amount] by user (id) in Server (id) #general (id)`. It logs who ran which command where (option names, never their values or message content), connection changes, every cleaner run with the number of deleted messages, every scout with the outcome per player (cached, guessed tag, name search, not found) and OP.GG failures and rate limits, and errors with their Discord error code. Problems Jarvis cannot fix itself, such as missing permissions in the mod log channel, are logged as `WARN` with the channel and the missing permissions. Set `LOG_LEVEL=debug` to also log buttons, every OP.GG call and timings, or `warn` to log only problems. On the bot machine, view the log with `botctl logs jarvis` or the **Logs** button of the web interface.

## Development

```bash
cd jarvis
cp .env.example .env     # fill in the values
npm install
npm run deploy-commands
npm start
```

`npm run check` validates all command definitions without connecting to Discord, and `npm test` runs the tests.
