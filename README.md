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

**Logs:** Jarvis writes one line per event with local time, level and source, e.g. `2026-10-24 09:35:12 INFO  [bot] /clean [amount] by user (id) in Server (id) #general (id)`. It logs who ran which command where (option names, never their values or message content), connection changes, every cleaner run with the number of deleted messages, every scout with the outcome per player (cached, guessed tag, name search, not found) and OP.GG failures and rate limits, and errors with their Discord error code. Problems Jarvis cannot fix itself, such as missing permissions in the mod log channel, are logged as `WARN` with the channel and the missing permissions. Set `LOG_LEVEL=debug` to also log buttons, every OP.GG call and timings, or `warn` to log only problems. View the log with `botctl logs jarvis` or the **Logs** button of the web interface.

## Running the bot machine

**Web interface** (port 8080): all bots with status, start/stop/restart/update (their output goes into the bot's log, also when run with `botctl`, with times in the bot's time zone, `TZ` in its `.env`), logs (with a Clear button), a form for each bot's variables (secrets are write-only), a copy-invite-link button, add and delete. The footer shows whether a newer `botctl` or web interface is available (checked hourly against the install source) and, only then, a Self-update button that runs `botctl self-update`; the page reloads after the restart and asks for the password again. It runs as root over plain HTTP, so use it in a trusted network or behind an HTTPS reverse proxy. The password is in `/etc/botctl-web/password`; five wrong attempts block a client for five minutes.

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
