import type { Req, Res } from "./respond.ts";

const clients = new Set<Res>();

export function broadcast(event = "update"): void {
  for (const res of clients) {
    try { res.write(`data: ${event}\n\n`); } catch { dropClient(res); }
  }
}

export function handleSse(req: Req, res: Res): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    "Connection": "keep-alive",
  });
  res.write(": connected\n\n");
  clients.add(res);
  idle.cancel();
  req.on("close", () => dropClient(res));
}

function dropClient(res: Res): void {
  clients.delete(res);
  idle.arm();
}

// Não há keepalive: o stream corre em 127.0.0.1, sem proxy no meio pra derrubar
// conexão ociosa. Ping periódico só existiria pra atravessar intermediário que
// esta app não tem — e o navegador reconecta SSE sozinho se cair.

// ── desligamento por ociosidade ──────────────────────────────────────────────

/**
 * Vigia de ociosidade: chama `onIdle` depois de `idleMs` sem ninguém.
 *
 * `arm` só conta se `isIdle()` for verdade agora, e o disparo confere de novo —
 * entre armar e disparar alguém pode ter voltado.
 *
 * O timer é `unref`: ele não é motivo pro processo continuar vivo, só reage
 * enquanto o servidor está. `idleMs <= 0` desliga o vigia inteiro.
 */
export function makeIdleWatch(idleMs: number, isIdle: () => boolean, onIdle: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel(): void {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function arm(): void {
    if (!(idleMs > 0) || !isIdle()) return;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      if (isIdle()) onIdle();
    }, idleMs);
    timer.unref?.();
  }

  return { arm, cancel, get armed() { return timer !== null; } };
}

/**
 * Sair sozinho quando nenhum painel está aberto — OPT-IN, em segundos, via
 * `BROKERSHARK_IDLE_EXIT`.
 *
 * O painel é a única coisa que abre `/api/events`, então `clients` vazio quer
 * dizer literalmente "nenhuma aba olhando". Fechar a última aba passa a
 * devolver os ~70MB do processo em vez de deixá-los parados até o logout.
 *
 * É opt-in de propósito, e quem liga é a unit do systemd: sob supervisão o
 * serviço sobe no clique do launcher e sai sozinho depois, sem ninguém notar.
 * Rodando `npm start` na mão a variável não existe e nada muda — quem está
 * depurando com curl não quer o servidor sumindo embaixo dele.
 *
 * Sai com 0 (saída limpa): o `Restart=on-failure` da unit não ressuscita, e o
 * próximo clique no launcher sobe de novo.
 */
const IDLE_EXIT_MS = Number(process.env.BROKERSHARK_IDLE_EXIT ?? 0) * 1000;

const idle = makeIdleWatch(
  IDLE_EXIT_MS,
  () => clients.size === 0,
  () => {
    console.log(`Nenhum painel aberto há ${IDLE_EXIT_MS / 1000}s — encerrando.`);
    process.exit(0);
  },
);

// Arma já no boot: se o navegador nunca abrir (launcher falhou, aba fechada
// antes de carregar), o processo não fica de pé pra sempre esperando visita.
idle.arm();
