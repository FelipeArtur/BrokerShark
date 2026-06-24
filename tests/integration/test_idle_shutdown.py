"""Idle auto-shutdown — frees the app's RAM when no tab is open.

The app is idle-cheap (0% CPU) but holds ~40 MB while alive. The watchdog graceful-
exits once every tab is closed (zero SSE clients) and no request has arrived for the
timeout. An open tab (live SSE subscription) always keeps it up; any request resets
the idle clock.
"""
import time

import pytest


@pytest.fixture()
def client(db):
    import dashboard.server as server
    server.app.config["TESTING"] = True
    return server.app.test_client()


def test_client_count_tracks_subscriptions():
    from core import events
    assert events.client_count() == 0
    q1 = events.subscribe()
    q2 = events.subscribe()
    assert events.client_count() == 2
    events.unsubscribe(q1)
    assert events.client_count() == 1
    events.unsubscribe(q2)
    assert events.client_count() == 0


def test_request_resets_idle_clock(client):
    import dashboard.server as server
    server._last_activity = time.monotonic() - 9999  # pretend long-idle
    client.get("/api/accounts")
    assert time.monotonic() - server._last_activity < 5  # the request stamped it fresh


def test_idle_expired_only_when_no_clients_and_stale(monkeypatch):
    import dashboard.server as server
    from core import events
    # stale + no clients → expired
    server._last_activity = time.monotonic() - 1000
    assert events.client_count() == 0
    assert server._idle_expired(timeout_s=600) is True
    # an open tab keeps it alive even when stale
    q = events.subscribe()
    try:
        assert server._idle_expired(timeout_s=600) is False
    finally:
        events.unsubscribe(q)
    # fresh activity keeps it alive even with no clients
    server._last_activity = time.monotonic()
    assert server._idle_expired(timeout_s=600) is False


def test_watchdog_disabled_for_nonpositive_timeout():
    import dashboard.server as server
    # must not spawn a thread (no crash, returns cleanly)
    before = _idle_threads()
    server._start_idle_watchdog(0)
    server._start_idle_watchdog(-5)
    assert _idle_threads() == before


def _idle_threads() -> int:
    import threading
    return sum(1 for t in threading.enumerate() if t.name == "idle-watchdog")
