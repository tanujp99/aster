@echo off
REM Double-click to start the Aster helper (creates a virtual env on first run).
cd /d "%~dp0"
if not exist .venv (
  py -3 -m venv .venv
  .venv\Scripts\python -m pip install -r requirements.txt
)
.venv\Scripts\python -m aster
pause
