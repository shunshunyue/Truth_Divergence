# Truth Divergence Current Architecture

Truth Divergence is an immersive case-investigation workspace. The player appears to be chatting with an AI at work, but every useful question drives a live investigation: the center chat answers first, then the left and right metadata panels update from canonical game state.

## Product Loop

1. The player types a natural-language investigation command.
2. The server parses it into a bounded game action.
3. The game engine applies the action against canonical case state.
4. The center chat streams the assistant or suspect response immediately.
5. The server emits state and metadata patches for the left and right panels.
6. The UI stays in one believable investigation surface instead of rendering AI-generated pages.

The key rule is: AI can explain, roleplay, and summarize; the engine owns truth, unlocks, scoring, and state.

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

Default mode. It answers only case-relevant questions, summarizes discovered facts, compares visible contradictions, and suggests evidence-backed next actions.

### Interrogation Mode

Triggered by commands such as `审问张某`, `询问张某`, or a parsed `INTERROGATE_SUSPECT` intent. The chat speaker changes to the suspect, and later replies use that suspect's public profile, pressure, trust, contradictions, and exposed evidence.

### Refusal Rules

The chat should refuse:

- Generic non-case requests, such as weather, stock, coding, copywriting, or jokes.
- Direct spoiler requests, such as asking who the killer is or who is most suspicious.
- Claims that require hidden truth before the player has unlocked supporting evidence.

## AI Usage

AI JSON should be used for controlled setup tasks such as case generation, where schema validation matters.

Normal conversation should not force JSON. Future real AI chat should stream plain text from the model into `chat.delta` events, while the game engine continues to produce structured `game.state.patch` and `metadata.patch` events.

Current chat replies are deterministic runtime templates. The next AI integration should replace those templates with a text-streaming chat model while preserving the same WebSocket event contract.

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
