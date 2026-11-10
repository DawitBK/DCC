# Dependency map

```mermaid
flowchart LR
  A02[A-02 account inventory] --> H02[H-02 account registry]
  A05[A-05 approval matrix] --> H04[H-04 content + approvals]
  H01[H-01 module plan] --> H02 & H03 & H04
  H03[H-03 membership admin API] --> R04[R-04 app shell]
  R01[R-01 UX direction] --> R02[R-02 prototype] --> R04
  A04[A-04 current processes] --> R02
  W01[W-01 Postiz assessment] --> W03[W-03 adapter proven live] --> H05[H-05 publishing records + freeze]
  W04[W-04 network developer apps: long lead] --> W03
  H04 --> H05
  W01 --> W05[W-05 bypass prevention] --> H06[H-06 reconciliation + incidents]
  L05[L-05 SSO MFA answer] --> L10[L-10 penetration test]
  L17[L-17 production secrets] --> L15[L-15 UAT environment]
```

Critical path to the pilot: **A-05 → H-04 → H-05 ← W-03 ← W-04** (the network developer-app approvals are the longest and least controllable item: start W-04 first),
and **R-01 → R-02 → R-04**. Decisions D-03, D-04, D-05 gate the first server deployment.
