import asyncio

from app.db.session import async_session_factory
from app.services.analytics_retention import cleanup_analytics_events


async def _main() -> None:
    async with async_session_factory() as db:
        deleted = await cleanup_analytics_events(db)
        print(f"deleted_analytics_events={deleted}")


if __name__ == "__main__":
    asyncio.run(_main())
