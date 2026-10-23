# discord-bots

Self-hosted Discord bots (starting with Jarvis) plus a Proxmox script for the "bot machine" they run on.

| Folder | Contents |
| --- | --- |
| [`bot/`](bot/) | Jarvis: roles, moderation, cleanup (Node.js, discord.js v14) |
| [`proxmox/`](proxmox/) | `bot-machine.sh`: creates an LXC that runs any number of bots |

## Bot features

All commands are slash commands. Who can see them is controlled by Discord's default permissions (adjustable under *Server Settings → Integrations*).

| Command | Purpose | Permission |
| --- | --- | --- |
| `/role add\|remove` | Give or take a role | Manage Roles |
| `/rolepanel` | Panel with up to 10 buttons that let members assign roles to themselves | Manage Roles |
| `/kick` | Kick a member | Kick Members |
| `/ban add\|remove` | Ban (optionally deleting the last 7 days of messages) or unban | Ban Members |
| `/timeout add\|remove` | Timeout, e.g. `10m`, `2h`, `1d` (max. 28 days) | Timeout Members |
| `/warn add\|list\|remove\|clear` | Warnings, stored in SQLite | Timeout Members |
| `/purge` | Delete the last 1 to 500 messages, optionally only from one user | Manage Messages |
| `/cleaner add\|list\|remove\|run` | Clear channels on a schedule | Manage Messages |
| `/config modlog` | Set the moderation log channel | Manage Server |

**Cleaner:** The schedule is `hourly`, `daily` (at 04:00), `weekly` (Mondays at 04:00) or a cron expression such as `30 3 * * *`. With `older_than_hours`, recent messages are kept, e.g. `24` for "everything older than one day". Pinned messages are kept by default. Discord only allows messages older than 14 days to be deleted one at a time; the cleaner deletes up to 300 of those per run and continues with the rest on the next run.

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

Run on the Proxmox host as root. Since the repo is private, either copy the script with `scp`:

```bash
scp proxmox/bot-machine.sh root@<proxmox-host>:/root/
ssh root@<proxmox-host> bash /root/bot-machine.sh
```

or load it directly with a GitHub token (fine-grained, read-only access to this repo):

```bash
TOKEN=github_pat_...
bash -c "$(curl -fsSL -H "Authorization: Bearer $TOKEN" \
  https://raw.githubusercontent.com/kenetrix/discord-bots/main/proxmox/bot-machine.sh)"
```

The script asks whether to use the defaults (Debian, 1 core, 1024 MB RAM, 8 GB disk, DHCP on `vmbr0`) or let you adjust them. It then installs Node.js, git and `botctl`, and offers to set up the first bot right away. For that it asks for the git URL, the subfolder (`bot`) and the empty values from `.env.example`.

Without dialogs: `CTID=120 RAM=1024 STORAGE=local-lvm bash bot-machine.sh --yes`

## 3. Manage bots (inside the container, `pct enter <CTID>`)

```bash
botctl add jarvis https://<token>@github.com/kenetrix/discord-bots.git --path bot
botctl env jarvis        # enter DISCORD_TOKEN, CLIENT_ID, GUILD_ID
botctl start jarvis      # registers slash commands and starts the bot
botctl logs jarvis
botctl update jarvis     # git pull, npm ci, re-register commands, restart
botctl list
```

Each bot lives in `/opt/bots/<name>/`, runs as user `bots` in the systemd service `bot@<name>` and starts automatically after a reboot. Another bot only needs a repo with a `package.json` and a `start` script; an optional `deploy-commands` script runs on `start` and `update`.

## Local development

```bash
cd bot
cp .env.example .env     # fill in values; with GUILD_ID, commands show up instantly
npm install
npm run deploy-commands
npm start
```

`npm run check` validates all command definitions without connecting to Discord.
