import logging
import sys


def setup_logging() -> None:
    """Configure app logging to stdout only."""

    formatter = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )

    root_handler = logging.StreamHandler(sys.stdout)
    root_handler.setFormatter(formatter)
    root_handler.setLevel(logging.INFO)

    # Ensure module loggers that propagate to root are visible in stdout.
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    root_logger.handlers.clear()
    root_logger.addHandler(root_handler)

    access_handler = logging.StreamHandler(sys.stdout)
    access_handler.setFormatter(formatter)
    access_handler.setLevel(logging.INFO)

    access_logger = logging.getLogger("prompttune.access")
    access_logger.setLevel(logging.INFO)
    access_logger.handlers.clear()
    access_logger.addHandler(access_handler)
    access_logger.propagate = False
