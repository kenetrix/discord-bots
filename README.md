# 🤖 discord-bots

Run your own Discord bots on a tiny Proxmox container, and manage them from a web page.

- **Jarvis** is the first bot: roles, moderation and scheduled message clean-up (Node.js, discord.js v14).
- **Bot machine** is a Proxmox script that creates a small Alpine LXC (256 MB RAM, 1 GB disk) for any number of bots, with a web interface to start, stop, update and configure them.

| Folder | Contents |
| --- | --- |
| [`jarvis/`](jarvis/) | The Jarvis bot |
| [`bot-machine/`](bot-machine/) | Proxmox scripts ([community-scripts](https://community-scripts.org/) layout) and the web interface |

## Quick start

**1. Create the bot in Discord**

1. In the [Developer Portal](https://discord.com/developers/applications), create a *New Application* named `Jarvis`.
2. Under **Bot**: *Reset Token* and note the token. Under *Privileged Gateway Intents*, enable **Server Members Intent**.
3. Under **General Information**, note the *Application ID*.

**2. Create the bot machine** (on the Proxmox host, as root)

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kenetrix/discord-bots/main/bot-machine/ct/bot-machine.sh)"
```

The usual community-scripts dialogs apply (default or advanced settings, storage, network). At the end you get the address and password of the web interface.

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
| `/config` | Settings panel, e.g. the moderation log channel | Manage Server |
| `/role add\|remove` | Give or take a role | Manage Roles |
| `/rolepanel` | Panel with up to 10 buttons for self-service roles | Manage Roles |
| `/ban add\|remove` | Ban (optionally deleting the last 7 days of messages) or unban | Ban Members |
| `/timeout add\|remove` | Timeout, e.g. `10m`, `2h`, `1d` (max. 28 days) | Timeout Members |
| `/clean` | Delete messages in this channel now | Manage Messages |
| `/cleaner add\|add-voice\|list\|remove\|run` | Scheduled clean-up jobs | Manage Messages |

**`/clean`** only reaches messages younger than 14 days. Options: `amount` (1 to 500), `user`, `later_than` (only the last X hours), `keep_latest` (keep the newest N messages) and `keep_pinned` (default: yes).

**`/cleaner`** runs jobs on a schedule: `hourly`, `daily` (04:00), `weekly` (Mondays, 04:00) or a cron expression like `30 3 * * *`. `add-voice` covers the chats of all voice channels of the server. Options: `older_than_hours`, `keep_latest` and `keep_pinned`. Messages older than 14 days are deleted one by one, up to 300 per run.

## Running the bot machine

**Web interface** (port 8080): all bots with status, start/stop/restart/update, logs, a form for each bot's variables (secrets are write-only), a copy-invite-link button, add and delete. It runs as root over plain HTTP, so use it in a trusted network or behind an HTTPS reverse proxy. The password is in `/etc/botctl-web/password`; five wrong attempts block a client for five minutes.

**`botctl`** does the same inside the container (`pct enter <CTID>`):

```bash
botctl add <name> <git-url> --path <subfolder>   # private repo: https://<token>@github.com/<user>/<repo>.git
botctl env <name>        # edit DISCORD_TOKEN, CLIENT_ID, GUILD_ID
botctl start <name>      # registers slash commands and starts the bot
botctl logs <name>
botctl update <name>     # git pull, npm ci, re-register commands, restart if running
botctl update-all
botctl list
```

Each bot lives in `/opt/bots/<name>/`, runs as user `bots` in the OpenRC service `bot.<name>` and starts after a reboot. Any repo with a `package.json` and a `start` script works; an optional `deploy-commands` script runs on `start` and `update`.

**Updating:** run `update` inside the container. It refreshes `botctl` and the web interface, updates all bots and the Alpine packages. If it fails, `botctl update-all` still works.

**Settings:** the machine defaults to Alpine 3.24, 1 core, 256 MB RAM, 1 GB disk (about 350 MB used, estimated). Override with `var_*` variables, e.g. `var_ram=512 var_disk=2`. `var_web_password` sets the web interface password instead of a generated one. To run the script from a clone instead, use `bash discord-bots/bot-machine/ct/bot-machine.sh`.

## Development

```bash
cd jarvis
cp .env.example .env     # fill in the values
npm install
npm run deploy-commands
npm start
```

`npm run check` validates all command definitions without connecting to Discord.
