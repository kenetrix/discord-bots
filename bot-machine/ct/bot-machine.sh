#!/usr/bin/env bash
# Scripts base for runs that did not start from a clone of this repository. The engine
# prefers the clone it was started from (ct/ and install/ next to each other) over this URL.
# The URL points at this folder (bot-machine/); containers created before the move still export the
# repository root, so the folder is appended when missing.
COMMUNITY_SCRIPTS_URL="${COMMUNITY_SCRIPTS_URL:-https://raw.githubusercontent.com/kenetrix/discord-bots/main/bot-machine}"
case "$COMMUNITY_SCRIPTS_URL" in */bot-machine) ;; *) COMMUNITY_SCRIPTS_URL="${COMMUNITY_SCRIPTS_URL%/}/bot-machine" ;; esac
export COMMUNITY_SCRIPTS_URL
_cs_boot="${COMMUNITY_SCRIPTS_CORE_DIR:-$(dirname "${BASH_SOURCE[0]}")/../../../core}/core/build.func"
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
# No bot is installed by default: add bots afterwards with the web interface or botctl.
export var_web_password="${var_web_password:-}"

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

  msg_info "Updating Web Interface"
  local webui_url="${COMMUNITY_SCRIPTS_URL}/webui"
  install -d -m 0750 /opt/botctl-web /etc/botctl-web
  if wget -qO /opt/botctl-web/server.js "$webui_url/server.js" && wget -qO /opt/botctl-web/index.html "$webui_url/index.html"; then
    if [[ ! -f /etc/botctl-web/password ]]; then
      head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20 >/etc/botctl-web/password
      chmod 0600 /etc/botctl-web/password
      NEW_WEBUI=1
    fi
    if [[ ! -f /etc/init.d/botctl-web ]]; then
      cat <<'WEBSERVICE' >/etc/init.d/botctl-web
#!/sbin/openrc-run
description="botctl web interface"
command="/usr/bin/node"
command_args="/opt/botctl-web/server.js"
command_background="yes"
pidfile="/run/botctl-web.pid"
output_log="/var/log/botctl-web.log"
error_log="/var/log/botctl-web.log"

depend() {
  need net
}
WEBSERVICE
      chmod 0755 /etc/init.d/botctl-web
      rc-update add botctl-web default >/dev/null
    fi
    rc-service botctl-web restart >/dev/null 2>&1 || rc-service botctl-web start >/dev/null 2>&1 || true
    msg_ok "Updated Web Interface"
    if [[ -n "${NEW_WEBUI:-}" ]]; then
      echo -e "${INFO}Web interface: http://$(hostname -i | awk '{print $1}'):8080, password: $(cat /etc/botctl-web/password)"
    fi
  else
    msg_warn "Could not update the web interface"
  fi

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
echo -e "${INFO}${YW}Web interface:${CL} ${BGN}http://${IP:-<container-ip>}:8080${CL}"
if [[ -z "$var_web_password" ]]; then
  echo -e "${TAB}${YW}Password:${CL} ${BGN}$(pct exec "$CTID" -- cat /etc/botctl-web/password 2>/dev/null)${CL}"
fi
echo -e "${INFO}${YW}No bot is installed yet. Add one in the web interface, or inside the container (pct enter ${CTID}):${CL}"
echo -e "${TAB}${BGN}botctl add <name> <git-url> --path <subfolder>${CL}"
