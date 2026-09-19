# workshop

The workshop is the small local Python server between the chat page (`web/playground.html`) and the
library. It holds a mosfet `Bot` with a real library `phone.Phone`, wires cognition (TypeSafe intuition,
Luna reasoning and reflection), and plays the phone's messaging service (`phone.Service`).

    uv run --project workshop workshop/server.py      # 127.0.0.1:8787

- `GET  /api/health` — `{ready, model, problem}`
- `POST /api/sms {text}` — delivers the text to the bot's phone; `{reply, problem}`

Keys (`TYPESAFE_API_KEY`, `BOT_OPENAI_API_KEY`) come from the environment or the `.env` files listed in
`server.py` (`workshop/.env` wins).

It wires only what the library has. What texting mosfet still needs from the library is listed in
`MISSING` in `server.py` and reported by `/api/health`.
