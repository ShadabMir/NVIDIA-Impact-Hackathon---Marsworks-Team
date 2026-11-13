from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "AccessRoute AI Journey Planner"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = ""
    ollama_timeout_seconds: float = Field(default=90, gt=0, le=300)
    max_upload_mb: int = Field(default=10, ge=1, le=25)
    database_path: str = ".data/accessroute.sqlite3"
    cookie_secure: bool = False
    ors_api_key: str = ""
    ors_base_url: str = "https://api.openrouteservice.org"
    # Text model for the Royal Hallamshire agent (tool calling). Separate from the vision model above.
    ollama_agent_model: str = "nemotron-3-nano:30b"
    live_weather: bool = True
    # Keep the model loaded between agent calls (Ollama keep_alive). "0" unloads after every call.
    ollama_keep_alive: str = "30m"

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
