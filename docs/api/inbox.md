# Unified inbox

The inbox is read and written through the operational engine. DCC does not store a second conversation thread table.

## Endpoints

| Method | Path               | Permission    | Notes                                                                                                 |
| ------ | ------------------ | ------------- | ----------------------------------------------------------------------------------------------------- |
| GET    | `/api/inbox`       | `inbox.read`  | Lists messages visible through the caller's account scope. Supports the query fields in `InboxQuery`. |
| POST   | `/api/inbox/reply` | `inbox.reply` | Sends one reply through the governed engine. Returns `201` with `{ "sent": true }`.                   |

Assignment and response-time rules are not implemented yet. They require the open inbox decision and the corresponding engine support.
