# discord-bots

Selbst gehostete Discord-Bots plus ein Proxmox-Script für die „Bot-Maschine“, auf der sie laufen.

| Ordner | Inhalt |
| --- | --- |
| [`bot/`](bot/) | Kens Bot: Rollen, Moderation, Cleanup (Node.js, discord.js v14) |
| [`proxmox/`](proxmox/) | `bot-machine.sh`: legt einen LXC an, in dem beliebig viele Bots laufen |

## Funktionen des Bots

Alle Befehle sind Slash-Commands. Wer sie sieht, regelt Discord über die Standard-Rechte (anpassbar unter *Servereinstellungen → Integrationen*).

| Befehl | Zweck | Recht |
| --- | --- | --- |
| `/role add\|remove` | Rolle vergeben oder entziehen | Rollen verwalten |
| `/rolepanel` | Panel mit bis zu 10 Buttons, über die sich Mitglieder Rollen selbst geben | Rollen verwalten |
| `/kick` | Mitglied kicken | Mitglieder kicken |
| `/ban add\|remove` | Bannen (optional Nachrichten der letzten 7 Tage löschen) oder entbannen | Mitglieder bannen |
| `/timeout add\|remove` | Timeout, z.B. `10m`, `2h`, `1d` (max. 28 Tage) | Mitglieder im Timeout |
| `/warn add\|list\|remove\|clear` | Verwarnungen, gespeichert in SQLite | Mitglieder im Timeout |
| `/purge` | Die letzten 1 bis 500 Nachrichten löschen, optional nur von einem Nutzer | Nachrichten verwalten |
| `/cleaner add\|list\|remove\|run` | Kanäle zeitgesteuert leeren | Nachrichten verwalten |
| `/config modlog` | Kanal fürs Moderations-Log setzen | Server verwalten |

**Cleaner:** Zeitplan als `stündlich`, `täglich` (04:00), `wöchentlich` (Mo 04:00) oder als Cron-Ausdruck, z.B. `30 3 * * *`. Mit `aelter_als_stunden` bleiben neue Nachrichten stehen, z.B. `24` für „alles älter als einen Tag“. Angepinnte Nachrichten bleiben standardmäßig erhalten. Nachrichten älter als 14 Tage kann Discord nur einzeln löschen; der Cleaner macht das mit bis zu 300 Stück pro Lauf und arbeitet den Rest beim nächsten Lauf ab.

## 1. Bot bei Discord anlegen

1. Im [Developer Portal](https://discord.com/developers/applications) eine *New Application* anlegen.
2. Unter **Bot**: *Reset Token* klicken und den Token notieren. Bei *Privileged Gateway Intents* **Server Members Intent** einschalten.
3. Unter **General Information** die *Application ID* notieren.
4. Bot einladen (Application ID einsetzen):
   ```
   https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot+applications.commands&permissions=1099780156422
   ```
5. In den Servereinstellungen die Rolle des Bots **über** die Rollen ziehen, die er vergeben oder moderieren soll.

## 2. Bot-Maschine auf Proxmox anlegen

Auf dem Proxmox-Host als root. Da das Repo privat ist, entweder das Script per `scp` kopieren:

```bash
scp proxmox/bot-machine.sh root@<proxmox-host>:/root/
ssh root@<proxmox-host> bash /root/bot-machine.sh
```

oder direkt mit einem GitHub-Token (fine-grained, nur Lesezugriff auf dieses Repo) laden:

```bash
TOKEN=github_pat_...
bash -c "$(curl -fsSL -H "Authorization: Bearer $TOKEN" \
  https://raw.githubusercontent.com/kenetrix/discord-bots/main/proxmox/bot-machine.sh)"
```

Das Script fragt, ob es die Standardwerte nehmen soll (Debian, 1 Kern, 1024 MB RAM, 8 GB Disk, DHCP auf `vmbr0`) oder ob du sie anpassen willst. Danach installiert es Node.js, git und `botctl` und bietet an, direkt den ersten Bot einzurichten. Dafür fragt es Git-URL, Unterordner (`bot`) und die leeren Werte aus `.env.example` ab.

Ohne Dialoge: `CTID=120 RAM=1024 STORAGE=local-lvm bash bot-machine.sh --yes`

## 3. Bots verwalten (im Container, `pct enter <CTID>`)

```bash
botctl add ken-bot https://<token>@github.com/kenetrix/discord-bots.git --path bot
botctl env ken-bot       # DISCORD_TOKEN, CLIENT_ID, GUILD_ID eintragen
botctl start ken-bot     # registriert Slash-Commands und startet
botctl logs ken-bot
botctl update ken-bot    # git pull, npm ci, Commands neu registrieren, Neustart
botctl list
```

Jeder Bot liegt unter `/opt/bots/<name>/`, läuft als Nutzer `bots` im systemd-Service `bot@<name>` und startet nach einem Neustart automatisch. Ein weiterer Bot braucht nur ein Repo mit `package.json` und einem `start`-Script; ein optionales `deploy-commands`-Script wird bei `start` und `update` ausgeführt.

## Lokal entwickeln

```bash
cd bot
cp .env.example .env     # Werte eintragen; mit GUILD_ID erscheinen Commands sofort
npm install
npm run deploy-commands
npm start
```

`npm run check` validiert alle Command-Definitionen ohne Verbindung zu Discord.
