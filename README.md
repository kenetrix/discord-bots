# 🤖 discord-bots

Run your own Discord bots on a tiny Proxmox container, and manage them from a web page.

- **Jarvis** is the first bot: roles, moderation, scheduled message clean-up and League of Legends Clash scouting (Node.js, discord.js v14).
- **Bot machine** is a Proxmox script that creates a small Alpine LXC (256 MB RAM, 1 GB disk) for any number of bots, with a web interface to start, stop, update and configure them.

| Folder | Contents |
| --- | --- |
| [`jarvis/`](jarvis/) | The Jarvis bot |
| [`bot-machine/`](bot-machine/) | The bot machine: installer, `botctl` and web interface (any Alpine machine) |
| [`proxmox-helper/`](proxmox-helper/) | Proxmox script ([community-scripts](https://community-scripts.org/) layout) that creates a container and installs the bot machine in it |

## Quick start

**1. Create the bot in Discord**

1. In the [Developer Portal](https://discord.com/developers/applications), create a *New Application* named `Jarvis`.
2. Under **Bot**: *Reset Token* and note the token. Under *Privileged Gateway Intents*, enable **Server Members Intent**.
3. Under **General Information**, note the *Application ID*.

**2. Create the bot machine**

On Proxmox, one command on the host (as root) creates the container and installs everything:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kenetrix/discord-bots/main/proxmox-helper/ct/bot-machine.sh)"
```

The usual community-scripts dialogs apply (default or advanced settings, storage, network).

On any other Alpine Linux machine or container, as root, the installer does the same without Proxmox (it installs Node.js and git, `botctl`, the web interface and its service):

```bash
sh -c "$(wget -qO- https://raw.githubusercontent.com/kenetrix/discord-bots/main/bot-machine/install.sh)"
```

Both end with the address and password of the web interface.

**3. Add Jarvis**

Open `http://<container-ip>:8080`, log in, click **Add bot** and enter:

| Field | Value |
| --- | --- |
| Name | `jarvis` |
| Git URL | `https://github.com/kenetrix/discord-bots.git` |
| Subfolder | `jarvis` |

Then open **Variables**, enter `DISCORD_TOKEN` and `CLIENT_ID` (optionally `GUILD_ID`, which makes new commands show up instantly), and press **Start**. The **Invite** button opens the invite page; afterwards drag the bot's role **above** the roles it should assign or moderate.

## Jarvis commands

All commands are slash commands; Discord's default permissions decide who sees them (adjustable under *Server Settings → Integrations*). When Jarvis joins a server, it posts the settings panel as its first message.

| Command | What it does | Permission |
| --- | --- | --- |
| `/config` | Settings panel, e.g. the moderation log channel (only channels Jarvis can post in are offered; the others are listed with the permissions it needs) | Manage Server |
| `/role add\|remove` | Give or take a role | Manage Roles |
| `/rolepanel` | Panel with up to 10 buttons for self-service roles | Manage Roles |
| `/ban add\|remove` | Ban (optionally deleting the last 7 days of messages) or unban | Ban Members |
| `/timeout add\|remove` | Timeout, e.g. `10m`, `2h`, `1d` (max. 28 days) | Timeout Members |
| `/clean` | Delete messages in this channel now | Manage Messages |
| `/cleaner add\|add-voice\|list\|remove\|run` | Scheduled clean-up jobs | Manage Messages |
| `/scout` | Scout a Clash enemy team and post ban and pick advice | Everyone |

**`/clean`** only reaches messages younger than 14 days. Options: `amount` (1 to 500), `user`, `later_than` (only the last X hours), `keep_latest` (keep the newest N messages) and `keep_pinned` (default: yes).

**`/cleaner`** runs jobs on a schedule: `hourly`, `daily` (04:00), `weekly` (Mondays, 04:00) or a cron expression like `30 3 * * *`. `add-voice` covers the chats of all voice channels of the server. Options: `older_than_hours`, `keep_latest` and `keep_pinned`. Messages older than 14 days are deleted one by one, up to 300 per run.

**`/scout`** takes up to five Riot IDs (`Name#TAG`, e.g. from the Clash scouting phase; a name without tag is first tried with the region's default tag such as `#EUW` or `#NA1`; if no such account exists, Jarvis looks the name up with the name search of the OP.GG website, like typing it into op.gg, and tells the person who ran the command which account it found; if several accounts share the name, it takes the one that played in the last 30 days with the highest solo queue rank and lists the others in the player's detail view) and an optional `region` (default `EUW`, or `SCOUT_REGION`). Jarvis looks the players up on [OP.GG](https://op.gg) through its public [MCP server](https://github.com/opgginc/opgg-mcp) (no API key needed; the name search is an unofficial part of the website and can stop working when OP.GG changes it, then names without tag only work with a default tag) and posts a report into the text chat of the voice channel you are in, or into the current channel if you are not in one. The report names players that could not be scouted first (also in the reply to the person who ran the command), then five priority bans (the most dangerous champions of all enemies by threat, weighted by rank, with no limit per player), then one block per lane: the enemy expected there, the bans (and backups) aimed at them, and the champion our player in that lane should pick (a counter to the enemy's likely champion after our bans) plus an alternative. Player details are only behind the buttons. Buttons under the report open a detail view only for the person who clicks: per player (link to their OP.GG page, rank, threat (high, medium or low; rank first, then games and win rate on their best champion), champion pool with games and win rate, our bans marked 🚫 and the likely pick after the bans marked ➜, main and second role matchups, roles of the last 20 games, our bans on them) or for the bans (reason per ban, backups and tips). Each detail view has an Overview button to go back. Buttons work for three hours or until Jarvis restarts. Every enemy gets at least one ban (their most dangerous champion); the rest favour champions a player has many games and a high win rate on, with at most three bans aimed at one player. Roles come from each player's last 20 games, and predicted picks and counter picks stay with champions OP.GG sees in that role. The report takes about 10 to 15 seconds. Jarvis keeps player data for 30 minutes and matchup data for 6 hours, so scouting the same team again is instant. Each user can scout once a minute, and only one scout runs per server at a time. If a player is unknown, OP.GG limits requests or does not answer, Jarvis says so instead of posting a half-empty report.

**Logs:** Jarvis writes one line per event with local time, level and source, e.g. `2026-10-24 09:35:12 INFO  [bot] /clean [amount] by user (id) in Server (id) #general (id)`. It logs who ran which command where (option names, never their values or message content), connection changes, every cleaner run with the number of deleted messages, every scout with the outcome per player (cached, guessed tag, name search, not found) and OP.GG failures and rate limits, and errors with their Discord error code. Problems Jarvis cannot fix itself, such as missing permissions in the mod log channel, are logged as `WARN` with the channel and the missing permissions. Set `LOG_LEVEL=debug` to also log buttons, every OP.GG call and timings, or `warn` to log only problems. View the log with `botctl logs jarvis` or the **Logs** button of the web interface.

## Running the bot machine

**Web interface** (port 8080): all bots with status, start/stop/restart/update, logs (with a Clear button), a form for each bot's variables (secrets are write-only), a copy-invite-link button, add and delete. The footer shows whether a newer `botctl` or web interface is available (checked hourly against the install source) and has a Self-update button that runs `botctl self-update`; the page reloads after the restart and asks for the password again. It runs as root over plain HTTP, so use it in a trusted network or behind an HTTPS reverse proxy. The password is in `/etc/botctl-web/password`; five wrong attempts block a client for five minutes.

**`botctl`** does the same inside the container (`pct enter <CTID>`):

```bash
botctl add <name> <git-url> --path <subfolder>   # private repo: https://<token>@github.com/<user>/<repo>.git
botctl env <name>        # edit DISCORD_TOKEN, CLIENT_ID, GUILD_ID
botctl start <name>      # registers slash commands and starts the bot
botctl logs <name>
botctl clear-logs <name> # empty the log
botctl update <name>     # git pull, npm ci, re-register commands, restart if running
botctl update-all
botctl list
```

Each bot lives in `/opt/bots/<name>/`, which holds only the bot's own files (the `--path` subfolder of the repo), its `.env`, `data/` and `node_modules/`. No copy of the repository is kept: `add` and `update` download only that subfolder into a temporary folder, copy its files over and delete the download. Files git does not track are never touched. Where a bot comes from (URL, branch, subfolder, version) and which files `botctl` put in place is stored in the info file `/opt/bots/<name>/.botctl` (readable by root only). Each bot runs as user `bots` in the OpenRC service `bot.<name>` and starts after a reboot. Any repo with a `package.json` and a `start` script works; an optional `deploy-commands` script runs on `start` and `update`.

**Updating:** on a Proxmox container run `update` inside it: it refreshes `botctl` and the web interface, updates all bots and the Alpine packages. On any machine, `botctl self-update` (or running the installer again) refreshes `botctl` and the web interface, and `botctl update-all` updates the bots.

**Uninstalling:** `sh install.sh uninstall` removes `botctl` and the web interface and leaves the bots running; add `--purge` to delete all bots too. Download `install.sh` first (`wget -O install.sh <url>`) or pipe it: `wget -qO- <url>/install.sh | sh -s -- uninstall`.

**Settings:** the machine defaults to Alpine 3.24, 1 core, 256 MB RAM, 1 GB disk (about 350 MB used, estimated). Override with `var_*` variables, e.g. `var_ram=512 var_disk=2`. `var_web_password` (Proxmox) or `WEBUI_PASSWORD` (installer) sets the web interface password instead of a generated one. To run the script from a clone instead, use `bash discord-bots/proxmox-helper/ct/bot-machine.sh` (installer: `sh discord-bots/bot-machine/install.sh`).

## Development

```bash
cd jarvis
cp .env.example .env     # fill in the values
npm install
npm run deploy-commands
npm start
```

`npm run check` validates all command definitions without connecting to Discord.
