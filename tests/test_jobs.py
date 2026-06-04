"""Tests for the systemd job entrypoints + APScheduler removal (P1c).

Each entrypoint must call bootstrap() then its one action. The Telegram Application
must no longer wire an in-process scheduler (that moved to systemd user timers).
"""
import importlib


def test_backup_entrypoint_calls_bootstrap_then_run_backup(monkeypatch):
    import jobs.backup as job
    calls = []
    monkeypatch.setattr(job, "bootstrap", lambda: calls.append("bootstrap"))
    monkeypatch.setattr(job.core_backup, "run_backup", lambda: calls.append("run_backup") or True)
    job.main()
    assert calls == ["bootstrap", "run_backup"]


def test_weekly_entrypoint_calls_bootstrap_then_send(monkeypatch):
    import jobs.weekly_report as job
    calls = []
    monkeypatch.setattr(job, "bootstrap", lambda: calls.append("bootstrap"))
    monkeypatch.setattr(job, "Bot", lambda token: ("bot", token))
    monkeypatch.setattr(job.config, "TELEGRAM_TOKEN", "tok")

    async def fake_send(bot):
        calls.append(("send", bot))

    monkeypatch.setattr(job, "send_weekly_report", fake_send)
    job.main()
    assert calls == ["bootstrap", ("send", ("bot", "tok"))]


def test_monthly_entrypoint_calls_bootstrap_then_send(monkeypatch):
    import jobs.monthly_closing as job
    calls = []
    monkeypatch.setattr(job, "bootstrap", lambda: calls.append("bootstrap"))
    monkeypatch.setattr(job, "Bot", lambda token: ("bot", token))
    monkeypatch.setattr(job.config, "TELEGRAM_TOKEN", "tok")

    async def fake_send(bot):
        calls.append("send")

    monkeypatch.setattr(job, "send_monthly_closing_report", fake_send)
    job.main()
    assert calls == ["bootstrap", "send"]


def test_application_has_no_scheduler_wiring():
    import bot.application as appmod
    assert not hasattr(appmod, "_post_init")
    assert not hasattr(appmod, "_post_shutdown")
    # scheduler.py was removed entirely
    assert importlib.util.find_spec("bot.scheduler") is None


def test_reports_module_exposes_the_two_jobs():
    from bot import reports
    assert callable(reports.send_weekly_report)
    assert callable(reports.send_monthly_closing_report)
