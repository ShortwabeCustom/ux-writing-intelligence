"""Contratos HTTP. Compatibles con `src/analyze-contracts.ts` del plugin."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Severity = Literal["low", "medium", "high"]


class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str
    context: str = ""
    locale: str = "es-MX"


class AnalyzeIssue(BaseModel):
    category: str
    severity: Severity
    term: str | None = None
    reason: str


class AnalyzeResponse(BaseModel):
    text: str
    locale: str
    score: float = Field(ge=0, le=100)
    severity: Severity
    clarity: float = Field(ge=1, le=5)
    concision: float = Field(ge=1, le=5)
    utility: float = Field(ge=1, le=5)
    jargon: bool
    predictability: float = Field(ge=1, le=5)
    orthography: float = Field(ge=1, le=5)
    issues: list[AnalyzeIssue]
    reason: str
    suggestion: str


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str
    model: str


class RuntimeStatusResponse(BaseModel):
    runtime: Literal["ready", "degraded"]
    ollama: Literal["ready", "unavailable"]
    model: str
    model_available: bool


class ErrorResponse(BaseModel):
    code: str
    message: str


# Esquema JSON que se le impone a Ollama (STEP 22).
# Nota: NO incluye 'orthography' ni 'issues'. La ortografía es determinista y
# los issues se construyen con evidencia del producto, no con opinión del modelo.
OLLAMA_SCHEMA = {
    "type": "object",
    "properties": {
        "clarity": {"type": "integer", "minimum": 1, "maximum": 5},
        "concision": {"type": "integer", "minimum": 1, "maximum": 5},
        "utility": {"type": "integer", "minimum": 1, "maximum": 5},
        "predictability": {"type": "integer", "minimum": 1, "maximum": 5},
        "jargon": {"type": "boolean"},
        "reason": {"type": "string"},
        "suggestion": {"type": "string"},
    },
    "required": ["clarity", "concision", "utility", "predictability",
                 "jargon", "reason", "suggestion"],
}
