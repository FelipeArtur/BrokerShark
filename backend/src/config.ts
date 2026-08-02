/**
 * @file    Configuração do ledger — o que é DE QUEM USA, fora do código.
 * @details Precedência: `config/local.json` (seu, não versionado) → `config/default.json`.
 *          `BROKERSHARK_CONFIG` aponta pra outro caminho.
 * @note    Formato ≠ banco: o parser é escolhido por `statementFormat`, nunca pelo
 *          nome da instituição.
 */

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
 * @brief Rótulo de grupo para posições da corretora — só exibição, não muda total.
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
   * @brief Cor de cada banco, por nome (sem caixa). Sem entrada aqui, deriva do nome.
   * @note  Chave é o BANCO, não a conta: conta e cartão da mesma instituição, mesma cor.
   */
  bankColors?: Record<string, string>;
  /**
   * @brief   Onde os snapshots mensais são gravados. Sem declarar, `~/brokershark-backups`.
   * @warning Dois lados leem daqui (o job que escreve e o `/api/backup-status`). Defaults
   *          soltos faziam o painel anunciar "sem backup" com backups existindo.
   */
  backupDir?: string;
}

/** Formato fechado: o valor vai direto pro `style`, e torto viraria CSS arbitrário. */
const COLOR_RE = /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|(?:oklch|oklab|lab|lch|rgb|rgba|hsl|hsla)\([^;{}()]*\))$/;

const ROOT = join(import.meta.dirname, "../..");

/**
 * @brief   O arquivo de config que ESTE processo usa.
 * @details O backup copia daqui: `local.json` saiu do git, então o disco é o único
 *          lugar onde ele existe. Caminho adivinhado salvaria a config errada.
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
  //> `paidFrom` mentiroso quebra a reconciliação em silêncio: fatura nasce sempre aberta.
  for (const a of c.accounts) {
    if (a.paidFrom && !ids.has(a.paidFrom)) {
      throw new Error(`${where}: cartão ${a.id} paga de uma conta que não existe (${a.paidFrom})`);
    }
  }
  if (c.derivedSavings && !ids.has(c.derivedSavings.accountId)) {
    throw new Error(`${where}: derivedSavings aponta pra conta inexistente (${c.derivedSavings.accountId})`);
  }
  //> Cor torta falha no boot, não na tela: "corrige o JSON" em vez de "chip invisível".
  for (const [bank, color] of Object.entries(c.bankColors ?? {})) {
    if (typeof color !== "string" || !COLOR_RE.test(color.trim())) {
      throw new Error(`${where}: bankColors['${bank}'] não é uma cor CSS reconhecida (${String(color)})`);
    }
  }
}

let cached: BrokerSharkConfig | null = null;

function loadConfig(path?: string): BrokerSharkConfig {
  const file = path ?? configPath();
  const raw = JSON.parse(readFileSync(file, "utf8")) as BrokerSharkConfig;
  validate(raw, file);
  return raw;
}

/**
 * @brief A config do processo. Lida uma vez; `setConfig` existe para os testes.
 */
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

const cardAccounts = (): AccountConfig[] =>
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
 * @brief O cartão principal e a conta que o paga; com mais de um, vale o primeiro.
 * @note  As rotas de fatura suportam um cartão por vez — resolver isso é aqui.
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
