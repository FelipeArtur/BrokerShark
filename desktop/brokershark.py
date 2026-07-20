#!/usr/bin/env python3
"""BrokerShark — janela desktop (WebKitGTK) dona do ciclo de vida do server.

Abre → porta livre → sobe `node src/server.ts --port N` → espera 200 → carrega no
WebView. Fecha → SIGTERM no node (SIGKILL de fallback) → sai. Nada sobra rodando.

Deps runtime: python-gobject, gtk3, webkit2gtk-4.1, node >= 26.
Uso: python brokershark.py [--check]
  --check: smoke headless — sobe server, confirma 200, encerra. Sem GUI.
"""
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def start_server(port: int) -> subprocess.Popen:
    return subprocess.Popen(
        ["node", "src/server.ts", "--port", str(port)], cwd=str(BACKEND)
    )


def wait_ready(port: int, timeout: float = 15.0) -> bool:
    url = f"http://127.0.0.1:{port}/"
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.25)
    return False


def stop_server(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    proc.terminate()  # SIGTERM
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()  # SIGKILL


def run_check() -> int:
    port = free_port()
    proc = start_server(port)
    try:
        ok = wait_ready(port)
        print("OK" if ok else "FALHOU: server não respondeu 200")
        return 0 if ok else 1
    finally:
        stop_server(proc)


def run_gui() -> int:
    import gi

    gi.require_version("Gtk", "3.0")
    gi.require_version("WebKit2", "4.1")
    from gi.repository import Gtk, WebKit2

    port = free_port()
    proc = start_server(port)
    if not wait_ready(port):
        stop_server(proc)
        print("FALHOU: server não subiu", file=sys.stderr)
        return 1

    win = Gtk.Window(title="BrokerShark")
    win.set_default_size(1400, 900)
    icon = Path(__file__).resolve().parent / "icon.png"
    if icon.exists():
        win.set_icon_from_file(str(icon))
    view = WebKit2.WebView()
    view.load_uri(f"http://127.0.0.1:{port}")
    win.add(view)

    def on_destroy(*_):
        stop_server(proc)
        Gtk.main_quit()

    win.connect("destroy", on_destroy)
    win.show_all()
    Gtk.main()
    return 0


def main() -> int:
    if "--check" in sys.argv[1:]:
        return run_check()
    return run_gui()


if __name__ == "__main__":
    sys.exit(main())
