from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import db  # noqa: F401

from core.config import settings
from routers.user import router as users_router
from routers.billing import router as billing_router
from routers.review import router as review_router
from routers.documents import router as documents_router
from routers.analysis import router as analysis_router
from routers.dashboard import router as dashboard_router

def _cors_origins() -> list[str]:
    if getattr(settings, "CORS_ORIGINS", None):
        return [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
    return ["http://localhost:3000", "http://127.0.0.1:3000"]


app = FastAPI(title="AI Analytics Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users_router)
app.include_router(billing_router)
app.include_router(review_router)
app.include_router(documents_router)
app.include_router(analysis_router)
app.include_router(dashboard_router)

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/")
def root():
    return {"service": "aimir-backend", "version": "1.0.0", "docs": "/docs"}


@app.on_event("startup")
def on_startup():
    print("🚀 Backend started: AI Analytics running with FastAPI")
