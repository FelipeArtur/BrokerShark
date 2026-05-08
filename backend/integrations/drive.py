"""Google Drive backup — monthly upload of the SQLite database.

Design principles:
- Upload happens at startup if the last backup is more than 30 days old.
- All failures are logged silently — never interrupt the main application flow.
- At most 6 monthly backups are kept in the Drive folder.
- Uses the same service account as the former Sheets integration.
"""
import logging
import mimetypes
from pathlib import Path

import config

_logger = logging.getLogger(__name__)

_SCOPES = ["https://www.googleapis.com/auth/drive.file"]

# Lazy-initialised Drive service (one auth per process)
_service = None


def _get_service():
    global _service
    if _service is not None:
        return _service
    try:
        from google.oauth2.service_account import Credentials
        from googleapiclient.discovery import build
        creds = Credentials.from_service_account_file(config.GOOGLE_CREDENTIALS, scopes=_SCOPES)
        _service = build("drive", "v3", credentials=creds, cache_discovery=False)
    except Exception:
        _logger.exception("Failed to initialise Google Drive service")
    return _service


def _get_or_create_folder() -> str | None:
    """Return the Drive folder ID for backups, creating it if absent."""
    svc = _get_service()
    if svc is None:
        return None
    try:
        folder_name = config.DRIVE_BACKUP_FOLDER
        resp = svc.files().list(
            q=f"name='{folder_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false",
            fields="files(id)",
        ).execute()
        files = resp.get("files", [])
        if files:
            return files[0]["id"]
        meta = {
            "name": folder_name,
            "mimeType": "application/vnd.google-apps.folder",
        }
        folder = svc.files().create(body=meta, fields="id").execute()
        return folder["id"]
    except Exception:
        _logger.exception("Failed to get/create Drive backup folder")
        return None


def upload_backup(db_path: str) -> str | None:
    """Upload the database file to Google Drive.

    Args:
        db_path: Absolute path to the SQLite database file.

    Returns:
        The Drive file ID on success, or ``None`` on failure.
    """
    svc = _get_service()
    if svc is None:
        return None
    try:
        from googleapiclient.http import MediaFileUpload
        from datetime import datetime

        folder_id = _get_or_create_folder()
        if folder_id is None:
            return None

        stamp = datetime.now().strftime("%Y-%m")
        filename = f"brokershark_{stamp}.db"

        # Overwrite if a file with the same name already exists this month
        resp = svc.files().list(
            q=f"name='{filename}' and '{folder_id}' in parents and trashed=false",
            fields="files(id)",
        ).execute()
        existing = resp.get("files", [])

        media = MediaFileUpload(db_path, mimetype="application/octet-stream", resumable=False)
        if existing:
            file_id = existing[0]["id"]
            svc.files().update(fileId=file_id, media_body=media).execute()
        else:
            meta = {"name": filename, "parents": [folder_id]}
            result = svc.files().create(body=meta, media_body=media, fields="id").execute()
            file_id = result["id"]

        _logger.info("Drive backup uploaded: %s (%s)", filename, file_id)
        return file_id
    except Exception:
        _logger.exception("Failed to upload backup to Drive")
        return None


def list_backups() -> list[dict]:
    """List all backup files in the Drive folder.

    Returns:
        List of dicts with keys ``id``, ``name``, ``createdTime``, ``size``.
    """
    svc = _get_service()
    if svc is None:
        return []
    try:
        folder_id = _get_or_create_folder()
        if folder_id is None:
            return []
        resp = svc.files().list(
            q=f"'{folder_id}' in parents and trashed=false",
            fields="files(id,name,createdTime,size)",
            orderBy="createdTime desc",
        ).execute()
        return resp.get("files", [])
    except Exception:
        _logger.exception("Failed to list Drive backups")
        return []


def download_backup(file_id: str, dest_path: str) -> bool:
    """Download a backup file from Drive.

    Args:
        file_id: The Drive file ID to download.
        dest_path: Local path where the file will be saved.

    Returns:
        ``True`` on success, ``False`` on failure.
    """
    svc = _get_service()
    if svc is None:
        return False
    try:
        from googleapiclient.http import MediaIoBaseDownload
        import io

        request = svc.files().get_media(fileId=file_id)
        dest = Path(dest_path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "wb") as fh:
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
        _logger.info("Drive backup downloaded to %s", dest_path)
        return True
    except Exception:
        _logger.exception("Failed to download backup from Drive")
        return False


def prune_old_backups(keep: int = 6) -> int:
    """Delete the oldest backup files, keeping at most ``keep`` copies.

    Args:
        keep: Number of most-recent backups to retain.

    Returns:
        Number of files deleted.
    """
    svc = _get_service()
    if svc is None:
        return 0
    try:
        backups = list_backups()
        to_delete = backups[keep:]
        for f in to_delete:
            svc.files().delete(fileId=f["id"]).execute()
            _logger.info("Pruned old Drive backup: %s", f["name"])
        return len(to_delete)
    except Exception:
        _logger.exception("Failed to prune old Drive backups")
        return 0
