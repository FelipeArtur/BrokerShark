import sqlite3
import csv
import sys
import io
from pathlib import Path
from datetime import datetime

# Allow importing backend modules
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
import config

BASE_DIR = Path(__file__).parent.parent
DB_PATH = config.DB_PATH

def validate_database():
    print("--- Checking Database Integrity ---")
    if not Path(DB_PATH).exists():
        print(f"[FAIL] Database file not found at {DB_PATH}")
        return False
    
    try:
        conn = sqlite3.connect(DB_PATH)
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        print(f"Integrity Check: {integrity}")
        
        fks = conn.execute("PRAGMA foreign_key_check").fetchall()
        if fks:
            print(f"[FAIL] Foreign Key violations found: {fks}")
        else:
            print("Foreign Key Check: OK")
        
        conn.close()
        return integrity == "ok" and not fks
    except Exception as e:
        print(f"[ERROR] Failed to check database: {e}")
        return False

def _check_date(date_str):
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d/%m/%y"):
        try:
            datetime.strptime(date_str.strip(), fmt)
            return True
        except ValueError:
            continue
    return False

def _check_brl_value(val_str):
    if not val_str.strip():
        return False
    cleaned = val_str.strip().replace("R$", "").replace("\xa0", "").strip().replace(".", "").replace(",", ".")
    try:
        float(cleaned)
        return True
    except ValueError:
        return False

def validate_csvs():
    print("\n--- Checking CSV Integrity ---")
    all_ok = True
    
    # 1. Nubank Extrato
    nu_dir = BASE_DIR / "load_data" / "Extrato completo Nubank"
    if nu_dir.exists():
        for f in nu_dir.glob("*.csv"):
            content = f.read_text(encoding="utf-8", errors="replace")
            reader = csv.DictReader(io.StringIO(content))
            for i, row in enumerate(reader, start=2):
                if 'Data' not in row or 'Valor' not in row or 'Descrição' not in row:
                    print(f"[FAIL] {f.name} missing required columns. Found: {list(row.keys())}")
                    all_ok = False
                    break
                if not _check_date(row['Data']):
                    print(f"[WARN] {f.name} line {i}: Invalid date '{row['Data']}'")
                if not _check_brl_value(row['Valor']):
                    print(f"[WARN] {f.name} line {i}: Invalid value '{row['Valor']}'")
    
    # 2. Nubank Fatura
    nu_fat_dir = BASE_DIR / "load_data" / "Fatura Nubank"
    if nu_fat_dir.exists():
        for f in nu_fat_dir.glob("*.csv"):
            content = f.read_text(encoding="utf-8", errors="replace")
            reader = csv.DictReader(io.StringIO(content))
            for i, row in enumerate(reader, start=2):
                if 'date' not in row or 'amount' not in row or 'title' not in row:
                    print(f"[FAIL] {f.name} missing required columns. Found: {list(row.keys())}")
                    all_ok = False
                    break
                if not _check_date(row['date']):
                    print(f"[WARN] {f.name} line {i}: Invalid date '{row['date']}'")
                if not _check_brl_value(row['amount']):
                    print(f"[WARN] {f.name} line {i}: Invalid value '{row['amount']}'")

    # 3. Inter CC
    inter_cc_dir = BASE_DIR / "load_data" / "Fatura banco Inter"
    if inter_cc_dir.exists():
        for f in inter_cc_dir.glob("*.csv"):
            content = f.read_text(encoding="utf-8-sig", errors="replace")
            reader = csv.DictReader(io.StringIO(content), delimiter=",")
            for i, row in enumerate(reader, start=2):
                if 'Data' not in row or 'Valor' not in row or 'Lançamento' not in row:
                    print(f"[FAIL] {f.name} missing required columns. Found: {list(row.keys())}")
                    all_ok = False
                    break
                if not _check_date(row['Data']):
                    print(f"[WARN] {f.name} line {i}: Invalid date '{row['Data']}'")
                if not _check_brl_value(row['Valor']):
                    print(f"[WARN] {f.name} line {i}: Invalid value '{row['Valor']}'")

    # 4. Inter Extrato
    inter_db_dir = BASE_DIR / "load_data" / "Extrato completo Inter"
    if inter_db_dir.exists():
        for f in inter_db_dir.glob("*.csv"):
            content = f.read_text(encoding="utf-8", errors="replace")
            lines = content.splitlines()
            data_start = 0
            for j, line in enumerate(lines):
                if line.startswith("Data Lançamento") or line.startswith("Data La"):
                    data_start = j
                    break
            data_lines = "\\n".join(lines[data_start:])
            reader = csv.DictReader(io.StringIO(data_lines), delimiter=";")
            for i, row in enumerate(reader, start=data_start + 2):
                date_val = row.get('Data Lançamento') or row.get('Data La')
                if not date_val or 'Valor' not in row or 'Descrição' not in row:
                    print(f"[FAIL] {f.name} missing required columns. Found: {list(row.keys())}")
                    all_ok = False
                    break
                if not _check_date(date_val):
                    print(f"[WARN] {f.name} line {i}: Invalid date '{date_val}'")
                if not _check_brl_value(row['Valor']):
                    print(f"[WARN] {f.name} line {i}: Invalid value '{row['Valor']}'")

    if all_ok:
        print("CSV checks completed with no critical structural errors.")
    return all_ok

if __name__ == "__main__":
    db_ok = validate_database()
    csv_ok = validate_csvs()
    if not (db_ok and csv_ok):
        sys.exit(1)
    print("\\n[SUCCESS] Validation Passed!")
