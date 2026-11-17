"""Repo-relative paths. The package is installed editable, so src/ stays in the repo."""
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
