# CLAUDE.md
用中文和我交流
This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ScriptsManager is a web-based system for managing and scheduling scripts with a focus on Docker integration. It provides a React frontend for managing scripts and a FastAPI backend that handles script execution, scheduling, and Telegram notifications.

## High-Level Architecture

The project consists of two main components deployed together in Docker:

### Backend (FastAPI + SQLAlchemy)
- **Location**: `/backend/app/`
- **Runtime**: Python 3.11, runs on port 4396 inside Docker
- **Database**: SQLite (default) at `/app/data/manager.db`
- **Key Components**:
  - `main.py`: FastAPI app setup, static file serving, SPA fallback handling, startup event setup
  - `api.py`: RESTful endpoints for script management, file upload, settings, and WebSocket log streaming
  - `scheduler.py`: AsyncIO-based APScheduler for cron-based script execution, process management, and Telegram notifications
  - `database.py`: SQLAlchemy ORM configuration
  - `models.py`: Two SQLAlchemy models - `Script` (manages script metadata, cron, status) and `Setting` (key-value config store)
  - `telegram_bot.py`: Telegram bot integration for notifications and Telegram-based script execution

### Frontend (React + TypeScript + Vite)
- **Location**: `/frontend/src/`
- **Build Tool**: Vite (dev server and production build)
- **Styling**: Tailwind CSS + PostCSS
- **Key Dependencies**: React 19, axios for API calls, lucide-react for icons
- **Main App**: `App.tsx` - Contains all UI logic with state management for scripts, settings, logs, and code editor
- **API Layer**: `api.ts` - Axios-based API client with methods for scripts, settings, file upload, and Telegram connection testing

### Docker Setup
- **Main Dockerfile**: Multi-stage build that:
  1. Builds frontend (Node.js stage) producing static assets in `/app/frontend/dist`
  2. Builds backend (Python stage) and copies built frontend assets
  3. Exposes port 4396
- **docker-compose.yml**: Orchestrates the single container with volume mounts for scripts, persistent data, and NAS access

## Development Workflow

### Frontend Development
```bash
# Development server with HMR
cd frontend && npm run dev

# Production build
npm run build

# Lint check
npm lint
```

The frontend builds to `/frontend/dist` which is served by the backend. The backend's `main.py` serves this as a SPA, with fallback to `index.html` for client-side routing.

### Backend Development
```bash
# Run backend locally (requires Python 3.11+)
cd backend && pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Note: The main Dockerfile runs on port 4396, but local dev typically uses port 8000. Adjust as needed.

### Docker Build & Run
```bash
# Build and start the container
docker-compose up --build

# The container exposes port 4396
# Access at http://localhost:4396
```

## Key Architectural Decisions

### Script Execution Model
- Scripts are stored in the database with metadata (name, path, cron expression, arguments, status)
- The scheduler runs scripts asynchronously in separate processes (tracked in `RUNNING_TASKS` dict)
- Each script maintains its own log file at `/app/data/logs/{script_id}.log`
- Script status states: `'success'`, `'failed'`, `'running'`, `'stopped'`
- Cron expressions support standard cron syntax plus special values:
  - `@daemon`: Used to indicate continuous/background processes
  - `null` or empty: Scripts with no scheduled execution

### Scheduler Initialization (Startup)
On application startup (`main.py:startup_event`):
1. Database schema migrations are attempted
2. APScheduler starts
3. Telegram bot initializes
4. Scripts are synced from disk (via `sync_scripts_from_disk`)
5. All enabled scripts with valid cron expressions are registered to the scheduler
6. Scripts with `run_on_startup=True` are executed immediately (as tasks, not blocking)

### API Design
- RESTful endpoints under `/api` prefix
- Dependency injection used for database sessions (`get_db` dependency)
- WebSocket endpoint at `/api/logs/{script_id}/stream` for real-time log streaming
- Frontend builds are served from `/` with fallback to `index.html` for SPA routing
- Static assets (CSS, JS) mounted at `/assets`

### Data Model
- **Script**: Stores script metadata, execution history (last_run, last_status, last_output), and configuration (cron, enabled, run_on_startup, arguments)
- **Setting**: Key-value pairs for configuration (Telegram token, chat ID, proxy settings, health check flag)

### Telegram Integration
- Bot token and chat ID stored in Settings table
- Notifications sent after script execution (success/failure)
- Optional proxy support for Telegram API requests (useful in restricted networks)
- Bot can be triggered to execute scripts via Telegram commands

## Important Files & Their Roles

- `backend/app/main.py`: Application entry point, startup logic, SPA serving
- `backend/app/api.py`: All HTTP endpoints and WebSocket handlers
- `backend/app/scheduler.py`: Script execution, process management, Telegram notifications
- `backend/app/telegram_bot.py`: Telegram bot polling/command handling
- `frontend/src/App.tsx`: Entire UI - dashboard, script list, editor, settings, logs
- `frontend/src/api.ts`: Axios wrapper for all API calls
- `Dockerfile`: Multi-stage build orchestration
- `docker-compose.yml`: Container runtime configuration

## Data Storage

- **Database**: SQLite at `./backend/data/manager.db` (persisted via Docker volume)
- **Logs**: `/app/data/logs/{script_id}.log` per script (one log file per script execution)
- **Scripts**: `/scripts/` directory (mounted from host via `docker-compose.yml`)

## Common Development Tasks

### Adding a New API Endpoint
1. Define Pydantic model in `api.py` if needed for request/response
2. Add route handler with `@router.post/get/put/delete` decorator
3. Use `db: Session = Depends(get_db)` for database access
4. Add corresponding method to `frontend/src/api.ts` using axios
5. Call the API method from `App.tsx` state and UI

### Adding a New Script Setting
1. Add key-value pair to Settings table via API or database
2. Load setting in `App.tsx` via `api.getSettings()`
3. Display in Settings tab UI
4. Pass to backend when needed for script execution

### Modifying Script Execution Logic
- Core logic is in `scheduler.py:run_script()`
- Process output is logged to script's log file
- Status updates happen in database
- Telegram notifications sent post-execution if configured

## Environment Variables

- `SCRIPT_ROOT`: Directory where scripts are stored (default: `/scripts`)
- `DATABASE_URL`: Database connection string (default: `sqlite:///./manager.db`)
- `TZ`: Timezone for log timestamps (set to `Asia/Shanghai` in docker-compose.yml)

## Technology Stack Summary

**Backend**: FastAPI, SQLAlchemy, APScheduler, httpx, websockets, Telegram Bot API
**Frontend**: React 19, TypeScript, Vite, Tailwind CSS, axios, lucide-react
**Database**: SQLite (self-contained, no separate DB service needed)
**Deployment**: Docker multi-stage build, docker-compose
