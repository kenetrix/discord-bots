# Project rules

Self-hosted Discord bots plus a Proxmox script for the machine they run on. The bot in `jarvis/` is called **Jarvis**; `proxmox-helper/ct/bot-machine.sh` and `proxmox-helper/install/bot-machine-install.sh` (community-scripts layout) create the LXC that runs it, and `bot-machine/` is the application installed in it. See `README.md` for the bot machine and `jarvis/README.md` for the bot (setup, commands, variables).

## Language

- Everything in the repository is English: code, comments, docs, commit messages, pull requests, bot replies, log output, error messages, slash command and option names, and the messages of the scripts in `proxmox-helper/` and `bot-machine/`.

## Commits and pull requests

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`, with types such as `feat`, `fix`, `docs`, `refactor`, `chore`, `test` and `ci`. Use the imperative mood and keep the subject short.
- Group commits logically: each commit is one focused change that makes sense on its own. Several small commits are better than one big one, so do not lump unrelated changes together.
- Do not commit file by file. Put all files that share the same context into one commit (for example a script, its docs and its tests together) and only split commits where the context really differs.
- Do not add `Co-Authored-By` trailers, `Claude-Session` lines or "Generated with Claude Code" footers to commits or pull request descriptions.
- Do not add a visible "Requested by ..." line to pull request descriptions.
- Do not open a new pull request for every change. If an open pull request covers the same context (for example another small change to the web interface), add the change as a new commit to its branch instead.

## Names

- The bot is called Jarvis. Use `jarvis` for package names, service names and defaults.
- Do not put personal names anywhere in the repository. The only exception is the GitHub login in clone and raw URLs, where it is technically required.

## Checks before pushing

- `cd jarvis && npm run check` loads and validates all slash commands without connecting to Discord.
- `shellcheck -S warning proxmox-helper/ct/bot-machine.sh proxmox-helper/install/bot-machine-install.sh` and `shellcheck -s sh -S warning bot-machine/install.sh` for changes to the scripts.

## Proxmox scripts

- Keep the community-scripts structure inside `proxmox-helper/`: `ct/<app>.sh` sources the engine (`build.func`) and sets `APP` and the `var_*` defaults, `install/<app>-install.sh` sources `$FUNCTIONS_FILE_PATH` and runs inside the container. See https://community-scripts.org/docs/ct/detailed_guide and https://community-scripts.org/docs/install/detailed_guide.
- Credentials are read from the environment (`var_*`), never stored in the repo.
- `proxmox-helper/` only provides the Proxmox environment and call the installer. All bot machine logic (packages, user, service, password, update, uninstall) lives in `bot-machine/install.sh`, `bot-machine/botctl/` and `bot-machine/webui/`, which must stay usable on any Alpine machine without Proxmox. `install.sh` is POSIX `sh` (Alpine has no bash before it installs it) and must stay idempotent.
