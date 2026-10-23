# Project rules

Self-hosted Discord bots plus a Proxmox script for the machine they run on. The bot in `bot/` is called **Jarvis**; `proxmox/bot-machine.sh` creates the LXC that runs it. See `README.md` for setup.

## Language

- Everything in the repository is English: code, comments, docs, commit messages, pull requests, bot replies, log output, error messages, slash command and option names, and the prompts and messages of `proxmox/bot-machine.sh`.

## Commits and pull requests

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`, with types such as `feat`, `fix`, `docs`, `refactor`, `chore`, `test` and `ci`. Use the imperative mood and keep the subject short.
- Group commits logically: each commit is one focused change that makes sense on its own. Several small commits are better than one big one, so do not lump unrelated changes together.
- Do not add `Co-Authored-By` trailers, `Claude-Session` lines or "Generated with Claude Code" footers to commits or pull request descriptions.
- Do not add a visible "Requested by ..." line to pull request descriptions.

## Names

- The bot is called Jarvis. Use `jarvis` for package names, service names and defaults.
- Do not put personal names anywhere in the repository. The only exception is the GitHub login in clone and raw URLs, where it is technically required.

## Checks before pushing

- `cd bot && npm run check` loads and validates all slash commands without connecting to Discord.
- `shellcheck -S warning proxmox/bot-machine.sh` for changes to the Proxmox script.
