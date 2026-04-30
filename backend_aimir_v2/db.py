# db.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from core.config import settings

engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()

# ВАЖНО: импортируем ВСЕ модели до create_all, чтобы FK увидели целевые таблицы
import models.user           # noqa: F401
import models.document       # noqa: F401
import models.guest          # noqa: F401
import models.verification   # noqa: F401
import models.password_reset # noqa: F401
import models.review
import models.contract_analysis
import models.billing_transaction
# dev-only auto-create (на проде — Alembic миграции)
Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
