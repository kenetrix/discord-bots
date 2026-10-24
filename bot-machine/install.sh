#!/bin/sh
# Bot machine installer: botctl (manage bots) and its web interface on Alpine Linux.
# Works on any Alpine machine or container, with or without Proxmox. Run as root.
#
#   sh -c "$(wget -qO- https://raw.githubusercontent.com/kenetrix/discord-bots/main/bot-machine/install.sh)"
#
# The same command installs and updates; it is safe to run again at any time.
#
#   install.sh [install|update]       install or refresh everything (default)
#   install.sh uninstall [--purge]    remove botctl and the web interface; with --purge also all bots
#
# From a pipe or from a downloaded copy:  wget -qO- <url>/install.sh | sh -s -- update
#
# Environment (all optional):
#   BOT_MACHINE_URL   where botctl/ and webui/ are downloaded from (default: this repository, branch main)
#   WEBUI_PASSWORD    web interface password; without it one is generated on the first install
#   DESTDIR           install below this directory instead of / (staging; no services are touched)
set -eu

URL="${BOT_MACHINE_URL:-https://raw.githubusercontent.com/kenetrix/discord-bots/main/bot-machine}"
DESTDIR="${DESTDIR:-}"

BOTCTL_BIN="$DESTDIR/usr/local/bin/botctl"
WEB_DIR="$DESTDIR/opt/botctl-web"
CONF_DIR="$DESTDIR/etc/botctl-web"
WEB_INIT="$DESTDIR/etc/init.d/botctl-web"
BOTS_DIR="$DESTDIR/opt/bots"
LOG_DIR="$DESTDIR/var/log/bots"
INIT_DIR="$DESTDIR/etc/init.d"

say() { printf '==> %s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

# Files come from the folder next to this script when it is a checkout, otherwise from URL.
SRC=""
case "$0" in
  */install.sh | install.sh)
    here=$(cd "$(dirname "$0")" && pwd)
    if [ -f "$here/botctl/botctl" ] && [ -f "$here/webui/server.js" ]; then SRC="$here"; fi
    ;;
esac

fetch() { # fetch <path in bot-machine/> <destination>
  if [ -n "$SRC" ]; then
    cp "$SRC/$1" "$2"
  else
    wget -qO "$2" "$URL/$1" || die "Could not download $URL/$1"
  fi
}

check_system() {
  [ "$(id -u)" -eq 0 ] || die "Please run as root."
  command -v apk >/dev/null 2>&1 || die "The bot machine needs Alpine Linux (apk and OpenRC)."
}

install_packages() {
  # tzdata lets botctl write its log lines in the time zone of the bot (TZ in its .env).
  say "Installing packages (bash, git, nodejs, npm, su-exec, nano, tzdata)"
  apk add --no-cache bash git nodejs npm su-exec nano tzdata >/dev/null
}

create_user() {
  say "Creating the bot user and folders"
  addgroup -S bots 2>/dev/null || true
  id bots >/dev/null 2>&1 || adduser -S -D -h /home/bots -s /sbin/nologin -G bots bots
  mkdir -p "$BOTS_DIR" "$LOG_DIR"
  chmod 0750 "$BOTS_DIR" "$LOG_DIR"
  chown bots:bots "$BOTS_DIR" "$LOG_DIR"
}

install_botctl() {
  say "Installing botctl"
  tmp=$(mktemp)
  fetch botctl/botctl "$tmp"
  bash -n "$tmp" || die "The downloaded botctl is not valid."
  mkdir -p "$(dirname "$BOTCTL_BIN")"
  # Replace by rename so a running botctl (for example self-update) is not overwritten in place.
  install -m 0755 "$tmp" "$BOTCTL_BIN.new"
  mv "$BOTCTL_BIN.new" "$BOTCTL_BIN"
  rm -f "$tmp"
}

install_webui() {
  say "Installing the web interface"
  mkdir -p "$WEB_DIR" "$CONF_DIR"
  chmod 0750 "$WEB_DIR" "$CONF_DIR"
  for f in server.js index.html; do
    fetch "webui/$f" "$WEB_DIR/$f.new"
    mv "$WEB_DIR/$f.new" "$WEB_DIR/$f"
  done
  printf '%s\n' "$URL" >"$CONF_DIR/source"

  NEW_PASSWORD=""
  if [ -n "${WEBUI_PASSWORD:-}" ]; then
    NEW_PASSWORD="$WEBUI_PASSWORD"
  elif [ ! -s "$CONF_DIR/password" ]; then
    NEW_PASSWORD=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)
  fi
  if [ -n "$NEW_PASSWORD" ]; then
    printf '%s\n' "$NEW_PASSWORD" >"$CONF_DIR/password"
    chmod 0600 "$CONF_DIR/password"
  fi

  mkdir -p "$INIT_DIR"
  cat >"$WEB_INIT" <<'EOF'
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
EOF
  chmod 0755 "$WEB_INIT"
  if [ -z "$DESTDIR" ]; then
    rc-update add botctl-web default >/dev/null 2>&1 || true
    rc-service botctl-web restart >/dev/null 2>&1 || die "The web interface did not start; see /var/log/botctl-web.log"
  fi
}

summary() {
  ip=$(hostname -i 2>/dev/null | awk '{print $1}')
  say "Done"
  echo "    Web interface:  http://${ip:-<ip-address>}:8080"
  if [ -n "$NEW_PASSWORD" ]; then
    echo "    Password:       $NEW_PASSWORD"
  else
    echo "    Password:       unchanged, stored in /etc/botctl-web/password"
  fi
  echo "    Add a bot:      botctl add <name> <git-url> --path <subfolder>"
  echo "    Update later:   run this command again, or: botctl self-update"
}

cmd_install() {
  check_system
  if [ -z "$DESTDIR" ]; then install_packages; fi
  create_user
  install_botctl
  install_webui
  summary
}

cmd_uninstall() {
  check_system
  purge=0
  [ "${1:-}" = "--purge" ] && purge=1
  say "Removing the web interface and botctl"
  if [ -z "$DESTDIR" ]; then
    rc-service botctl-web stop >/dev/null 2>&1 || true
    rc-update del botctl-web default >/dev/null 2>&1 || true
  fi
  rm -rf "$WEB_INIT" "$WEB_DIR" "$CONF_DIR" "$BOTCTL_BIN" "$DESTDIR/var/log/botctl-web.log"

  if [ "$purge" -eq 1 ]; then
    say "Removing all bots"
    for init in "$INIT_DIR"/bot.*; do
      [ -e "$init" ] || continue
      name=${init##*/bot.}
      if [ -z "$DESTDIR" ]; then
        rc-service "bot.$name" stop >/dev/null 2>&1 || true
        rc-update del "bot.$name" default >/dev/null 2>&1 || true
      fi
      rm -f "$init"
    done
    rm -rf "$BOTS_DIR" "$LOG_DIR"
    if [ -z "$DESTDIR" ]; then
      deluser bots >/dev/null 2>&1 || true
      delgroup bots >/dev/null 2>&1 || true
    fi
  else
    echo "    Bots in /opt/bots keep running as OpenRC services (bot.<name>). Use 'uninstall --purge' to delete them too."
  fi
  say "Done"
}

case "${1:-install}" in
  install | update) cmd_install ;;
  uninstall) shift; cmd_uninstall "$@" ;;
  -h | --help | help) echo "Usage: install.sh [install|update|uninstall [--purge]]" ;;
  *) die "Unknown command '$1'. Use: install, update or uninstall [--purge]." ;;
esac
