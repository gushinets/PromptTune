from fastapi import APIRouter

from app.api.v1.health import router as health_router
from app.api.v1.improve import router as improve_router
from app.api.v1.limits import router as limits_router
from app.api.v1.prompts import router as prompts_router

api_router = APIRouter()
api_router.include_router(health_router, tags=["health"])
api_router.include_router(improve_router, prefix="/v1", tags=["improve"])
api_router.include_router(prompts_router, prefix="/v1", tags=["prompts"])
api_router.include_router(limits_router, prefix="/v1", tags=["limits"])
