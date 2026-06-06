# Truth Divergence Current Architecture

Truth Divergence is an immersive case-investigation workspace. The player appears to be chatting with an AI at work, but every useful question grows the investigation in real time: the center chat reports what was found, then the left and right metadata panels absorb the newly created evidence, people, locations, timeline events, and relationships.

## Product Loop

1. The cache worker generates a compact truth seed: victim, killer, motive, method, suspect pool, and opening scene.
2. The player types a natural-language investigation command.
3. The server parses the command and asks Runtime Discovery to generate what this question uncovers.
4. The center chat reports the newly found record, event, testimony, or object directly.
5. The generated discovery is written into canonical case/session state.
6. The server emits state and metadata patches for the left and right panels.

The key rule is: AI can dynamically generate the path, but it cannot change the hidden truth seed. The investigation can improvise; the final answer must still converge.

## Runtime Transport

All active play now goes through one WebSocket endpoint:

```txt
/ws/agent
```

The old REST and SSE action/session paths were removed. This keeps ordering clear and avoids the previous `stage.preview` problem where the page waited for all text deltas before anything useful appeared.

## Event Order

For each player command, the preferred event order is:

```txt
player.command
  -> agent.status
  -> chat.message.started
  -> chat.delta*
  -> chat.message.finished
  -> game.action.result
  -> game.state.patch
  -> metadata.patch*
  -> game.command.finished
  -> turn.finished
```

The center chat is the primary response surface. Left and right panels are secondary projections and can refresh after the chat begins.

## Event Families

### Agent

- `agent.status`: short runtime status.
- `agent.hint`: idle or next-step prompt.
- `agent.refusal`: rejects off-topic or direct-spoiler questions.
- `agent.error`: runtime failure.

### Chat

- `chat.mode.changed`: switches between case assistant and suspect interrogation.
- `chat.message.started`: creates a message bubble.
- `chat.delta`: streams text into that bubble.
- `chat.message.finished`: marks the message complete.

### Game

- `session.ready`: sends the initial public case/state snapshot.
- `game.action.result`: reports the parsed action and newly unlocked public items.
- `game.state.patch`: patches public player state.
- `game.command.finished`: releases the input state.
- `turn.finished`: closes the turn for UI bookkeeping.

### Metadata

- `metadata.patch`: updates panel data such as current location, clues, evidence, suspects, timeline, relationships, and recommendations.

## UI Layout

The current screen has three zones:

- Left panel: case evidence, clues, location facts, and structured investigation data.
- Center panel: workplace-style AI chat, including assistant mode and suspect interrogation mode.
- Right panel: suspects, timeline, relationship context, recommendations, and status.

The center panel should feel like ordinary AI chat, but the content is case-bound. The player can ask for summaries, compare evidence, interrogate visible suspects, or request timeline/relationship reasoning.

## Chat Modes

### Assistant Mode

Default mode. It answers only case-relevant questions and directly generates discoveries from the player's question. It should say what was found, not suggest where to go next.

### Interrogation Mode

Triggered by commands such as `审问张某`, `询问张某`, or a parsed `INTERROGATE_SUSPECT` intent. The chat speaker changes to the suspect, and later replies use that suspect's public profile, pressure, trust, contradictions, and exposed evidence.

### Refusal Rules

The chat should refuse:

- Generic non-case requests, such as weather, stock, coding, copywriting, or jokes.
- Direct spoiler requests, such as asking who the killer is or who is most suspicious.
- Claims that require hidden truth before the player has unlocked supporting evidence.

## AI Usage

AI JSON is used for controlled setup tasks such as case generation, where schema validation matters. The generated case is intentionally compact: the truth seed and opening scene come first; evidence, timeline, relationships, and many locations are created during play.

Runtime Discovery also uses JSON internally so newly created evidence and metadata can be patched into the UI. The player still experiences it as plain chat over `chat.delta`.

Deterministic runtime templates remain as a fallback when AI credentials are missing or a model request fails.

## Server Modules

- `src/game/agent/webSocketServer.ts`: WebSocket endpoint and client message parsing.
- `src/game/agent/roomAgentRuntime.ts`: turn orchestration, event ordering, logging, and metadata scheduling.
- `src/game/agent/chatRuntime.ts`: chat routing, refusal rules, assistant replies, and suspect replies.
- `src/game/agent/publicProjection.ts`: redacts hidden truth and builds public panel data.
- `src/game/agent/eventLog.ts`: event timing/content log for debugging slow turns.
- `src/game/engine/applyAction.ts`: canonical action execution.
- `src/game/engine/parseAction.ts`: first-pass bounded action parser.
- `src/game/engine/state.ts`: initial player state.
- `src/game/cache/*`: case cache storage and refill worker.
- `src/ai/caseGenerator.ts`: AI JSON case generation only.
- `src/ai/client.ts`: server-only AI client.

## Development Notes

- Run the app with `npm run dev`; the custom server binds to `0.0.0.0` for LAN testing.
- WebSocket event logs are enabled by default and written to `agent-events.log`.
- Disable event logs with `AGENT_EVENT_LOG=0`.
- Override the log path with `AGENT_EVENT_LOG_FILE`.
- The database schema may still contain compatibility columns from old experiments, but runtime code should not use `ai_page`, AI HTML, or stage rendering.
