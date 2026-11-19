# Operational engine and channel links

The portal talks to the operational engine only through `portal/engine-client`. Publishing still passes through `GovernedEngine`.

## Endpoints

| Method | Path                                      | Permission       | Notes                                                                             |
| ------ | ----------------------------------------- | ---------------- | --------------------------------------------------------------------------------- |
| GET    | `/api/engine/status`                      | `account.read`   | Reports the configured provider and whether live verification has been completed. |
| GET    | `/api/engine/channels`                    | `account.manage` | Lists channels available from the engine.                                         |
| PATCH  | `/api/social-accounts/:id/engine-channel` | `account.manage` | Links or unlinks a registered account. Send `engineChannelId: null` to unlink.    |

The live-network adapter is not considered proven until Woluman completes W-03.
