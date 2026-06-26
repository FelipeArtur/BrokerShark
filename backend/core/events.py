"""SSE pub/sub broker — notifies connected dashboard clients when the database changes.

The broker maintains a list of per-client queues. When a write occurs in
``core.database``, it calls :func:`notify`, which enqueues an ``"update"``
message into every active queue.  The dashboard's ``/api/events`` endpoint
blocks on its own queue and streams the message to the browser via SSE.

Thread safety is guaranteed by a module-level ``threading.Lock``.
"""
import queue
import threading

_clients: list[queue.Queue] = []
_lock = threading.Lock()


def subscribe() -> queue.Queue:
    """Register a new SSE client and return its dedicated queue.

    Returns:
        A ``queue.Queue`` instance (maxsize=10) owned by this client.
        The caller must pass the same queue to :func:`unsubscribe` when done.
    """
    q: queue.Queue = queue.Queue(maxsize=10)
    with _lock:
        _clients.append(q)
    return q


def unsubscribe(q: queue.Queue) -> None:
    """Remove a client queue from the active-clients list.

    Args:
        q: The queue previously returned by :func:`subscribe`.
    """
    with _lock:
        if q in _clients:
            _clients.remove(q)


def notify() -> None:
    """Broadcast an ``"update"`` event to all subscribed clients.

    Queues that are full (slow or disconnected clients) are silently
    removed from the active list to prevent memory leaks.
    """
    with _lock:
        dead = []
        for q in _clients:
            try:
                q.put_nowait("update")
            except queue.Full:
                dead.append(q)
        for q in dead:
            _clients.remove(q)
