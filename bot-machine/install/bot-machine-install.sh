#!/usr/bin/env bash

# Source: https://discord.js.org/ | Github: https://github.com/kenetrix/discord-bots

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

setup_deb_based() {
  msg_error "${APP:-Bot-Machine} runs on Alpine only. Use var_os=alpine."
  exit 1
}

# The bot machine itself (botctl, web interface, service) comes from its own installer,
# bot-machine/install.sh, which also works on any other Alpine machine. This script only
# provides the container around it. Optional input: var_web_password.
setup_alpine() {
  local base="${COMMUNITY_SCRIPTS_URL:-https://raw.githubusercontent.com/kenetrix/discord-bots/main/bot-machine}"
  [[ "$base" == */bot-machine ]] || base="${base%/}/bot-machine"

  msg_info "Installing Bot Machine"
  wget -qO /tmp/bot-machine-install.sh "$base/install.sh"
  $STD env BOT_MACHINE_URL="$base" WEBUI_PASSWORD="${var_web_password:-}" sh /tmp/bot-machine-install.sh install
  rm -f /tmp/bot-machine-install.sh
  msg_ok "Installed Bot Machine"
}

run_os_setup

motd_ssh
customize
cleanup_lxc
