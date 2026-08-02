import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("PRAGMA synchronous=NORMAL");
  return db;
}

export function initSchema(db: DatabaseSync): void {
  db.exec(readFileSync(join(HERE, "schema.sql"), "utf-8"));
}

export function restrictPermissions(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = path + suffix;
    if (existsSync(p)) chmodSync(p, 0o600);
  }
}

/**
 * O caminho do DB nos argumentos de linha de comando, ou `undefined` pra cair
 * no padrão de quem chama.
 *
 * Existe separada e testada porque o modo de falha é o pior que este projeto
 * tem: escolher errado aqui serve o ledger de PRODUÇÃO em silêncio, com a tela
 * inteira parecendo normal — quem pede a demo escreve no ledger de verdade sem
 * nunca ver um aviso.
 *
 * A guarda pula o NÚMERO que vem depois de `--port`. Escrita como
 * `i !== portIdx + 1`, ela virava `i !== 0` quando `--port` estava ausente
 * (`indexOf` devolve −1), e o índice 0 é justamente onde o caminho aparece em
 * `npm start -- data/demo.db`. A demo documentada nunca subiu.
 */
export function pickDbPath(args: string[]): string | undefined {
  const portIdx = args.indexOf("--port");
  const valorDaPorta = portIdx >= 0 ? portIdx + 1 : -1;
  return args.find((a, i) => !a.startsWith("--") && i !== valorDaPorta);
}
