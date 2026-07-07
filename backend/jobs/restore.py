"""Entrypoint: safe operational restore of a local backup.

    PYTHONPATH=backend python -m jobs.restore             # list, pick, confirm (interactive)
    PYTHONPATH=backend python -m jobs.restore --latest    # restore the newest monthly backup
    PYTHONPATH=backend python -m jobs.restore --list      # just list backups, change nothing
    PYTHONPATH=backend python -m jobs.restore <path>      # restore a specific backup file
    PYTHONPATH=backend python -m jobs.restore --latest --yes   # skip the confirmation prompt

This is the safe wrapper the deleted ``deploy/restore.sh`` used to provide.
The money-critical guard: it REFUSES to run while the dashboard is serving
— restoring while the app holds the DB open (WAL) corrupts it. The dashboard is the
only process that opens this DB, so "is the port serving?" is the authoritative
liveness check for this architecture.

The restore itself (``core.backup.restore_backup``) verifies the backup's integrity,
copies the current DB to a ``.pre-restore`` sidecar (the undo path), and atomically
swaps the backup in. Exit codes: ``0`` restored, ``2`` refused (app live / no backup
/ declined / bad input), ``1`` the restore itself failed.
"""
import argparse
import socket
import sys
from pathlib import Path

from bootstrap import bootstrap

import config
from core import backup as core_backup

_MONTHLY_GLOB = "brokershark_????-??.db"


def _dashboard_serving() -> bool:
    """True if something accepts connections on the dashboard port (app is live)."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", config.DASHBOARD_PORT)) == 0


def _list_backups() -> list[Path]:
    """Monthly backups in the backup dir, newest first."""
    return sorted(Path(config.LOCAL_BACKUP_DIR).glob(_MONTHLY_GLOB), reverse=True)


def _print_backups(backups: list[Path]) -> None:
    """List backups with index + size for the interactive picker / --list."""
    if not backups:
        print(f"Nenhum backup em {config.LOCAL_BACKUP_DIR}")
        return
    print(f"Backups em {config.LOCAL_BACKUP_DIR} (mais novo primeiro):")
    for i, b in enumerate(backups):
        size_mb = b.stat().st_size / (1024 * 1024)
        print(f"  [{i}] {b.name}  ({size_mb:.1f} MB)")


def _resolve_target(args: argparse.Namespace, backups: list[Path]) -> Path | None:
    """Pick the backup to restore from args (path / --latest) or an interactive prompt."""
    if args.path:
        return Path(args.path)
    if args.latest:
        return backups[0] if backups else None
    if not backups:
        return None
    if not sys.stdin.isatty():
        print("Sem TTY para escolher: passe um caminho, --latest, ou rode interativo.")
        return None
    _print_backups(backups)
    raw = input(f"Qual restaurar? [0-{len(backups) - 1}, Enter=0, q=sair] ").strip().lower()
    if raw in ("q", "quit", "sair"):
        return None
    if raw == "":
        return backups[0]
    if not raw.isdigit() or int(raw) >= len(backups):
        print("Índice inválido.")
        return None
    return backups[int(raw)]


def _confirm(target: Path, assume_yes: bool) -> bool:
    """Confirm the destructive swap. Fail closed without a TTY unless --yes is given."""
    if assume_yes:
        return True
    if not sys.stdin.isatty():
        print("Sem TTY para confirmar; rode com --yes se tem certeza.")
        return False
    print(f"\nRestaurar  {target.name}")
    print(f"  sobre    {config.DB_PATH}")
    print(f"  (o DB atual é salvo em {config.DB_PATH}.pre-restore antes do swap)")
    return input("Confirmar? [s/N] ").strip().lower() in ("s", "sim", "y", "yes")


def main() -> int:
    """Run the guarded restore; return the process exit code."""
    bootstrap()
    parser = argparse.ArgumentParser(prog="python -m jobs.restore",
                                     description="Restaura um backup local com segurança (app parado).")
    parser.add_argument("path", nargs="?", help="caminho de um backup específico")
    parser.add_argument("--latest", action="store_true", help="restaura o backup mais novo")
    parser.add_argument("--list", action="store_true", help="lista os backups e sai")
    parser.add_argument("--yes", action="store_true", help="pula a confirmação")
    args = parser.parse_args()

    backups = _list_backups()
    if args.list:
        _print_backups(backups)
        return 0

    # Fail-closed guard: never restore under a live writer (corrupts the DB).
    if _dashboard_serving():
        print(f"⛔ O dashboard está rodando na porta {config.DASHBOARD_PORT}. "
              "Pare o app primeiro (Ctrl+C no terminal do ./run.sh) e rode de novo —\n"
              "   restaurar com o app escrevendo corromperia o banco. Abortado.")
        return 2

    target = _resolve_target(args, backups)
    if target is None:
        print("Nada para restaurar.")
        return 2
    if not target.exists():
        print(f"Backup não encontrado: {target}")
        return 2
    if not core_backup.verify_backup(str(target)):
        print(f"⛔ Backup falhou no integrity-check, não vou restaurar: {target}")
        return 2

    if not _confirm(target, args.yes):
        print("Cancelado.")
        return 2

    if core_backup.restore_backup(str(target)):
        print(f"\n✅ Restaurado de {target.name}.")
        print(f"   DB anterior salvo em: {config.DB_PATH}.pre-restore")
        print("      (desfazer = copie esse arquivo de volta sobre o .db, app parado)")
        print("   Agora suba o app:  ./run.sh")
        return 0
    print("❌ Restore falhou (ver logs). O .pre-restore preserva o DB anterior.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
