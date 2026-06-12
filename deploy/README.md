# BrokerShark — deploy (always-on)

Modelo de execução (decidido 2026-06-11, ver `CLAUDE.md`):

- **Dashboard = serviço systemd *user* sempre ativo** (`brokershark-dashboard.service`,
  `Restart=on-failure`). Abrir `http://localhost:8080` a qualquer momento — nada para
  subir na mão.
- **Backup local diário+mensal = systemd *user* timer** (`brokershark-backup.timer`,
  07/13/19h, `Persistent=true`). Snapshots WAL-safe no HDD secundário
  (`/mnt/HDD_Arquivos/Backups/brokershark`): diário retém 14, mensal retém 12.
  Falha REAL dispara um alerta de desktop (`brokershark-backup-alert.service`,
  via `OnFailure`); skip do mesmo dia não alarma. Confirmar um import também
  atualiza o snapshot do dia em background.

> Telegram bot, IA local (Ollama) e os relatórios semanais/mensais foram **removidos**
> em 2026-06-11 — o produto é o dashboard web + import. O antigo launcher sob demanda
> não existe mais; `brokershark.sh` virou atalho de browser.

## 1. Instalação das units (uma vez)

```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/brokershark-*.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now brokershark-dashboard.service brokershark-backup.timer

# CRÍTICO: sem linger, units de usuário NÃO sobem no boot nem rodam fora de uma
# sessão logada → dashboard e backup morreriam no logout/boot em silêncio.
loginctl enable-linger "$USER"
```

Verificar (os 4 aceites):

```bash
systemctl --user status brokershark-dashboard.service   # active (running)
systemctl --user list-timers 'brokershark-*'            # timer listado
loginctl show-user "$USER" -p Linger                    # Linger=yes
systemctl --user start brokershark-backup.service       # roda o backup AGORA
ls /mnt/HDD_Arquivos/Backups/brokershark/               # snapshot de hoje existe
```

## 2. Uso diário

- Abrir `http://localhost:8080` (ou `./deploy/brokershark.sh`, que garante o serviço
  no ar e abre o browser — bom para um atalho `.desktop`).
- Logs: `journalctl --user -u brokershark-dashboard -f` (o app loga em stdout).
- Reiniciar após `git pull`: `systemctl --user restart brokershark-dashboard`.

### Quando o serviço não sobe

`validate()` falho (ex.: `DB_PATH` inválido) → o processo sai com erro e o systemd
re-tenta até o start-limit; o `status` mostra **start-limit-hit**, e a mensagem REAL
está no journal: `journalctl --user -u brokershark-dashboard -n 30`.

## 3. Backup e restore

- **Saúde do backup:** `systemctl --user --failed` (vazio = ok) e
  `ls -t /mnt/HDD_Arquivos/Backups/brokershark/ | head`. Falha real também dispara
  notificação de desktop.
- **Semântica do timer:** `Persistent=true` repõe execuções **perdidas** (PC
  desligado), não execuções **falhadas** — por isso 3 janelas/dia: HDD desmontado às
  07h é coberto às 13h/19h. `run_backup` é idempotente (1 snapshot/dia).
- **Restore** (PARA o serviço sozinho, restaura com verificação, religa):

```bash
deploy/restore.sh /mnt/HDD_Arquivos/Backups/brokershark/brokershark_2026-06-11.db
```

  Nunca chame `restore_backup` direto com o dashboard no ar — o serviço escreve via
  WAL e o restore seria corrompido/sobrescrito. O script cuida disso: **para o
  serviço primeiro**, restaura (verificação de integridade + sidecar `.pre-restore`
  ao lado do DB) e religa ao final — inclusive em falha, pois nesse caso o banco
  fica intocado.

## 4. Segurança

Bind em `127.0.0.1` + guard de Host/Origin (DNS-rebinding/CSRF) em `server.py`.
Always-on não muda a superfície de rede — só a janela temporal. Units com bloco de
hardening (`NoNewPrivileges`, `ProtectSystem=full`, …). Sem segredos nas units; o
`.env` (gitignored) só carrega `DB_PATH`/`DASHBOARD_PORT`.
