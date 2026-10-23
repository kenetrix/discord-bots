# discord-bots

Self-hosted Discord bots (starting with Jarvis) plus a Proxmox script for the "bot machine" they run on.

| Folder | Contents |
| --- | --- |
| [`jarvis/`](jarvis/) | Jarvis: roles, moderation, cleanup (Node.js, discord.js v14) |
| [`bot-machine/`](bot-machine/) | Proxmox scripts in the [community-scripts](https://community-scripts.org/) layout (`ct/`, `install/`) plus the web interface (`webui/`): create an LXC that runs any number of bots |

## Bot features

All commands are slash commands. Who can see them is controlled by Discord's default permissions (adjustable under *Server Settings → Integrations*).

| Command | Purpose | Permission |
| --- | --- | --- |
| `/role add\|remove` | Give or take a role | Manage Roles |
| `/rolepanel` | Panel with up to 10 buttons that let members assign roles to themselves | Manage Roles |
| `/ban add\|remove` | Ban (optionally deleting the last 7 days of messages) or unban | Ban Members |
| `/timeout add\|remove` | Timeout, e.g. `10m`, `2h`, `1d` (max. 28 days) | Timeout Members |
| `/clean` | Delete messages in the current channel right now | Manage Messages |
| `/cleaner add\|add-voice\|list\|remove\|run` | Scheduled clean-up jobs | Manage Messages |
| `/config` | Settings dashboard with menus, e.g. for the moderation log channel | Manage Server |

**Clean:** `/clean` deletes messages in the current channel immediately and only reaches messages younger than 14 days. Options: `amount` (1 to 500, default: everything it can reach), `user` (only this user), `later_than` (only messages from the last X hours), `keep_latest` (always keep the newest N messages) and `keep_pinned` (default: yes).

**Cleaner:** `/cleaner` only manages the scheduled jobs. `/cleaner add-voice` clears the chats of all voice channels of the server on a schedule (channels where the bot lacks View Channel, Read Message History or Manage Messages are skipped). The schedule is `hourly`, `daily` (at 04:00), `weekly` (Mondays at 04:00) or a cron expression such as `30 3 * * *`. With `older_than_hours`, recent messages are kept, e.g. `24` for "everything older than one day". `keep_latest` always keeps the newest N messages of each channel. Pinned messages are kept by default. Discord only allows messages older than 14 days to be deleted one at a time; the cleaner deletes up to 300 of those per run and continues with the rest on the next run.

## 1. Create the bot in Discord

1. Create a *New Application* named `Jarvis` in the [Developer Portal](https://discord.com/developers/applications).
2. Under **Bot**: click *Reset Token* and note the token. Under *Privileged Gateway Intents*, enable **Server Members Intent**.
3. Under **General Information**, note the *Application ID*.
4. Invite the bot (insert the Application ID):
   ```
   https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot+applications.commands&permissions=1099780156422
   ```
5. In the server settings, drag the bot's role **above** the roles it should assign or moderate.

## 2. Create the bot machine on Proxmox

The scripts follow the layout of the [community-scripts](https://community-scripts.org/) project: `bot-machine/ct/bot-machine.sh` runs on the Proxmox host and creates the container, `bot-machine/install/bot-machine-install.sh` runs inside it. They use the community-scripts engine (`build.func`), so the usual dialogs (default settings, advanced settings, storage, network) work as in any community script.

Run on the Proxmox host as root. Since this repository is private, clone it with a GitHub token (fine-grained, read-only access to this repo) and start the script from the clone, which makes it use the `install/` script next to it:

```bash
git clone https://<token>@github.com/kenetrix/discord-bots.git
bash discord-bots/bot-machine/ct/bot-machine.sh
```

Once the repository is public, the community-scripts one-liner works as well:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kenetrix/discord-bots/main/bot-machine/ct/bot-machine.sh)"
```

Defaults: Alpine 3.24, 1 core, 256 MB RAM, 1 GB disk, unprivileged. The install is lean: no compiler is needed because `better-sqlite3` ships prebuilt binaries for Alpine (musl). Node.js, git, bash and the bot's `node_modules` (about 55 MB) should add up to roughly 350 MB on disk (estimate, not measured), so 1 GB leaves room for updates and the database. The scripts support Alpine only. Override them with the usual `var_*` variables, for example `var_ram=512 var_disk=2 bash discord-bots/bot-machine/ct/bot-machine.sh`.

The install script sets up Node.js, git, `botctl` and the web interface. **No bot is installed**: add your bots afterwards in the web interface or with `botctl add` (section 3). The only input is optional and is read from the environment; nothing is stored in the repo or in the defaults file:

| Variable | Meaning | Default |
| --- | --- | --- |
| `var_web_password` | Password of the web interface | generated, stored in `/etc/botctl-web/password` |

### Web interface

The container also runs a small web interface (`bot-machine/webui/`, Node.js built-ins only) on port 8080: `http://<container-ip>:8080`. It shows all bots with their status and offers start, stop, restart, update, logs, a form for the bot's environment variables (secret values such as the token are write-only and never shown again), a button that copies the Discord invite link to the clipboard, adding a bot from a Git URL (for Jarvis: this repository's URL and the subfolder `jarvis`), deleting a bot and "Update all". The password is printed at the end of the installation and stored in `/etc/botctl-web/password`; after five wrong attempts a client is blocked for five minutes.

The interface runs as root inside the container because `botctl` needs it and speaks plain HTTP, so only expose it in a trusted network or behind a reverse proxy with HTTPS. Restart it with `rc-service botctl-web restart`.

## 3. Manage bots (inside the container, `pct enter <CTID>`)

```bash
botctl add jarvis https://github.com/kenetrix/discord-bots.git --path jarvis
                         # for a private repo: https://<token>@github.com/<user>/<repo>.git
botctl env jarvis        # enter DISCORD_TOKEN, CLIENT_ID, GUILD_ID
botctl start jarvis      # registers slash commands and starts the bot
botctl logs jarvis
botctl update jarvis     # git pull, npm ci, re-register commands, restart if running
botctl update-all        # the same for every bot
botctl list
```

Each bot lives in `/opt/bots/<name>/`, runs as user `bots` in the OpenRC service `bot.<name>` (log: `/var/log/bots/<name>.log`) and starts automatically after a reboot. Another bot only needs a repo with a `package.json` and a `start` script; an optional `deploy-commands` script runs on `start` and `update`.

The community-scripts `update` command inside the container re-runs `bot-machine/ct/bot-machine.sh`, which refreshes `botctl` from this repository, then updates all bots and the OS packages. It fetches the script from the repository, so it only works while the repository is publicly readable; `botctl update-all` always works. Containers created before the scripts moved into `bot-machine/` keep calling the old path `ct/bot-machine.sh`, which is a small stub that forwards to the new script.

## Local development

```bash
cd jarvis
cp .env.example .env     # fill in values; with GUILD_ID, commands show up instantly
npm install
npm run deploy-commands
npm start
```

`npm run check` validates all command definitions without connecting to Discord.
