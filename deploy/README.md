# BrokerShark — deploy (runtime híbrido)

Modelo de execução (decidido 2026-06-04, ver `CLAUDE.md` → "Modelo de execução"):

- **Dashboard + bot = sob demanda** via launcher. Sobem quando você quer usar, encerram quando você fecha. Nada de daemon eterno.
- **Backup mensal · relatório semanal · fechamento mensal = systemd *user* timers** (`Persistent=true`). Disparam sozinhos enquanto o PC está ligado; se o PC esteve desligado na hora, rodam no **próximo boot** (catch-up). Cada job é um *oneshot* curto (`backend/jobs/*`).

> O antigo `brokershark.service` (sempre-ligado, `multi-user.target`) está **deprecado** — substituído por launcher + timers.

## 1. Launcher (sob demanda)

```bash
./deploy/brokershark.sh      # sobe dashboard + bot e abre http://localhost:8080
```

(Opcional: criar um `.desktop` apontando para esse script.)

## 2. Timers agendados (uma vez)

```bash
# instala as units de usuário
mkdir -p ~/.config/systemd/user
cp deploy/systemd/brokershark-*.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now brokershark-backup.timer \
                               brokershark-weekly-report.timer \
                               brokershark-monthly-closing.timer

# CRÍTICO: sem linger, timers de usuário NÃO disparam o catch-up de boot
# (nem rodam fora de uma sessão logada) → o backup mensal poderia ser pulado em silêncio.
loginctl enable-linger "$USER"
```

Conferir:

```bash
systemctl --user list-timers 'brokershark-*'
systemctl --user start brokershark-backup.service   # testa o backup na mão
journalctl --user -u brokershark-backup.service -n 30
```

Os horários: backup `1º 07:00`, relatório semanal `seg 08:00`, fechamento mensal `1º 08:00`.
As units leem `EnvironmentFile=.env` (precisa do `TELEGRAM_TOKEN`/`TELEGRAM_CHAT_ID` para os relatórios; o backup não usa Telegram).
