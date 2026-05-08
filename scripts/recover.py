"""Database recovery — lists and downloads backup files from Google Drive.

Usage:
    .venv/bin/python scripts/recover.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from dotenv import load_dotenv
load_dotenv()

from integrations import drive
import config


def main() -> None:
    print("BrokerShark — Recuperação de backup")
    print("=" * 45)

    backups = drive.list_backups()
    if not backups:
        print("Nenhum backup encontrado no Google Drive.")
        return

    print(f"\nBackups disponíveis na pasta '{config.DRIVE_BACKUP_FOLDER}':\n")
    for i, f in enumerate(backups):
        size_mb = int(f.get("size", 0)) / 1024 / 1024
        print(f"  [{i + 1}] {f['name']}  ({size_mb:.1f} MB)  —  criado: {f['createdTime'][:10]}")

    print()
    raw = input("Qual número deseja baixar? (Enter para cancelar): ").strip()
    if not raw:
        print("Cancelado.")
        return

    try:
        idx = int(raw) - 1
        chosen = backups[idx]
    except (ValueError, IndexError):
        print("Opção inválida.")
        return

    dest = Path("data") / f"brokershark_recovered_{chosen['name'].replace('brokershark_', '')}"
    print(f"\nBaixando {chosen['name']} para {dest} ...")
    ok = drive.download_backup(chosen["id"], str(dest))
    if ok:
        print(f"\n✅ Arquivo salvo em: {dest}")
        print("\nPróximos passos:")
        print("  1. Pare o BrokerShark (Ctrl+C ou systemctl stop brokershark)")
        print(f"  2. cp {dest} {config.DB_PATH}")
        print("  3. Reinicie o BrokerShark")
    else:
        print("❌ Falha ao baixar o arquivo. Verifique logs/drive_errors.log")


if __name__ == "__main__":
    main()
