"""SSE pub/sub — notifies connected dashboard clients when the database changes."""
import queue
import threading

_clients: list[queue.Queue] = []
_lock = threading.Lock()


def subscribe() -> queue.Queue:
    q: queue.Queue = queue.Queue(maxsize=10)
    with _lock:
        _clients.append(q)
    return q


def unsubscribe(q: queue.Queue) -> None:
    with _lock:
        if q in _clients:
            _clients.remove(q)


def notify() -> None:
    with _lock:
        dead = []
        for q in _clients:
            try:
                q.put_nowait("update")
            except queue.Full:
                dead.append(q)
        for q in dead:
            _clients.remove(q)
