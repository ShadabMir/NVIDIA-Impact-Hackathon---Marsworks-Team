"""Small local SQLite account store with server-side, revocable cookie sessions."""
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import Field, field_validator

from app.config import get_settings
from app.schemas import AccessRequirements, StrictModel

router = APIRouter(prefix="/api/v1", tags=["Accounts and preferences"])
COOKIE = "accessroute_session"
SESSION_SECONDS = 60 * 60 * 24
ITERATIONS = 600_000
MobilityAid = Literal["powered_wheelchair", "manual_wheelchair", "walking_aid", "limited_mobility", "no_aid"]


def preset(aid: str) -> AccessRequirements:
    distance = {"powered_wheelchair": 150, "manual_wheelchair": 150,
                "walking_aid": 50, "limited_mobility": 100, "no_aid": 300}[aid]
    wheelchair = aid in {"powered_wheelchair", "manual_wheelchair"}
    return AccessRequirements(
        wheelchair_user=wheelchair, step_free_required=aid != "no_aid",
        max_continuous_walking_m=distance, max_total_walking_m=distance * 2,
        min_transfer_minutes=10, max_gradient_percent=5,
        boarding_buffer_minutes=3 if wheelchair else 0,
    )


class Profile(StrictModel):
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=254)
    default_hospital_id: Literal["royal-hallamshire"] = "royal-hallamshire"
    default_starting_address: str = Field(default="", max_length=500)
    mobility_aid: MobilityAid = "manual_wheelchair"
    access: AccessRequirements

    @field_validator("email")
    @classmethod
    def valid_email(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid email address")
        return value

    @field_validator("first_name", "last_name")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Name cannot be blank")
        return value.strip()


class RegisterRequest(Profile):
    password: str = Field(min_length=10, max_length=256)


class LoginRequest(StrictModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=1, max_length=256)


def database():
    path = Path(get_settings().database_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL, profile TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS user_workspace (
            user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            appointment TEXT,
            agent_request TEXT,
            updated_at TEXT NOT NULL
        );
    """)
    if connection.execute("PRAGMA user_version").fetchone()[0] == 0:
        connection.execute("PRAGMA user_version=1")
    return connection


def password_hash(password: str, salt: str | None = None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), ITERATIONS)
    return f"{salt}${digest.hex()}"


def check_origin(request: Request):
    """Reject cross-origin account writes; allow same-origin Vite proxy and explicit CORS origins."""
    origin = request.headers.get("origin")
    host = request.headers.get("host", "")
    same_host = origin in {f"http://{host}", f"https://{host}"}
    # Forwarded headers are not used as an unrestricted origin allowlist.
    if origin and not same_host and origin not in get_settings().allowed_origins:
        raise HTTPException(403, "Untrusted request origin")


def current_user(request: Request):
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(401, "Please sign in")
    connection = database()
    try:
        row = connection.execute(
            "SELECT users.* FROM users JOIN sessions ON sessions.user_id=users.id "
            "WHERE sessions.token_hash=? AND sessions.expires>?",
            (hashlib.sha256(token.encode()).hexdigest(), time.time()),
        ).fetchone()
    finally:
        connection.close()
    if row is None:
        raise HTTPException(401, "Your session has expired; please sign in")
    return dict(row)


def set_session(response: Response, user_id: str):
    token = secrets.token_urlsafe(32)
    connection = database()
    try:
        with connection:
            connection.execute("DELETE FROM sessions WHERE expires<=?", (time.time(),))
            connection.execute("INSERT INTO sessions VALUES (?,?,?)", (
                hashlib.sha256(token.encode()).hexdigest(), user_id, time.time() + SESSION_SECONDS,
            ))
    finally:
        connection.close()
    response.set_cookie(COOKIE, token, httponly=True, samesite="lax", secure=get_settings().cookie_secure,
                        max_age=SESSION_SECONDS, path="/")


@router.get("/access/defaults")
def defaults():
    return {
        "presets": {aid: preset(aid).model_dump() for aid in [
            "powered_wheelchair", "manual_wheelchair", "walking_aid", "limited_mobility", "no_aid",
        ]},
        "notice": "Suggested planning preferences, not an assessment of individual ability. Edit in Settings.",
        "sources": [
            {"title": "DfT Inclusive Mobility, sections 3.4 and 4.3",
             "url": "https://www.gov.uk/government/publications/inclusive-mobility-making-transport-accessible-for-passengers-and-pedestrians",
             "use": "150 m wheelchair / 50 m stick-cane / 100 m mobility impairment without stick; prefer slopes no steeper than 5%. Individuals vary."},
            {"title": "App planning assumptions",
             "use": "3 minutes per wheelchair boarding, 10-minute transfer margin, total-distance cap twice continuous distance, and 300 m no-aid preset are editable engineering assumptions, not published ability limits."},
        ],
    }


@router.post("/auth/register", response_model=Profile, dependencies=[Depends(check_origin)])
def register(payload: RegisterRequest, response: Response):
    profile = Profile.model_validate(payload.model_dump(exclude={"password"}))
    user_id = secrets.token_hex(16)
    connection = database()
    try:
        with connection:
            connection.execute("INSERT INTO users VALUES (?,?,?,?)", (
                user_id, profile.email, password_hash(payload.password), profile.model_dump_json(),
            ))
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "An account already exists for this email; please sign in") from exc
    finally:
        connection.close()
    set_session(response, user_id)
    return profile


@router.post("/auth/login", response_model=Profile, dependencies=[Depends(check_origin)])
def login(payload: LoginRequest, response: Response):
    connection = database()
    try:
        row = connection.execute("SELECT * FROM users WHERE email=?", (payload.email.strip().lower(),)).fetchone()
    finally:
        connection.close()
    stored = row["password_hash"] if row else "00" * 16 + "$" + "00" * 32
    candidate = password_hash(payload.password, stored.split("$")[0])
    if not hmac.compare_digest(stored, candidate) or row is None:
        raise HTTPException(401, "Email or password is incorrect")
    set_session(response, row["id"])
    return json.loads(row["profile"])


@router.post("/auth/logout", dependencies=[Depends(check_origin)])
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE, "")
    connection = database()
    try:
        with connection:
            connection.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
    finally:
        connection.close()
    response.delete_cookie(COOKIE, path="/", secure=get_settings().cookie_secure, httponly=True, samesite="lax")
    return {"signed_out": True}


@router.get("/profile", response_model=Profile)
def profile(user=Depends(current_user)):
    return json.loads(user["profile"])


@router.put("/profile", response_model=Profile, dependencies=[Depends(check_origin)])
def update_profile(payload: Profile, user=Depends(current_user)):
    connection = database()
    try:
        with connection:
            connection.execute("UPDATE users SET email=?, profile=? WHERE id=?", (
                payload.email, payload.model_dump_json(), user["id"],
            ))
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "This email is already registered") from exc
    finally:
        connection.close()
    return payload
