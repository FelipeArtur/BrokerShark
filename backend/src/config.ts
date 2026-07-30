// Configuração do ledger — o que é DE QUEM USA, fora do código.
//
// Antes, o id de cada conta e o nome de cada produto financeiro viviam
// espalhados por onze arquivos. Isso fazia do projeto o script de uma pessoa:
// quem clonasse herdava os bancos, as contas e a poupança do autor. O que é
// genuinamente do domínio (formato de arquivo, invariante de dinheiro, regra de
// reconciliação) ficou no código; o resto virou este arquivo.
//
// Precedência: `config/local.json` (o seu, não versionado) → `config/default.json`
// (genérico, versionado). `BROKERSHARK_CONFIG` aponta pra outro caminho.
//
// **Formato ≠ banco.** `statementFormat` descreve o arquivo que o banco exporta
// ('ids' = tem identificador único por linha; 'running-balance' = tem saldo
// corrente conferível). Dois bancos diferentes podem exportar o mesmo formato, e
// o mesmo banco pode mudar o dele — por isso o parser é escolhido pelo formato,
// nunca pelo nome da instituição.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type StatementFormat = "ids" | "running-balance";
export type InvoiceFormat = "itemized";

export interface AccountConfig {
  id: string;
  bank: string;
  type: "checking" | "credit_card";
  name: string;
  statementFormat?: StatementFormat;
  invoiceFormat?: InvoiceFormat;
  /** Conta corrente de onde sai o pagamento da fatura (só cartão). */
  paidFrom?: string;
  /** Regex que casa o nome do arquivo no acervo, para o backfill. */
  filePattern?: string;
}

export interface DerivedSavingsConfig {
  name: string;
  bank: string;
  type: string;
  /** Conta corrente cujas pernas de transferência alimentam a posição. */
  accountId: string;
  keywords: string[];
  excludeKeywords: string[];
}

/**
 * Rótulo de grupo para posições da corretora — puramente de exibição.
 *
 * Serve pra juntar na tela posições que o dono pensa como um bloco só ("a renda
 * fixa do banco X"), sem que isso mude nenhum total.
 */
export interface PositionGroup {
  type: string;
  bank: string;
  name: string;
}

export interface BrokerSharkConfig {
  accounts: AccountConfig[];
  investmentKeywords: string[];
  derivedSavings?: DerivedSavingsConfig;
  positionGroups?: PositionGroup[];
  brokerReportPattern?: string;
  /**
   * Cor de cada banco na tela, por nome de banco (comparação sem caixa).
   *
   * OPCIONAL, e é o único jeito de um banco ter cor própria. Banco que não
   * aparecer aqui recebe a cor derivada do nome (`domain/palette.js`) — o
   * default genérico não declara nenhuma de propósito, porque cor de marca é
   * de quem usa, não do domínio, e este repositório é público. A sua vive em
   * `config/local.json`.
   *
   * Chave é o BANCO, não a conta: conta corrente e cartão da mesma instituição
   * são a mesma identidade visual na tela.
   */
  bankColors?: Record<string, string>;
  /**
   * Onde os snapshots mensais do ledger são gravados.
   *
   * Mora aqui porque DOIS lados precisam concordar: o job que escreve
   * (`jobs/backup.ts`, disparado pelo systemd timer) e o servidor que lê pra
   * responder `/api/backup-status`. Enquanto eram dois defaults soltos, apontar
   * um pro disco novo e esquecer o outro fazia o painel anunciar "sem backup"
   * com backups existindo — silenciosamente, que é o pior jeito de um aviso de
   * backup falhar.
   *
   * Sem declarar, cai em `~/brokershark-backups`.
   */
  backupDir?: string;
}

/**
 * Cor que vai parar num atributo `style`, então o formato é fechado aqui:
 * `#rgb`, `#rrggbb` ou uma função de cor do CSS (`oklch(...)`, `hsl(...)`).
 * Sem isso, um valor torto na config viraria CSS arbitrário na página.
 */
const COLOR_RE = /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|(?:oklch|oklab|lab|lch|rgb|rgba|hsl|hsla)\([^;{}()]*\))$/;

const ROOT = join(import.meta.dirname, "../..");

/**
 * O arquivo de config que ESTE processo usa.
 *
 * Exportado porque o backup precisa copiá-lo: desde que `config/local.json`
 * saiu do git (era dado de banco versionado), o único lugar onde ele existe é o
 * disco — e perder a máquina passou a significar perder também quais contas o
 * ledger descreve. Quem faz a cópia tem que copiar o arquivo REAL em uso, não
 * um caminho adivinhado, senão `BROKERSHARK_CONFIG` faria o backup salvar a
 * config errada sem avisar.
 */
export function configPath(): string {
  const fromEnv = process.env.BROKERSHARK_CONFIG;
  if (fromEnv) return fromEnv;
  const local = join(ROOT, "config/local.json");
  return existsSync(local) ? local : join(ROOT, "config/default.json");
}

function validate(c: BrokerSharkConfig, where: string): void {
  if (!Array.isArray(c.accounts) || !c.accounts.length) {
    throw new Error(`${where}: 'accounts' precisa ter pelo menos uma conta`);
  }
  const ids = new Set<string>();
  for (const a of c.accounts) {
    if (!a.id || !a.bank || !a.name) throw new Error(`${where}: conta sem id, bank ou name`);
    if (a.type !== "checking" && a.type !== "credit_card") {
      throw new Error(`${where}: conta ${a.id} com type inválido (${a.type})`);
    }
    if (ids.has(a.id)) throw new Error(`${where}: id de conta duplicado (${a.id})`);
    ids.add(a.id);
  }
  // `paidFrom` mentiroso quebraria a reconciliação de fatura em silêncio: a
  // busca pelo pagamento não acharia nada e toda fatura nasceria em aberto.
  for (const a of c.accounts) {
    if (a.paidFrom && !ids.has(a.paidFrom)) {
      throw new Error(`${where}: cartão ${a.id} paga de uma conta que não existe (${a.paidFrom})`);
    }
  }
  if (c.derivedSavings && !ids.has(c.derivedSavings.accountId)) {
    throw new Error(`${where}: derivedSavings aponta pra conta inexistente (${c.derivedSavings.accountId})`);
  }
  // Cor torta é recusada no boot, não na tela: o valor sai daqui direto pro
  // `style` de um elemento, e falhar cedo é a diferença entre "corrige o JSON"
  // e "por que este chip ficou invisível".
  for (const [bank, color] of Object.entries(c.bankColors ?? {})) {
    if (typeof color !== "string" || !COLOR_RE.test(color.trim())) {
      throw new Error(`${where}: bankColors['${bank}'] não é uma cor CSS reconhecida (${String(color)})`);
    }
  }
}

let cached: BrokerSharkConfig | null = null;

export function loadConfig(path?: string): BrokerSharkConfig {
  const file = path ?? configPath();
  const raw = JSON.parse(readFileSync(file, "utf8")) as BrokerSharkConfig;
  validate(raw, file);
  return raw;
}

/** A config do processo. Lida uma vez; `setConfig` existe para os testes. */
export function config(): BrokerSharkConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

export function setConfig(c: BrokerSharkConfig | null): void {
  if (c) validate(c, "setConfig");
  cached = c;
}

// ── consultas derivadas, para o código não repetir filtro ────────────────────

export const checkingAccounts = (): AccountConfig[] =>
  config().accounts.filter(a => a.type === "checking");

export const cardAccounts = (): AccountConfig[] =>
  config().accounts.filter(a => a.type === "credit_card");

export const accountById = (id: string): AccountConfig | undefined =>
  config().accounts.find(a => a.id === id);

/**
 * Cor declarada pro banco, ou null quando não há — aí a tela deriva do nome.
 *
 * Nome de banco casa sem caixa e sem espaço nas pontas: quem escreve "Banco A"
 * na conta e "banco a" no mapa quis dizer a mesma instituição.
 */
export function bankColorFor(bank: string): string | null {
  const want = String(bank ?? "").trim().toLowerCase();
  if (!want) return null;
  for (const [k, v] of Object.entries(config().bankColors ?? {})) {
    if (k.trim().toLowerCase() === want) return v.trim();
  }
  return null;
}

/** Conta do formato pedido — o destino natural de um arquivo daquele tipo. */
export const accountByFormat = (f: StatementFormat | InvoiceFormat): AccountConfig | undefined =>
  config().accounts.find(a => a.statementFormat === f || a.invoiceFormat === f);

/**
 * O cartão principal e a conta que o paga.
 *
 * O ledger suporta um cartão de cada vez nas rotas de fatura (é o que o produto
 * precisou até aqui). Com mais de um configurado, vale o primeiro — e o dia que
 * isso incomodar, o lugar de resolver é aqui, não espalhado nas consultas.
 */
export function primaryCard(): { card: AccountConfig; paidFrom: AccountConfig } | null {
  const card = cardAccounts()[0];
  if (!card) return null;
  const paidFrom = card.paidFrom
    ? accountById(card.paidFrom)
    : checkingAccounts()[0];
  return paidFrom ? { card, paidFrom } : null;
}

/** Rótulo de grupo de uma posição, ou null quando ela não pertence a nenhum. */
export function groupNameFor(type: string, bank: string): string | null {
  const norm = (x: string) => x.trim().toLowerCase();
  const hit = (config().positionGroups ?? []).find(
    g => norm(g.type) === norm(type) && norm(g.bank) === norm(bank),
  );
  return hit ? hit.name : null;
}

/**
 * O vocabulário que o parser usa para aquela conta.
 *
 * A regra de poupança derivada só acompanha a conta que a config declarou: as
 * mesmas palavras noutra conta são investimento comum, não a posição derivada.
 */
export function ledgerVocabulary(accountId: string): {
  investmentKeywords: readonly string[];
  savings?: { keywords: string[]; excludeKeywords: string[]; accountId: string };
} {
  const c = config();
  const s = c.derivedSavings;
  return {
    investmentKeywords: c.investmentKeywords,
    savings: s && s.accountId === accountId
      ? { keywords: s.keywords, excludeKeywords: s.excludeKeywords, accountId: s.accountId }
      : undefined,
  };
}
