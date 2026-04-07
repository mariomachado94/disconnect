# Future Work

Tracked ideas, edge cases, and improvements to revisit after MVP.

## Network resilience

- **Silent send failure when disconnected:** If the WS connection is down when the user hits Send, `sendMessage` silently bails out — no optimistic message, no error feedback. Could show a disconnected banner or disable the input when `isConnected` is false.
- **Stuck pending messages on mid-send disconnect:** If the network drops after an optimistic message is added but before `message_sent`/`message_failed` arrives, the message stays as `pending` indefinitely (cleaned up on chat reopen). Could add a timeout that marks it as failed after a few seconds with no response.

## Chat history

- **Opt-in full history setting:** The 24-hour message retention filter in the API and session-based greying are designed to be togglable. A user setting could lift the 24-hour cutoff and/or disable the pre-session greying.
- **Message deletion policy:** Currently messages older than 24 hours are hidden but never deleted from the database. May want a cleanup job or a deliberate decision to keep/purge them.
