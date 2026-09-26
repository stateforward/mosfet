"""Chat with mosfet from the browser, by text message.

A small local HTTP bridge around a mosfet Bot holding a real library phone
(`mosfet.devices.smart_phone.SmartPhone`). The bridge is that phone's messaging service — the
carrier — and the browser is the far end of the line:

    POST /api/sms  -> smart_phone.SmsTextEvent into the phone (sender "visitor") -> display, ding, and a
                   phone.notification (carrying the new message) dispatched to the bot holding it.
    bot texts back -> phone.send_text_message -> firmware publishes
                   phone.service.text_message_send_requested to the carrier (`_Carrier`, the
                   phone.Service) -> for "visitor" it becomes the HTTP reply, and the carrier
                   dispatches phone.service.text_message_sent (same event id) back to the firmware.

One turn at a time per session. The library does not tie an outgoing text to the message it answers, so the
tightest correlation available is: the first text to "visitor" the phone asks to send after this
turn's message was delivered. No text within `_REPLY_TIMEOUT_S` is reported as a problem, not
papered over. Texts to any other address fail honestly (the carrier only reaches the browser).
The bridge wires only what exists; `MISSING` lists anything absent, and /api/health reports
ready: true only when nothing is.

Cognition is wired like the phone bot example's `_phone_cognition`, pointed at the
OpenAI-compatible proxy cpa.willen.dev (model glm-5.3-flash-exl3):

    Intuition  -> TypeSafe system_one (mosfet.providers.typesafe.Processor)
    Reasoning  -> openai_compat over cpa.willen.dev (mosfet.providers.openai_compat.Processor)
    Reflection -> openai_compat over cpa.willen.dev (owns the shared short-term Memory)

    uv run --project workshop workshop/server.py        # listens on 127.0.0.1:8787

Every chat session gets its own mosfet (own phone, memory, cognition), started when the page
opens a session and stopped when it ends it or it sits idle for `_IDLE_S`.

Endpoints:
    GET  /api/health             -> {"ready": bool, "model": str | null, "problem": str | null}
    POST /api/session            -> {"session": str | null, "problem": str | null}   starts a new mosfet
    POST /api/sms                {"session": str, "text": str} -> {"reply": str | null, "problem": str | null}
                                 (404 when that session's mosfet has ended)
    POST /api/session/<id>/end   stops that session's mosfet (sendBeacon-friendly)

Credentials: TYPESAFE_API_KEY and BOT_LLM_API_KEY (or BOT_OPENAI_API_KEY / OPENAI_API_KEY), from the
process environment or the .env files in `_ENV_FILES` (later files win). The reasoning
model is BOT_REASONING_MODEL or glm-5.3-flash-exl3; the endpoint is BOT_LLM_BASE_URL or
https://cpa.willen.dev/v1. Without keys the bridge still runs and says so.

Only binds to localhost: it spends your model credits for anyone who can reach it.
"""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import json
import logging
import os
import pathlib
import re
import threading
import time
import typing
import uuid
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import hsm
from mosfet import telemetry
from mosfet import abilities
from mosfet.abilities import cognition, memory, listening, speaking
from mosfet.bot import Bot as MosfetBot
from mosfet.device import Device as device
from mosfet.devices import smart_phone
from mosfet.devices.audio import microphone as audio_microphone
from mosfet.devices.audio import speaker as audio_speaker
from mosfet.environment import Environment
from mosfet.providers import gemini as gemini_provider
from mosfet.providers import openai_compat
from mosfet.providers.typesafe import Processor as TypeSafeProcessor

_LOG = logging.getLogger("mosfet_workshop")
_HERE = pathlib.Path(__file__).resolve()
_WORKSHOP = _HERE.parent
_LIBRARY = _WORKSHOP.parent / "mosfet.py"
_ENV_FILES = (
    _LIBRARY / ".env",
    _LIBRARY / "examples" / "sms_chat_bot" / ".env",
    pathlib.Path.home() / "VSCode" / "stateforward" / "bot" / "bot.py" / ".env",
    _WORKSHOP / ".env",
)
_REASONING_MODEL = "sparks/GLM-5.3-Flash-EXL3"
_LLM_BASE_URL = os.environ.get("BOT_LLM_BASE_URL") or "https://cpa.willen.dev/v1"
_MAX_TEXT = 4000
_REPLY_TIMEOUT_S = 90.0
_IDLE_S = 30 * 60
"""A session nobody has texted for this long has its mosfet stopped."""
_VISITOR = "visitor"
"""The browser's address on the line: every message from the web UI is from this sender."""


class Bench:
    """The real teach/run loop.

    A paid run gives the job to the model and keeps what it produced. Teaching
    distills your one correction into a rule. Every run after that fires the
    pinned rule from disk: no model call, cost zero. The rule file is the
    product — the thing that makes the second run free.
    """

    _RULES_PATH = pathlib.Path(os.environ.get("BOT_RULES_PATH") or (_WORKSHOP / ".data" / "rules.json"))

    def __init__(self, settings: dict[str, str]) -> None:
        self.api_key = _first(settings, "BOT_LLM_API_KEY", "BOT_OPENAI_API_KEY", "OPENAI_API_KEY") or ""
        self.model = os.environ.get("BOT_BENCH_MODEL") or "sparks/GLM-5.3-Flash-EXL3"
        self.rules_path = self._RULES_PATH
        self.rules: dict[str, dict[str, typing.Any]] = {}
        if self.rules_path.exists():
            try:
                loaded = json.loads(self.rules_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    self.rules = {str(k): v for k, v in loaded.items() if isinstance(v, dict)}
            except (json.JSONDecodeError, OSError):
                _LOG.warning("rules file unreadable, starting empty: %s", self.rules_path)
        self.last_run: dict[str, dict[str, typing.Any]] = {}

    # -- persistence -------------------------------------------------------

    def _save(self) -> None:
        self.rules_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.rules_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(self.rules, indent=2) + "\n", encoding="utf-8")
        tmp.replace(self.rules_path)

    # -- model -------------------------------------------------------------

    def _complete(self, system: str, user: str) -> str:
        client = openai_compat.ChatClient(model=self.model, base_url=_LLM_BASE_URL, api_key=self.api_key)
        response = client.create_chat_completion(
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        choices = response.get("choices") if isinstance(response, dict) else None
        message = choices[0].get("message") if isinstance(choices, list) and choices else None
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, str) or not content.strip():
            raise RuntimeError("model returned no content")
        return content

    @staticmethod
    def _json_block(text: str) -> dict[str, typing.Any] | None:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            parsed = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None

    # -- endpoints ---------------------------------------------------------

    def list_rules(self) -> dict[str, object]:
        return {"rules": self.rules, "model": self.model}

    def forget(self, task: str) -> dict[str, object]:
        self.rules.pop(task, None)
        self._save()
        return {"task": task, "forgotten": True}

    def run(self, task: str, ask: str) -> dict[str, object]:
        rule = self.rules.get(task)
        if rule is not None:
            return {
                "mode": "free",
                "cost": 0.0,
                "steps": rule.get("steps") or [],
                "result": rule.get("result") or "",
                "skill": rule.get("skill") or "",
            }
        if not self.api_key:
            return {"mode": "paid", "problem": "no model key configured"}
        raw = self._complete(
            "You are mosfet, a small software robot doing a real job. "
            'Respond with ONLY JSON: {"steps":["..."],"result":"..."} '
            "where steps are 3-6 short past-tense actions you took and result is the deliverable, one sentence.",
            ask,
        )
        parsed = self._json_block(raw) or {"steps": [], "result": raw.strip()[:400]}
        run = {
            "steps": [str(s) for s in (parsed.get("steps") or [])][:8],
            "result": str(parsed.get("result") or "")[:600],
        }
        self.last_run[task] = run
        return {"mode": "paid", "cost": 0.04, **run}

    def teach(self, task: str, correction: str) -> dict[str, object]:
        last = self.last_run.get(task) or {}
        if not self.api_key:
            return {"problem": "no model key configured"}
        raw = self._complete(
            "You are mosfet's teacher. You are given what the bot did and the one correction it was told. "
            'Distill the correction into a rule. Respond with ONLY JSON: '
            '{"skill":"one short phrase naming what it learned","steps":["..."],"result":"..."} '
            "where steps are 3-6 short past-tense actions that now include the correction, and result is "
            "the corrected deliverable, one sentence.",
            f"Task: {task}\nWhat the bot did: {json.dumps(last)}\nCorrection: {correction}",
        )
        parsed = self._json_block(raw)
        if parsed is None or not parsed.get("skill"):
            return {"problem": "could not distill a rule from that correction"}
        rule = {
            "skill": str(parsed["skill"])[:200],
            "steps": [str(s) for s in (parsed.get("steps") or [])][:8],
            "result": str(parsed.get("result") or "")[:600],
            "learned_from": correction[:400],
        }
        self.rules[task] = rule
        self._save()
        return {"task": task, "skill": rule["skill"], **rule}


def _settings() -> dict[str, str]:
    """Process environment, overlaid by the .env files in order (later wins). Values are never logged."""
    prefixes = ("BOT_LLM_", "BOT_OPENAI_", "OPENAI_", "TYPESAFE_", "BOT_REASONING_", "BOT_REFLECTION_")
    values = {k: v for k, v in os.environ.items() if k.startswith(prefixes)}
    for path in _ENV_FILES:
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            values[key.strip()] = value.strip().strip("'\"")
    return values


def _first(values: dict[str, str], *names: str) -> str | None:
    return next((values[n] for n in names if values.get(n)), None)


# What texting mosfet needs from the library and does not have yet. Listed, not worked around:
# the bridge wires only what exists, and says so on every message until these land.
MISSING: tuple[str, ...] = ()


class _Carrier:
    """The phone's messaging service (``phone.Service``), as the library defines it.

    Only the browser is reachable on this line. A send request to "visitor" is handed to whichever
    browser turn is waiting and reported sent; one to any other address is reported failed. All of
    it runs on the bot's event loop: ``publish`` is called from inside the firmware.
    """

    def __init__(self) -> None:
        self._target: hsm.Instance | None = None
        self._waiting: asyncio.Future[str] | None = None

    async def attach(self, environment: Environment, target: hsm.Instance) -> None:
        del environment
        self._target = target

    async def detach(self, environment: Environment, target: hsm.Instance) -> None:
        del environment
        if self._target is target:
            self._target = None

    def expect_text(self) -> asyncio.Future[str]:
        """Open the one browser turn: the next text to "visitor" resolves the returned future."""
        self._waiting = asyncio.get_running_loop().create_future()
        return self._waiting

    def publish(self, ctx: hsm.Context, event: hsm.Event[typing.Any]) -> None:
        _LOG.info("phone published %s", event.name)
        if event.name != smart_phone.ServiceTextMessageSendRequestedEvent.name:
            return
        request = event.data
        assert isinstance(request, smart_phone.SendTextMessageData)
        if request.to != _VISITOR:
            verdict: hsm.Event[typing.Any] = smart_phone.ServiceTextMessageSendFailedEvent.with_data(
                smart_phone.TextMessageSendFailedData(
                    to=request.to, text=request.text, failure_kind="remote_unavailable"
                )
            )
        else:
            waiting, self._waiting = self._waiting, None
            if waiting is None or waiting.done():
                _LOG.warning("text to the visitor arrived with no browser turn waiting; it is dropped from the page")
            else:
                waiting.set_result(request.text)
            verdict = smart_phone.ServiceTextMessageSentEvent.with_data(
                smart_phone.TextMessageSentData(to=request.to, text=request.text)
            )
        target = self._target
        if target is None:
            return
        # The verdict carries the request's envelope id: that is how firmware ties outcome to request.
        _ = asyncio.ensure_future(target.dispatch(ctx, dataclasses.replace(verdict, id=event.id)))


class _PhoneBot(MosfetBot):
    """A mosfet holding one phone. Bot is abstract by design: each bot declares its own body."""

    def __init__(self, *, handset: smart_phone.SmartPhone, cognition_ability: cognition.Cognition) -> None:
        super().__init__({"phone": handset}, cognition=cognition_ability)


class _ComposedBot(MosfetBot):
    """A bot assembled from a Builder spec: any devices, any input/output abilities."""

    def __init__(
        self,
        *,
        name: str,
        devices: dict[str, device],
        cognition: cognition.Cognition,
        input: tuple[abilities.Ability[typing.Any, typing.Any], ...] = (),
        output: tuple[abilities.Ability[typing.Any, typing.Any], ...] = (),
    ) -> None:
        self.name = name
        super().__init__(devices, cognition=cognition, input=input, output=output)


def _gemini_key(settings: dict[str, str]) -> str:
    return _first(settings, "BOT_GEMINI_API_KEY", "GEMINI_API_KEY") or ""


def _cognition(settings: dict[str, str]) -> tuple[cognition.Cognition, str]:
    """Wire Cognition for a fresh mosfet.

    Wire reasoning and reflection to the OpenAI-compatible proxy at cpa.willen.dev
    (model glm-5.3-flash-exl3). Gemini stood in while the OpenAI org had no
    credits; the proxy is the replacement.
    """

    llm_key = _first(settings, "BOT_LLM_API_KEY", "BOT_OPENAI_API_KEY", "OPENAI_API_KEY") or ""
    reasoning_model = _first(settings, "BOT_REASONING_MODEL") or _REASONING_MODEL
    reflection_model = _first(settings, "BOT_REFLECTION_MODEL") or reasoning_model

    def luna(model: str, provider: str) -> openai_compat.Processor:
        return openai_compat.Processor(
            generator=openai_compat.TextGenerator(
                client=openai_compat.ChatClient(
                    model=model,
                    base_url=_LLM_BASE_URL,
                    api_key=llm_key,
                ),
                provider=provider,
            )
        )

    store = memory.ShortTermMemory()
    _LOG.info(
        "cognition wired intuition=typesafe reasoning=%s reflection=%s",
        reasoning_model,
        reflection_model,
    )
    ability = cognition.Cognition(
        autonomy=cognition.Autonomy(memory=store),
        intuition=cognition.Intuition(processor=TypeSafeProcessor(api_key=_first(settings, "TYPESAFE_API_KEY"))),
        reasoning=cognition.Reasoning(
            processor=luna(reasoning_model, "gemini_reasoning"),
            memory=store,
        ),
        reflection=cognition.Reflection(
            processor=luna(reflection_model, "gemini_reflection"),
            memory=store,
        ),
    )
    return ability, f"intuition typesafe · reasoning {reasoning_model}"


@dataclass
class Session:
    """One chat's own mosfet: its own phone, carrier, memory, and cognition. Nothing is shared between sessions."""

    body: _PhoneBot
    handset: smart_phone.SmartPhone
    carrier: _Carrier
    environment: Environment
    turn: threading.Lock = field(default_factory=threading.Lock)
    last_used: float = field(default_factory=time.monotonic)

    async def text(self, message: str) -> str | None:
        """Deliver the text, then wait for this mosfet to text the visitor back. ``None`` on timeout."""
        answer = self.carrier.expect_text()
        message_id = uuid.uuid4().hex
        await self.handset.dispatch(
            self.handset.context(),
            dataclasses.replace(
                smart_phone.SmsTextEvent.with_data(
                    smart_phone.SmsTextData(id=message_id, sender=_VISITOR, text=message)
                ),
                id=message_id,
            ),
        )
        try:
            return await asyncio.wait_for(answer, timeout=_REPLY_TIMEOUT_S)
        except TimeoutError:
            return None


class Builder:
    """Compose a real mosfet bot from a UI spec: catalog of parts, build, interact, stop.

    A spec is {"devices": ["phone", "microphone", "speaker"], "abilities": ["listening",
    "speaking"], "name": "..."}. Cognition is always wired (a bot that cannot think is a
    script). Devices and abilities are validated against the catalog; input abilities are
    those that observe devices, output abilities those that act. What is not offered in the
    catalog is listed in MISSING, not silently accepted.
    """

    DEVICES: dict[str, dict[str, str]] = {
        "phone": {"label": "smart phone", "describes": "texts: incoming SmsTextEvent, outgoing via send"},
        "microphone": {"label": "microphone", "describes": "hears environment sound"},
        "speaker": {"label": "speaker", "describes": "plays out sound"},
    }

    ABILITIES: dict[str, dict[str, object]] = {
        "listening": {
            "label": "listening",
            "kind": "input",
            "needs": ["microphone"],
            "describes": "turns sound into thought",
            "available": False,
            "note": "needs a voice-activity provider (mlx-audio) not installed in this workshop",
        },
        "speaking": {"label": "speaking", "kind": "output", "needs": ["speaker"], "describes": "utters text aloud", "available": True},
    }

    def __init__(self, workshop: Workshop) -> None:
        self.workshop = workshop

    def catalog(self) -> dict[str, object]:
        return {
            "devices": [{"id": k, **v} for k, v in self.DEVICES.items()],
            "abilities": [{"id": k, **v} for k, v in self.ABILITIES.items()],
            "cognition": {"label": "cognition", "describes": "always wired: intuition, reasoning, reflection"},
            "model": _LLM_BASE_URL,
        }

    def _validate(self, spec: dict[str, typing.Any]) -> tuple[list[str], list[str], str | None]:
        devices = [str(d) for d in spec.get("devices") or []]
        abilities = [str(a) for a in spec.get("abilities") or []]
        unknown = [d for d in devices if d not in self.DEVICES] + [a for a in abilities if a not in self.ABILITIES]
        if unknown:
            return devices, abilities, f"unknown parts: {', '.join(unknown)}"
        for ability_id in abilities:
            entry = self.ABILITIES[ability_id]
            if entry.get("available") is False:
                return devices, abilities, f"{ability_id} is not available here: {entry.get('note', '')}"
            missing = [n for n in entry.get("needs", []) if n not in devices]
            if missing:
                return devices, abilities, f"{ability_id} needs device(s): {', '.join(missing)}"
        return devices, abilities, None

    def build(self, spec: dict[str, typing.Any]) -> tuple[str | None, str | None]:
        devices, abilities, problem = self._validate(spec)
        if problem is not None:
            return None, problem
        if not self.workshop.ready:
            return None, self.workshop.problem

        async def boot() -> tuple[Session, str]:
            carrier = _Carrier()
            handset = smart_phone.SmartPhone(service=carrier) if "phone" in devices else None
            mic = audio_microphone.Microphone() if "microphone" in devices else None
            spk = audio_speaker.Speaker() if "speaker" in devices else None
            owned: dict[str, device] = {}
            if handset is not None:
                owned["phone"] = handset
            if mic is not None:
                owned["microphone"] = mic
            if spk is not None:
                owned["speaker"] = spk
            cognition_ability, label = _cognition(self.workshop.settings)
            parts: list[str] = [f"cognition"]
            input_abilities: tuple[abilities.Ability[typing.Any, typing.Any], ...] = ()
            output_abilities: tuple[abilities.Ability[typing.Any, typing.Any], ...] = ()
            if "listening" in abilities:
                input_abilities = (
                    listening.Listening(voice_activity_classifier=moonshine.VoiceActivityClassifier()),
                )
                parts.append("listening")
            if "speaking" in abilities:
                tts_client = gemini_provider.ChatClient(api_key=_gemini_key(self.workshop.settings))
                output_abilities = (
                    speaking.Speaking(encoder=gemini_provider.SpeechEncoder(client=tts_client)),
                )
                parts.append("speaking")
            name = str(spec.get("name") or "mosfet")[:40]
            body = _ComposedBot(name=name, devices=owned, cognition=cognition_ability, input=input_abilities, output=output_abilities)
            environment = Environment()
            await body.attach(environment)
            label = f"{name} [{' '.join(parts)}]"
            return Session(body, handset, carrier, environment), label

        try:
            session, label = asyncio.run_coroutine_threadsafe(boot(), self.workshop.loop).result(timeout=60)
        except Exception as error:  # noqa: BLE001 — surfaced to the UI as the problem
            _LOG.exception("bot failed to build")
            return None, f"bot failed to build: {error}"
        bot_id = uuid.uuid4().hex
        with self.workshop.lock:
            self.workshop.built[bot_id] = session
        _LOG.info("bot %s built (%s)", bot_id[:8], label)
        return bot_id, label

    def interact(self, bot_id: str, text: str) -> tuple[str | None, str | None, bool]:
        with self.workshop.lock:
            session = self.workshop.built.get(bot_id)
        if session is None:
            return None, "That bot is not running.", False
        if not session.turn.acquire(blocking=False):
            return None, "The bot is still on its last turn.", True
        try:
            answer = asyncio.run_coroutine_threadsafe(session.text(text), self.workshop.loop).result(
                timeout=_REPLY_TIMEOUT_S + 15
            )
        except Exception as error:  # noqa: BLE001
            _LOG.exception("bot turn failed")
            return None, f"The turn failed: {error}", True
        finally:
            session.turn.release()
        if answer is None:
            return None, f"The bot did not answer within {_REPLY_TIMEOUT_S:.0f}s.", True
        return answer, None, True

    def stop(self, bot_id: str) -> None:
        with self.workshop.lock:
            session = self.workshop.built.pop(bot_id, None)
        if session is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(session.body.detach(session.environment), self.workshop.loop).result(timeout=30)
        except Exception:  # noqa: BLE001
            _LOG.exception("bot %s did not stop cleanly", bot_id[:8])


class Workshop:
    """Starts a fresh mosfet per chat session and stops it when the session ends or goes idle.

    All bots run on one private event loop; each session's turns are serialised by its own lock.
    """

    def __init__(self) -> None:
        self.loop = asyncio.new_event_loop()
        threading.Thread(target=self.loop.run_forever, name="mosfet-bots", daemon=True).start()
        self.settings = _settings()
        self.sessions: dict[str, Session] = {}
        self.built: dict[str, Session] = {}
        self.lock = threading.Lock()
        self.model: str | None = None
        missing = [
            name
            for name, present in (
                ("TYPESAFE_API_KEY", _first(self.settings, "TYPESAFE_API_KEY")),
                ("BOT_GEMINI_API_KEY", _first(self.settings, "BOT_GEMINI_API_KEY", "GEMINI_API_KEY")),
            )
            if not present
        ]
        if missing:
            where = ", ".join(str(p) for p in _ENV_FILES)
            self.problem: str | None = f"Missing {', '.join(missing)}. Put them in one of: {where}"
        elif MISSING:
            self.problem = "Missing in the library: " + "; ".join(MISSING)
        else:
            self.problem = None
        threading.Thread(target=self._reap_idle, name="mosfet-reaper", daemon=True).start()

    @property
    def ready(self) -> bool:
        return self.problem is None

    def open(self) -> tuple[str | None, str | None]:
        """Start a new mosfet for a new chat. Returns (session id, problem)."""
        if not self.ready:
            return None, self.problem

        async def boot() -> tuple[Session, str]:
            carrier = _Carrier()
            handset = smart_phone.SmartPhone(service=carrier)
            ability, label = _cognition(self.settings)
            body = _PhoneBot(handset=handset, cognition_ability=ability)
            environment = Environment()
            await body.attach(environment)
            return Session(body, handset, carrier, environment), label

        try:
            session, label = asyncio.run_coroutine_threadsafe(boot(), self.loop).result(timeout=60)
        except Exception as error:  # noqa: BLE001 - surfaced to the UI as the problem
            _LOG.exception("mosfet failed to start")
            return None, f"mosfet failed to start: {error}"
        self.model = label
        session_id = uuid.uuid4().hex
        with self.lock:
            self.sessions[session_id] = session
            count = len(self.sessions)
        _LOG.info("session %s opened (%d running)", session_id[:8], count)
        return session_id, None

    def close(self, session_id: str) -> None:
        """Stop that session's mosfet. Unknown ids are already closed."""
        with self.lock:
            session = self.sessions.pop(session_id, None)
            count = len(self.sessions)
        if session is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(session.body.detach(session.environment), self.loop).result(timeout=30)
        except Exception:  # noqa: BLE001 - a bot that will not stop is logged, and dropped regardless
            _LOG.exception("session %s did not stop cleanly", session_id[:8])
        _LOG.info("session %s closed (%d running)", session_id[:8], count)

    def reply(self, session_id: str, text: str) -> tuple[str | None, str | None, bool]:
        """Text this session's mosfet and wait for its text back. Returns (reply, problem, session_known)."""
        with self.lock:
            session = self.sessions.get(session_id)
        if session is None:
            return None, "This chat's mosfet has ended.", False
        if not session.turn.acquire(blocking=False):
            return None, "mosfet is still answering your last message.", True
        try:
            session.last_used = time.monotonic()
            started = time.monotonic()
            answer = asyncio.run_coroutine_threadsafe(session.text(text), self.loop).result(
                timeout=_REPLY_TIMEOUT_S + 15
            )
        except Exception as error:  # noqa: BLE001
            _LOG.exception("turn failed")
            return None, f"The phone did not take the text: {error}", True
        finally:
            session.last_used = time.monotonic()
            session.turn.release()
        if answer is None:
            return None, f"mosfet got your text but did not text back within {_REPLY_TIMEOUT_S:.0f}s.", True
        _LOG.info("session %s reply after %.1fs", session_id[:8], time.monotonic() - started)
        return answer, None, True

    def _reap_idle(self) -> None:
        while True:
            time.sleep(60)
            now = time.monotonic()
            with self.lock:
                idle = [sid for sid, s in self.sessions.items() if now - s.last_used > _IDLE_S and not s.turn.locked()]
            for session_id in idle:
                _LOG.info("session %s idle for %.0f min", session_id[:8], _IDLE_S / 60)
                self.close(session_id)


_SESSION_PATH = re.compile(r"^/api/session/([0-9a-f]{32})/end$")


def _handler(workshop: Workshop, bench: Bench, builder: Builder) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "mosfet-workshop/0.2"

        def _send(self, status: int, body: dict[str, object]) -> None:
            payload = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def _json(self) -> dict[str, typing.Any] | None:
            try:
                length = min(int(self.headers.get("Content-Length", "0")), 64_000)
                data = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return None
            return data if isinstance(data, dict) else None

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/api/health":
                self._send(200, {"ready": workshop.ready, "model": workshop.model, "problem": workshop.problem})
            elif self.path == "/api/bench/rules":
                self._send(200, bench.list_rules())
            elif self.path == "/api/builder/catalog":
                self._send(200, builder.catalog())
            elif self.path == "/api/builder/bots":
                self._send(200, {"bots": sorted(workshop.built)})
            else:
                self._send(404, {"problem": "not found"})

        def do_POST(self) -> None:  # noqa: N802
            if self.path == "/api/session":
                session_id, problem = workshop.open()
                self._send(200 if session_id else 503, {"session": session_id, "problem": problem})
                return
            ended = _SESSION_PATH.match(self.path)
            if ended:
                workshop.close(ended.group(1))
                self._send(200, {"session": None, "problem": None})
                return
            if self.path.startswith(("/api/bench/", "/api/builder/")):
                self._bench_post()
                return
            if self.path != "/api/sms":
                self._send(404, {"problem": "not found"})
                return
            data = self._json()
            if data is None:
                self._send(400, {"reply": None, "problem": 'Expected JSON like {"session": "...", "text": "hi"}.'})
                return
            session_id = str(data.get("session", ""))
            text = str(data.get("text", "")).strip()[:_MAX_TEXT]
            if not text:
                self._send(400, {"reply": None, "problem": "Empty message."})
                return
            reply, problem, known = workshop.reply(session_id, text)
            self._send(200 if known else 404, {"reply": reply, "problem": problem})

        def _bench_post(self) -> None:
            data = self._json()
            if data is None:
                self._send(400, {"problem": "expected JSON"})
                return
            task = str(data.get("task", "")).strip()[:80]
            if self.path == "/api/bench/run":
                ask = str(data.get("ask", "")).strip()[:2000]
                if not task or not ask:
                    self._send(400, {"problem": 'Expected {"task": "...", "ask": "..."}.'})
                    return
                try:
                    self._send(200, bench.run(task, ask))
                except Exception as error:  # noqa: BLE001 — the bench reports failures honestly
                    self._send(502, {"problem": f"run failed: {error}"})
            elif self.path == "/api/bench/teach":
                correction = str(data.get("correction", "")).strip()[:2000]
                if not task or not correction:
                    self._send(400, {"problem": 'Expected {"task": "...", "correction": "..."}.'})
                    return
                try:
                    self._send(200, bench.teach(task, correction))
                except Exception as error:  # noqa: BLE001
                    self._send(502, {"problem": f"teach failed: {error}"})
            elif self.path == "/api/bench/forget":
                self._send(200, bench.forget(task))
            elif self.path == "/api/builder/build":
                try:
                    bot_id, label = builder.build(data)
                except Exception as error:  # noqa: BLE001
                    bot_id, label = None, f"build failed: {error}"
                self._send(200 if bot_id else 400, {"bot": bot_id, "label": label})
            elif self.path == "/api/builder/interact":
                bot_id = str(data.get("bot", ""))
                text = str(data.get("text", "")).strip()[:_MAX_TEXT]
                if not bot_id or not text:
                    self._send(400, {"reply": None, "problem": 'Expected {"bot": "...", "text": "..."}.'})
                    return
                reply, problem, known = builder.interact(bot_id, text)
                self._send(200 if known else 404, {"reply": reply, "problem": problem})
            elif self.path == "/api/builder/stop":
                bot_id = str(data.get("bot", ""))
                builder.stop(bot_id)
                self._send(200, {"bot": bot_id, "stopped": True})
            else:
                self._send(404, {"problem": "not found"})

        @typing.override
        def log_message(self, format: str, *args: typing.Any) -> None:  # noqa: A002
            print(f"workshop: {self.command} {self.path} {args[1] if len(args) > 1 else ''}", flush=True)

    return Handler


def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    logging.basicConfig(
        level=os.environ.get("WORKSHOP_LOG_LEVEL", "INFO"), format="%(asctime)s %(name)s %(levelname)s %(message)s"
    )
    try:
        if telemetry.configure():
            print(
                f"mosfet telemetry: {os.getcwd()}/otel-logs.jsonl, otel-spans.jsonl (or BOT_OTEL_* overrides)",
                flush=True,
            )
    except TypeError as error:
        # Library defect, not ours to patch here: its JSONL exporter does not match the installed
        # OpenTelemetry SDK. Say so on every start and run without telemetry.
        _LOG.error("mosfet telemetry is broken, running without it: %s", error)
    workshop = Workshop()
    bench = Bench(_settings())
    builder = Builder(workshop)
    status = "ready" if workshop.problem is None else workshop.problem
    print(f"mosfet workshop on http://127.0.0.1:{args.port} ({status})", flush=True)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), _handler(workshop, bench, builder))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
