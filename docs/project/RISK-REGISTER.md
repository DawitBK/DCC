# Risk register

Owner: Dawit. Review weekly. Rating = likelihood x impact (H/M/L).

| ID    | Risk                                                                                            | Rating | Mitigation                                                                                | Owner           |
| ----- | ----------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------- | --------------- |
| RK-01 | Network developer-app approvals (Meta, LinkedIn, TikTok, X) are slow or denied                  | **H**  | start W-04 immediately; phase networks; keep adapter per network                          | Woluman         |
| RK-02 | Postiz public API lacks inbox/comments: proposal's unified inbox cannot be delivered through it | **H**  | decide scope (D-12): defer, build a thin native-API inbox, or drop; tell management early | Dawit           |
| RK-03 | Approval bypass by posting directly inside Postiz                                               | **H**  | restrict Postiz access, key only on DCC server, reconciliation raising incidents (W-05)   | Dawit / Woluman |
| RK-04 | Postiz stack is heavy (Temporal, Elasticsearch) and needs its own host                          | M      | separate Linux host (D-03); sizing in W-07                                                | Woluman         |
| RK-05 | AGPL obligations misjudged if Postiz is modified                                                | M      | avoid source changes; legal review (D-09)                                                 | Dawit           |
| RK-06 | Real organisational data or secrets committed to the **public** repository                      | **H**  | rules in SECURITY.md/OWNERSHIP, CI scan, push protection, private data store (D-02)       | everyone        |
| RK-07 | Requirements unclear or late (approval matrix, policies)                                        | M      | Abenezer's register; decisions logged; do not invent rules                                | Abenezer        |
| RK-08 | Parallel work collides in shared areas (contracts, migrations)                                  | M      | ownership map, CODEOWNERS, timestamp-named migrations, issues before changes              | Dawit           |
| RK-09 | Eight-week proposal timeline is unrealistic given external dependencies                         | M      | gate by milestones, report honestly (MILESTONES)                                          | Dawit           |
| RK-10 | Production secrets approach undecided blocks deployment                                         | M      | decide D-05 early; the dev provider is refused in production                              | Dawit           |
| RK-11 | SSO cannot enforce MFA/passkeys per the proposal                                                | M      | confirm (L-05) before promising 100% MFA                                                  | Dawit           |
| RK-12 | Audit trail is tamper-evident only against partial edits                                        | M      | off-box checkpoint (L-09); never call it tamper-proof                                     | Dawit           |
| RK-13 | Developer PCs on Windows fail to bind registered ports                                          | L      | WINDOWS-PORTS guide; ports configurable                                                   | Dawit           |
| RK-14 | Security findings discovered late                                                               | M      | tenant attack tests in CI now; threat model per gate; pen test with buffer                | Dawit           |
