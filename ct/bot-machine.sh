#!/usr/bin/env bash
# Compatibility stub. The scripts moved to proxmox-helper/ct/. Containers created before the move run
# `update`, which still downloads this path, so it forwards to the new script. Safe to delete once
# every container has been recreated from proxmox-helper/ct/bot-machine.sh.
BASE="https://raw.githubusercontent.com/kenetrix/discord-bots/main/proxmox-helper"
here="${BASH_SOURCE[0]}"
if [[ -f "$here" && -f "$(dirname "$here")/../proxmox-helper/ct/bot-machine.sh" ]]; then
  exec bash "$(dirname "$here")/../proxmox-helper/ct/bot-machine.sh" "$@"
fi
export COMMUNITY_SCRIPTS_URL="$BASE"
exec bash -c "$(curl -fsSL "$BASE/ct/bot-machine.sh")" bot-machine.sh "$@"
