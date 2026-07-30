"""Application configuration.

Non-secret settings come from environment variables / a local .env file
(prefix ``EPAY_``). Secrets that must survive restarts (the eBay refresh
token) are stored in the OS keychain via ``keyring`` — Windows Credential
Manager on Windows, Keychain on macOS.
"""

from __future__ import annotations

import contextlib
from functools import lru_cache
from pathlib import Path

import keyring
from platformdirs import user_data_dir
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_NAME = "ePayTool"
KEYRING_SERVICE = "epay-tool"

DATA_DIR = Path(user_data_dir(APP_NAME))
PHOTOS_DIR = DATA_DIR / "photos"
DB_PATH = DATA_DIR / "epay.db"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="EPAY_", extra="ignore")

    # eBay
    ebay_env: str = "sandbox"  # "sandbox" | "production"
    ebay_client_id: str = ""
    ebay_client_secret: str = ""
    ebay_ru_name: str = ""  # eBay "RuName" (redirect URL name) of the app
    ebay_marketplace: str = "EBAY_DE"
    content_language: str = "de-DE"
    currency: str = "EUR"

    # AI
    ai_provider: str = "gemini"  # "gemini" | "ollama" | "none"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5vl"

    # Listing defaults
    default_condition: str = "NEW"  # applied when the user does not set one

    # Pricing
    undercut_percent: float = 3.0

    # OAuth loopback server
    oauth_callback_port: int = 8123

    @property
    def is_production(self) -> bool:
        return self.ebay_env.lower() == "production"

    @property
    def api_base(self) -> str:
        return "https://api.ebay.com" if self.is_production else "https://api.sandbox.ebay.com"

    @property
    def auth_base(self) -> str:
        return "https://auth.ebay.com" if self.is_production else "https://auth.sandbox.ebay.com"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)


def store_secret(name: str, value: str) -> None:
    keyring.set_password(KEYRING_SERVICE, name, value)


def load_secret(name: str) -> str | None:
    return keyring.get_password(KEYRING_SERVICE, name)


def delete_secret(name: str) -> None:
    with contextlib.suppress(keyring.errors.PasswordDeleteError):
        keyring.delete_password(KEYRING_SERVICE, name)
