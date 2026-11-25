# The fork's inbox API (W-08)

Stock Postiz has no inbox. Our fork (`DawitBK/postiz-app`, branch `feat/dawit/practice-network`) adds two endpoints to the public API, behind the
same API key as the rest. DCC reads them through `PostizEngine.listInbox` and `replyToMessage` (`portal/engine-client`); DCC itself stores no
message text (see [the inbox API](../api/inbox.md)).

**Status (2026-11-25): built and proven against the practice network only.** The readers for the real networks (Facebook, Instagram, LinkedIn,
YouTube, TikTok, X) were written earlier from the networks' documentation, have unit tests with the network stubbed, and have **never been run
against a real network**. Nothing here says a real network allows what its reader tries.

## Endpoints

| Method | Path                         | What it does                                                                                                                                                            |
| ------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/public/v1/inbox?from=&to=` | Comments under the posts Postiz published, and direct messages, for every channel of the organization (or one: `&integration=<channel id>`), read from the network now. |
| POST   | `/public/v1/inbox/reply`     | Body `{ "id": "<message id>", "text": "..." }` (text 1 to 5000 characters). Answers one message in public, as the channel's own account.                                |

`from` and `to` are ISO dates. Comments are looked for under posts published up to 30 days before `from`.

### What a message looks like

```json
{
  "messages": [
    {
      "id": "<channel id>:c:<network id>",
      "integrationId": "<channel id>",
      "kind": "comment",
      "authorName": "Fan",
      "text": "Open on Sunday?",
      "receivedAt": "2026-11-25T09:00:00.000Z",
      "networkPostId": "<the network's id of the post>",
      "replied": false
    }
  ],
  "problems": [{ "integrationId": "<channel id>", "reason": "..." }]
}
```

- **`id`** is `<channel id>:<c for a comment, d for a direct message>:<the network's id>`. Nothing is stored: to answer, the engine reads the channel again
  (up to 90 days back) and finds the message by that id, so what the network needs to answer it (a conversation, a parent comment) is the network's own.
- **`replied`** is true when the channel's own account already wrote an answer: a comment with a reply whose parent it is, a direct message followed by a
  later message of the account in the same conversation. The account's own messages are never listed.
- **`problems`** lists channels that could not be read, with the reason. **A channel that failed is never reported as empty.** DCC's adapter fails the request
  when the channel asked for is among the problems.
- No token or network secret is ever in an answer.

### Answers to a reply

| Status    | Meaning                                                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 201       | Sent; `{ "replyId": "<the network's id of the reply>" }` (may be `null`).                                                              |
| 404       | The id is not valid, the channel has no inbox, or the message was not found any more.                                                  |
| 422       | The network does not allow this reply (no endpoint, no permission, a window that closed). The reason is given; success is never faked. |
| 401       | The network refused the channel's token (expired or revoked).                                                                          |
| 502 / 503 | The network call failed (503 when it is worth retrying). The outcome of a reply is then unknown: DCC never retries it blindly.         |

## In DCC

- `DCC_ENGINE_POSTIZ_INBOX=true` (development and test hosts) tells DCC the engine is the fork with the inbox. It is **off by default**: stock Postiz would answer 404.
- With the practice channels on (`DCC_ENGINE_PRACTICE_CHANNELS=true`), DCC shows the engine's messages and the practice engine's messages together and sends each reply to the engine that owns the message.
- Replying is a public act: DCC checks `inbox.reply`, writes the audit event and stops it under a freeze **before** the engine is called, as before.

## The practice network's inbox

With `POSTIZ_PRACTICE_NETWORK=true` the fork registers a reader for the practice channel type ([PRACTICE-NETWORK](PRACTICE-NETWORK.md)): comments under its posts and
direct messages to its account come from the pretend network, and a reply is written there as the account (a comment records which comment it answers).
`node scripts/verify/practice-network-e2e.mjs` proves the whole round trip.

## Not done

- A real network's reader run against the real network (each needs a developer app and a connected account).
- A webhook or push from the engine: the inbox is read when DCC asks.
- Paging beyond what a reader reads in one call (each reader bounds its own paging).
