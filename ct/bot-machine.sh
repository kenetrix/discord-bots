#!/usr/bin/env bash
# Scripts base for runs that did not start from a clone of this repository. The engine
# prefers the clone it was started from (ct/ and install/ next to each other) over this URL.
export COMMUNITY_SCRIPTS_URL="${COMMUNITY_SCRIPTS_URL:-https://raw.githubusercontent.com/kenetrix/discord-bots/main}"
_cs_boot="${COMMUNITY_SCRIPTS_CORE_DIR:-$(dirname "${BASH_SOURCE[0]}")/../../core}/core/build.func"
# shellcheck source=/dev/null
source "$_cs_boot" 2>/dev/null || source <(curl -fsSL "${COMMUNITY_SCRIPTS_CORE_URL:-https://raw.githubusercontent.com/community-scripts/core/main}/core/build.func")
# Source: https://discord.js.org/ | Github: https://github.com/kenetrix/discord-bots

APP="Bot-Machine"
var_tags="${var_tags:-bots;discord;nodejs}"
var_cpu="${var_cpu:-1}"
var_ram="${var_ram:-256}"
var_disk="${var_disk:-1}"
var_os="${var_os:-alpine}"
var_version="${var_version:-3.24}"
var_unprivileged="${var_unprivileged:-1}"

# Application settings. The install script reads them from the environment; all are optional.
# Credentials are never stored in the script or in the defaults file, pass them per run.
export var_bot_name="${var_bot_name:-jarvis}"
export var_bot_repo="${var_bot_repo:-https://github.com/kenetrix/discord-bots.git}"
export var_bot_path="${var_bot_path-bot}"
export var_bot_repo_token="${var_bot_repo_token:-}"
export var_discord_token="${var_discord_token:-}"
export var_discord_client_id="${var_discord_client_id:-}"
export var_discord_guild_id="${var_discord_guild_id:-}"

header_info "$APP"
variables
color
catch_errors

update_alpine() {
  if [[ ! -x /usr/local/bin/botctl || ! -d /opt/bots ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi

  # botctl lives inside the install script; extract the current version from the repository.
  msg_info "Updating botctl"
  local tmp
  tmp=$(mktemp)
  if wget -qO- "${COMMUNITY_SCRIPTS_URL}/install/bot-machine-install.sh" |
    sed -n "/^cat <<'BOTCTL'/,/^BOTCTL/p" | sed '1d;$d' >"$tmp" && bash -n "$tmp" && [[ -s "$tmp" ]]; then
    install -m 0755 "$tmp" /usr/local/bin/botctl
    msg_ok "Updated botctl"
  else
    msg_warn "Could not fetch botctl, keeping the installed version"
  fi
  rm -f "$tmp"

  msg_info "Updating Bots"
  $STD botctl update-all
  msg_ok "Updated Bots"

  msg_info "Updating Alpine Packages"
  $STD apk -U upgrade
  msg_ok "Updated Alpine Packages"

  msg_ok "Updated successfully!"
  exit
}

function update_script() {
  header_info
  check_container_storage
  check_container_resources
  run_os_update
}

start
build_container
description

msg_ok "Completed successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW}Manage the bots inside the container (pct enter ${CTID}) with:${CL}"
echo -e "${TAB}${BGN}botctl list${CL}"
if [[ -z "$var_discord_token" || -z "$var_discord_client_id" ]]; then
  echo -e "${TAB}${BGN}botctl env ${var_bot_name}${CL}"
  echo -e "${TAB}${BGN}botctl start ${var_bot_name}${CL}"
else
  echo -e "${TAB}${BGN}botctl logs ${var_bot_name}${CL}"
fi
