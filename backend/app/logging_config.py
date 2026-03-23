import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

from app.config import settings


def setup_logging() -> None:
    """Configure request logging for both containers and local files.

    Access logs are emitted to stdout for `docker compose logs` and also
    persisted to a rotating file under `settings.logs_dir`.
    """
    logs_dir = Path(settings.logs_dir)
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_file_path = logs_dir / settings.log_file

    formatter = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )

    file_handler = RotatingFileHandler(
        filename=str(log_file_path),
        maxBytes=settings.log_max_size,
        backupCount=settings.log_backup_count,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)

    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)

    access_logger = logging.getLogger("prompttune.access")
    access_logger.setLevel(logging.INFO)
    access_logger.handlers.clear()
    access_logger.addHandler(file_handler)
    access_logger.addHandler(stream_handler)
    access_logger.propagate = False
