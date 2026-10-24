# 🤖 discord-bots

Run your own Discord bots on a tiny Proxmox container, and manage them from a web page.

The **bot machine** is a small Alpine LXC (256 MB RAM, 1 GB disk) for any number of Node.js bots, with `botctl` and a web interface to add, start, stop, update and configure them. A Proxmox script creates the container; the installer also works on any other Alpine machine.

| Folder | Contents |
| --- | --- |
| [`bot-machine/`](bot-machine/) | The bot machine: installer, `botctl` and web interface (any Alpine machine) |
| [`proxmox-helper/`](proxmox-helper/) | Proxmox script ([community-scripts](https://community-scripts.org/) layout) that creates a container and installs the bot machine in it |
| [`jarvis/`](jarvis/) | **Jarvis**, the first bot: roles, moderation, scheduled message clean-up and League of Legends Clash scouting. See [`jarvis/README.md`](jarvis/README.md) for its setup, commands and variables |

## Quick start

**1. Create the bot machine**

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

**2. Add a bot**

Open `http://<container-ip>:8080`, log in, click **Add bot** and enter a name, the bot's git URL and, if the bot lives in a subfolder of the repo, that subfolder. Then open **Variables**, fill in what the bot needs and press **Start**. For Jarvis, follow [`jarvis/README.md`](jarvis/README.md).

## Running the bot machine

**Web interface** (port 8080): all bots with status, start/stop/restart/update (their output goes into the bot's log, also when run with `botctl`, with times in the bot's time zone, `TZ` in its `.env`), logs (with a Clear button), a form for each bot's variables (secrets are write-only), a copy-invite-link button, add and delete. The footer shows whether a newer `botctl` or web interface is available (checked hourly against the install source) and, only then, a Self-update button that runs `botctl self-update`; the page reloads after the restart and asks for the password again. It runs as root over plain HTTP, so use it in a trusted network or behind an HTTPS reverse proxy. The password is in `/etc/botctl-web/password`; five wrong attempts block a client for five minutes.

**`botctl`** does the same inside the container (`pct enter <CTID>`):

```bash
botctl add <name> <git-url> --path <subfolder>   # private repo: https://<token>@github.com/<user>/<repo>.git
botctl env <name>        # edit the bot's .env (e.g. DISCORD_TOKEN, CLIENT_ID)
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
