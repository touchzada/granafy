"""
AI Financial Advisor API routes.
Provides streaming chat and auto-analysis endpoints.
"""

import os
import json
import uuid
from datetime import date
from typing import Optional

import httpx
import logging
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_active_user
from app.core.database import get_async_session
from app.models.user import User
from app.services.ai_service import get_financial_context, get_default_config, DEFAULT_SYSTEM_PROMPT

router = APIRouter(prefix="/api/ai", tags=["ai"])

# ── Config persistence (in-memory + env for simplicity) ──

_agent_config: dict | None = None


def _get_config() -> dict:
    global _agent_config
    if _agent_config is None:
        _agent_config = get_default_config()
    return _agent_config


def _save_config(config: dict) -> None:
    global _agent_config
    _agent_config = config


# ── Schemas ──

class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    month: Optional[str] = None  # YYYY-MM-DD


class AnalyzeRequest(BaseModel):
    month: Optional[str] = None  # YYYY-MM-DD


# ── LLM Gateway ──

PROVIDER_URLS = {
    "abacusai": "https://apps.abacus.ai/v1/chat/completions",
    "openai": "https://api.openai.com/v1/chat/completions",
    "anthropic": "https://api.anthropic.com/v1/messages",
}

PROVIDER_ENV_KEYS = {
    "abacusai": "ABACUSAI_API_KEY",
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
}

CREATE_TRANSACTION_TOOL = {
    "type": "function",
    "function": {
        "name": "create_transaction",
        "description": "Cria uma nova transação financeira (gasto/saída ou ganho/entrada) no Granafy.",
        "parameters": {
            "type": "object",
            "properties": {
                "account_id": {"type": "string", "description": "ID UUID da conta onde ocorreu a transação. OBRIGATÓRIO. Busque o ID exato na seção 'CONTAS CADASTRADAS'."},
                "amount": {"type": "number", "description": "Valor numérico absoluto (positivo) da transação."},
                "description": {"type": "string", "description": "Descrição breve do lançamento (ex: Uber, Cabelereiro, Salário, iFood)."},
                "type": {"type": "string", "enum": ["debit", "credit"], "description": "Tipo da transação: 'debit' para gastos, 'credit' para ganhos."},
                "date": {"type": "string", "description": "Data no formato YYYY-MM-DD. Use a data de hoje se não tiver certeza."},
                "category_id": {"type": "string", "description": "ID UUID da categoria correspondente. Busque nas 'CATEGORIAS' do contexto. Se nenhuma se encaixar, passe string vazia."}
            },
            "required": ["account_id", "amount", "description", "type", "date"]
        }
    }
}

async def execute_create_transaction_tool(args: dict, session: AsyncSession, user_id: uuid.UUID) -> dict:
    from app.schemas.transaction import TransactionCreate
    from app.services import transaction_service
    from decimal import Decimal
    try:
        cat_id = args.get("category_id")
        data = TransactionCreate(
            account_id=uuid.UUID(args["account_id"]),
            amount=Decimal(str(args["amount"])),
            description=args["description"],
            type=args["type"],
            date=date.fromisoformat(args.get("date", str(date.today()))),
            category_id=uuid.UUID(cat_id) if cat_id else None
        )
        tx = await transaction_service.create_transaction(session, user_id, data)
        return {"success": True, "message": f"{args['type']} '{args['description']}' de R${args['amount']} registrado na conta.", "transaction_id": str(tx.id)}
    except Exception as e:
        return {"success": False, "error": str(e)}


def _resolve_provider(config: dict) -> tuple[str, str, str]:
    """Resolve the provider, API URL and API key from config."""
    provider = config.get("provider", "abacusai")
    api_url = PROVIDER_URLS.get(provider, PROVIDER_URLS["abacusai"])

    # Use per-config key first, then env var fallback
    api_key = config.get("apiKey") or os.environ.get(
        PROVIDER_ENV_KEYS.get(provider, "ABACUSAI_API_KEY"),
        "5a31a86468dc4bccab2b97c55a29d889" if provider == "abacusai" else ""
    )
    return provider, api_url, api_key


def _build_headers(provider: str, api_key: str) -> dict:
    """Build provider-specific HTTP headers."""
    if provider == "anthropic":
        return {
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        }
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }


def _build_payload(provider: str, messages: list[dict], config: dict, include_tools: bool = False) -> dict:
    """Build provider-specific request payload."""
    model = config.get("model", "gemini-3.1-pro-preview")
    temperature = config.get("temperature", 0.15)
    max_tokens = config.get("maxTokens", 12288)

    if provider == "anthropic":
        # Anthropic Messages API format
        system_msg = ""
        api_messages = []
        for m in messages:
            if m["role"] == "system":
                system_msg = m["content"]
            elif m["role"] in ("user", "assistant"):
                api_messages.append({"role": m["role"], "content": m["content"] or ""})
            elif m["role"] == "tool":
                api_messages.append({"role": "user", "content": f"[Tool Result] {m['content']}"})
        payload = {
            "model": model,
            "messages": api_messages,
            "stream": True,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if system_msg:
            payload["system"] = system_msg
        # Anthropic doesn't support OpenAI-style tools natively through this format
        return payload

    # OpenAI-compatible format (AbacusAI, OpenAI)
    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "temperature": temperature,
    }
    # OpenAI newer models require max_completion_tokens instead of max_tokens
    if provider == "openai":
        payload["max_completion_tokens"] = max_tokens
        # OpenAI supports stream_options for proper SSE termination
        payload["stream_options"] = {"include_usage": True}
    else:
        payload["max_tokens"] = max_tokens
    if include_tools:
        payload["tools"] = [CREATE_TRANSACTION_TOOL]
    return payload


async def _stream_anthropic(messages: list[dict], config: dict, session: AsyncSession = None, user_id: uuid.UUID = None):
    """Stream from Anthropic Messages API, translating SSE to OpenAI-compatible format."""
    _, api_url, api_key = _resolve_provider(config)
    if not api_key:
        yield 'data: {"choices":[{"delta":{"content":"⚠️ ANTHROPIC_API_KEY não configurada."}}]}\n\n'
        yield "data: [DONE]\n\n"
        return

    headers = _build_headers("anthropic", api_key)
    payload = _build_payload("anthropic", messages, config)

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", api_url, headers=headers, json=payload) as response:
            if response.status_code != 200:
                error_body = await response.aread()
                yield f'data: {{"choices":[{{"delta":{{"content":"❌ Erro Anthropic ({response.status_code}): {error_body.decode()[:200]}"}}}}]}}\n\n'
                yield "data: [DONE]\n\n"
                return

            async for line in response.aiter_lines():
                if line.strip() and line.startswith("data: "):
                    data_str = line[6:]
                    if data_str == "[DONE]":
                        continue
                    try:
                        data = json.loads(data_str)
                        event_type = data.get("type", "")
                        if event_type == "content_block_delta":
                            text = data.get("delta", {}).get("text", "")
                            if text:
                                # Translate to OpenAI SSE format
                                yield f'data: {{"choices":[{{"delta":{{"content":{json.dumps(text)}}}}}]}}\n\n'
                        elif event_type == "message_stop":
                            pass
                    except json.JSONDecodeError:
                        pass
    yield "data: [DONE]\n\n"


logger = logging.getLogger("ai_gateway")

async def _stream_openai_compat(messages: list[dict], config: dict, session: AsyncSession = None, user_id: uuid.UUID = None):
    """Stream from OpenAI-compatible APIs (AbacusAI, OpenAI), handling function calling."""
    provider, api_url, api_key = _resolve_provider(config)

    if not api_key:
        yield f'data: {{"choices":[{{"delta":{{"content":"⚠️ API key não configurada para {provider}."}}}}]}}\n\n'
        yield "data: [DONE]\n\n"
        return

    include_tools = bool(session and user_id)
    payload = _build_payload(provider, messages, config, include_tools=include_tools)
    headers = _build_headers(provider, api_key)

    logger.info(f"[AI] Provider={provider} Model={payload.get('model')} URL={api_url}")

    has_tool_call = False
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            async with client.stream("POST", api_url, headers=headers, json=payload) as response:
                if response.status_code != 200:
                    error_body = await response.aread()
                    error_text = error_body.decode()[:300]
                    logger.error(f"[AI] API error {response.status_code}: {error_text}")
                    yield f'data: {{"choices":[{{"delta":{{"content":"❌ Erro da API ({response.status_code}): {error_body.decode()[:200]}"}}}}]}}\n\n'
                    yield "data: [DONE]\n\n"
                    return

                tool_call_buffer = {}

                async for line in response.aiter_lines():
                    if line.strip() and line.startswith("data: "):
                        data_str = line[6:]
                        if data_str == "[DONE]":
                            continue
                        
                        try:
                            data = json.loads(data_str)
                            choices = data.get("choices", [])
                            if not choices:
                                continue
                            delta = choices[0].get("delta", {})
                            
                            if "tool_calls" in delta:
                                has_tool_call = True
                                for tc in delta["tool_calls"]:
                                    idx = tc["index"]
                                    if idx not in tool_call_buffer:
                                        tool_call_buffer[idx] = {"id": tc.get("id", ""), "function": {"name": tc["function"].get("name", ""), "arguments": tc["function"].get("arguments", "")}}
                                    else:
                                        if "id" in tc and tc["id"]: tool_call_buffer[idx]["id"] += tc["id"]
                                        if tc.get("function", {}).get("name"): tool_call_buffer[idx]["function"]["name"] += tc["function"]["name"]
                                        if tc.get("function", {}).get("arguments"): tool_call_buffer[idx]["function"]["arguments"] += tc["function"]["arguments"]
                            elif "content" in delta and delta["content"] and not has_tool_call:
                                yield f"{line}\n\n"
                        except (json.JSONDecodeError, KeyError, IndexError) as e:
                            logger.debug(f"[AI] Parse skip: {e}")
                            pass

            # Tool call handling — still inside the httpx client context
            if has_tool_call and session and user_id:
                logger.info(f"[AI] Executing {len(tool_call_buffer)} tool calls")
                tool_calls_list = []
                for idx in sorted(tool_call_buffer.keys()):
                    tc = tool_call_buffer[idx]
                    tool_calls_list.append({"id": tc["id"], "type": "function", "function": {"name": tc["function"]["name"], "arguments": tc["function"]["arguments"]}})
                
                messages.append({"role": "assistant", "content": None, "tool_calls": tool_calls_list})
                
                for tc in tool_calls_list:
                    if tc["function"]["name"] == "create_transaction":
                        args = json.loads(tc["function"]["arguments"])
                        result = await execute_create_transaction_tool(args, session, user_id)
                        messages.append({"role": "tool", "tool_call_id": tc["id"], "name": "create_transaction", "content": json.dumps(result)})
                
                payload["messages"] = messages
                
                async with client.stream("POST", api_url, headers=headers, json=payload) as response2:
                    if response2.status_code != 200:
                        yield 'data: {"choices":[{"delta":{"content":"❌ Falha após executar a ferramenta internamente."}}]}\n\n'
                        yield "data: [DONE]\n\n"
                        return
                    async for line in response2.aiter_lines():
                        if line.strip() and line.startswith("data: "):
                            if line == "data: [DONE]":
                                yield line + "\n\n"
                                continue
                            yield f"{line}\n\n"
                return

        except httpx.ReadTimeout:
            logger.error("[AI] Request timed out")
            yield 'data: {"choices":[{"delta":{"content":"⏳ Timeout: a API demorou demais para responder."}}]}\n\n'
        except Exception as e:
            logger.error(f"[AI] Unexpected error: {e}")
            yield f'data: {{"choices":[{{"delta":{{"content":"❌ Erro inesperado: {str(e)[:150]}"}}}}]}}\n\n'
            
        if not has_tool_call:
            yield "data: [DONE]\n\n"


async def _stream_llm(messages: list[dict], config: dict, session: AsyncSession = None, user_id: uuid.UUID = None):
    """Route to the correct provider stream handler."""
    provider = config.get("provider", "abacusai")
    if provider == "anthropic":
        async for chunk in _stream_anthropic(messages, config, session, user_id):
            yield chunk
    else:
        async for chunk in _stream_openai_compat(messages, config, session, user_id):
            yield chunk


# ── Endpoints ──

@router.post("/chat")
async def chat(
    request: ChatRequest,
    session: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
):
    """Stream AI chat with financial context."""
    config = _get_config()

    # Parse month
    month = None
    if request.month:
        try:
            month = date.fromisoformat(request.month)
        except ValueError:
            pass

    # Get financial context
    financial_context = await get_financial_context(session, user.id, month)

    # Build system message
    system_content = f"""{config.get("systemPrompt", DEFAULT_SYSTEM_PROMPT)}

════════════════════════════════════════
DADOS FINANCEIROS ATUAIS DO USUÁRIO
════════════════════════════════════════
{financial_context}"""

    # Build messages for LLM
    llm_messages = [
        {"role": "system", "content": system_content},
        *[{"role": m.role, "content": m.content} for m in request.messages],
    ]

    return StreamingResponse(
        _stream_llm(llm_messages, config, session=session, user_id=user.id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/analyze")
async def analyze(
    request: AnalyzeRequest,
    session: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
):
    """Run automatic macro financial analysis."""
    config = _get_config()

    # Parse month
    month = None
    if request.month:
        try:
            month = date.fromisoformat(request.month)
        except ValueError:
            pass

    # Get financial context
    financial_context = await get_financial_context(session, user.id, month)

    # Build system message
    system_content = f"""{config.get("systemPrompt", DEFAULT_SYSTEM_PROMPT)}

════════════════════════════════════════
DADOS FINANCEIROS ATUAIS DO USUÁRIO
════════════════════════════════════════
{financial_context}"""

    # Build analysis prompt
    analysis_prompt = """Execute uma análise financeira completa e abrangente dos dados acima.

Siga OBRIGATORIAMENTE o formato de resposta definido no seu prompt mestre:
1. RESUMO EXECUTIVO
2. INDICADORES QUANTITATIVOS (TP, IC, CG, Score, Meses de Sobrevivência)
3. MAPA DE GASTOS (top categorias, comparação)
4. ANÁLISE DE CENÁRIOS (Base, Conservador, Emergência)
5. CLASSIFICAÇÃO FINAL DE SAÚDE FINANCEIRA
6. SINAIS DE ALERTA
7. POSIÇÃO PATRIMONIAL
8. RECOMENDAÇÕES (ações concretas com valores)
9. PROJEÇÃO (30/60/90 dias)

Calcule TODOS os indicadores com fórmulas explícitas. Seja cirúrgico."""

    llm_messages = [
        {"role": "system", "content": system_content},
        {"role": "user", "content": analysis_prompt},
    ]

    return StreamingResponse(
        _stream_llm(llm_messages, config),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/config")
async def get_config(user: User = Depends(current_active_user)):
    """Get current agent configuration."""
    return _get_config()


class ConfigUpdate(BaseModel):
    name: Optional[str] = None
    provider: Optional[str] = None
    apiKey: Optional[str] = None
    model: Optional[str] = None
    systemPrompt: Optional[str] = None
    temperature: Optional[float] = None
    maxTokens: Optional[int] = None
    tonePreference: Optional[str] = None


@router.post("/config")
async def update_config(
    update: ConfigUpdate,
    user: User = Depends(current_active_user),
):
    """Update agent configuration."""
    config = _get_config()

    if update.name is not None:
        config["name"] = update.name
    if update.provider is not None:
        config["provider"] = update.provider
    if update.apiKey is not None:
        config["apiKey"] = update.apiKey
    if update.model is not None:
        config["model"] = update.model
    if update.systemPrompt is not None:
        config["systemPrompt"] = update.systemPrompt
    if update.temperature is not None:
        config["temperature"] = update.temperature
    if update.maxTokens is not None:
        config["maxTokens"] = update.maxTokens
    if update.tonePreference is not None:
        config["tonePreference"] = update.tonePreference

    _save_config(config)
    return {"success": True, "config": config}
