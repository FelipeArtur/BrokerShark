import type { Req, Res } from "./respond.ts";

const clients = new Set<Res>();

/**
 * @brief Avisa todo painel aberto que o ledger mudou.
 */
export function broadcast(event = "update"): void {
  for (const res of clients) {
    try { res.write(`data: ${event}\n\n`); } catch { dropClient(res); }
  }
}

/**
 * @brief   Abre o stream SSE de um painel.
 * @details Sem keepalive: corre em 127.0.0.1, sem proxy pra derrubar conexão ociosa,
 *          e o navegador reconecta sozinho se cair.
 */
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

// ── desligamento por ociosidade ──────────────────────────────────────────────

/**
 * @brief   Vigia de ociosidade: chama `onIdle` depois de `idleMs` sem ninguém.
 * @details O disparo reconfere `isIdle()` — entre armar e disparar alguém pode ter
 *          voltado. Timer `unref`, então não segura o processo. `idleMs <= 0` desliga.
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
 * @brief   Sair sozinho sem painel aberto — OPT-IN via `BROKERSHARK_IDLE_EXIT` (segundos).
 * @details Só o painel abre `/api/events`, então `clients` vazio é "nenhuma aba olhando".
 *          Opt-in porque quem depura com curl não quer o servidor sumindo embaixo dele.
 * @note    Sai com 0: o `Restart=on-failure` da unit não ressuscita.
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

// Arma no boot: navegador que nunca abre não deixa o processo esperando visita.
idle.arm();
