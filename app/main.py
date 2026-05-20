import json
import logging.handlers
import os
from pathlib import Path

from litestar import Litestar, MediaType, Request, get, post
from litestar.logging import LoggingConfig
from litestar.static_files import create_static_files_router

APP_ROOT = Path(__file__).parent
DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
INDEX_FILE = APP_ROOT / "static" / "index.html"
REGISTER_SERVICE_FILE = APP_ROOT / "static" / "register_service"
TRAIL_FILE = DATA_DIR / "trail.json"

EMPTY_TRAIL: dict = {"trail": [], "targets": [], "activeTargetIndex": -1}


@get("/", media_type=MediaType.HTML, sync_to_thread=True)
def index() -> str:
    return INDEX_FILE.read_text(encoding="utf-8")


@get("/register_service", media_type=MediaType.TEXT, sync_to_thread=True)
def register_service() -> str:
    return REGISTER_SERVICE_FILE.read_text(encoding="utf-8")


@get("/trail", sync_to_thread=True)
def get_trail() -> dict:
    if not TRAIL_FILE.exists():
        return EMPTY_TRAIL
    return json.loads(TRAIL_FILE.read_text(encoding="utf-8"))


@post("/trail", sync_to_thread=True)
async def save_trail(request: Request) -> dict:
    data = await request.json()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    TRAIL_FILE.write_text(json.dumps(data), encoding="utf-8")
    return {"status": "saved"}


logging_config = LoggingConfig(
    loggers={__name__: {"level": "INFO", "handlers": ["queue_listener"]}}
)

log_dir = APP_ROOT / "logs"
log_dir.mkdir(parents=True, exist_ok=True)
fh = logging.handlers.RotatingFileHandler(
    log_dir / "app.log", maxBytes=2**16, backupCount=1
)

static_router = create_static_files_router(
    path="/static", directories=[str(APP_ROOT / "static")]
)

app = Litestar(
    route_handlers=[index, register_service, get_trail, save_trail, static_router],
    logging_config=logging_config,
)
app.logger.addHandler(fh)
