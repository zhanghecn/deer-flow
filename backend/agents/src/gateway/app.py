from __future__ import annotations

from fastapi import FastAPI

from src.gateway.routers.sandbox_ide import router as sandbox_ide_router
from src.gateway.routers.tools import router as tools_router

# LangGraph merges this custom FastAPI app with its own protected routes. Keep
# the app itself thin and let dedicated router modules own the thread IDE
# contract so runtime-side browser features remain explicit and testable.
app = FastAPI()
app.include_router(sandbox_ide_router)
app.include_router(tools_router)
