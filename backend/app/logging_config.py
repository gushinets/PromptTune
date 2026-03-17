import logging
import os
from pathlib import Path
from logging.handlers import RotatingFileHandler

from app.config import settings


def setup_logging() -> None:
    """Configure application logging to write to file.

    Sets up RotatingFileHandler for the 'prompttune.access' logger
    with configuration from settings.
    """
    # Ensure logs directory exists
    logs_dir = Path(settings.logs_dir)
    logs_dir.mkdir(parents=True, exist_ok=True)

    log_file_path = logs_dir / settings.log_file

    # Create formatter
    formatter = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S"
    )

    # Create rotating file handler
    handler = RotatingFileHandler(
        filename=str(log_file_path),
        maxBytes=settings.log_max_size,
        backupCount=settings.log_backup_count,
        encoding="utf-8"
    )
    handler.setFormatter(formatter)

    # Configure the 'prompttune.access' logger
    access_logger = logging.getLogger("prompttune.access")
    access_logger.setLevel(logging.DEBUG)  # Capture all levels, middleware filters by level
    access_logger.addHandler(handler)

    # Prevent propagation to root logger (avoid duplicate console output if root is configured)
    access_logger.propagate = False
