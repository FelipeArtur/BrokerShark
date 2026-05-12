# BrokerShark CSV Schemas

This document defines the expected structure of CSV files for BrokerShark ingestion.

## 1. Nubank Extrato (Checking Account)
- **Path:** `load_data/Extrato completo Nubank/*.csv`
- **Delimiter:** `,`
- **Required Columns:** `Data`, `Valor`, `Descrição`
- **Notes:** Standard Nubank CSV export.

## 2. Nubank Fatura (Credit Card)
- **Path:** `load_data/Fatura Nubank/*.csv`
- **Delimiter:** `,`
- **Required Columns:** `date`, `amount`, `title`
- **Notes:** NuBank CC exports use English column names.

## 3. Inter Fatura (Credit Card)
- **Path:** `load_data/Fatura banco Inter/*.csv`
- **Delimiter:** `,`
- **Encoding:** `utf-8-sig` (contains BOM)
- **Required Columns:** `Data`, `Lançamento`, `Valor`
- **Notes:** The second column is the description.

## 4. Inter Extrato (Checking Account)
- **Path:** `load_data/Extrato completo Inter/*.csv`
- **Delimiter:** `;`
- **Required Columns:** `Data Lançamento` (or `Data La`), `Valor`, `Descrição`
- **Notes:** The first 5-6 lines are metadata and must be skipped. The actual CSV data begins on the line starting with "Data Lançamento".
