/**
 * @file csv.ts
 * @brief Parser CSV genérico (RFC-4180 mínimo) usado por todos os parsers de extrato.
 */

/**
 * @brief Fatiar um texto CSV em linhas de campos.
 *
 * Parser CSV RFC-4180 mínimo (aspas, delimitador configurável, BOM). Sem deps.
 *
 * Trata aspas duplas escapadas (""), CRLF/LF e descarta linhas totalmente vazias.
 *
 * @param text conteúdo do arquivo; um BOM inicial é removido
 * @param delimiter separador de campo ("," no Nubank, ";" no Inter)
 * @return matriz linha × campo, com os campos já sem as aspas de citação
 */
export function parseCsv(text: string, delimiter = ","): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}
