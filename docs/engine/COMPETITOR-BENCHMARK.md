# Social publishing benchmark (W-02)

**Checked:** 19 November 2026 · **Scope:** Hootsuite, Sprout Social, Buffer and DCC/Postiz.

This is a feature and list-price comparison, not a purchase recommendation. Prices are USD before tax. The vendors use different billing units and terms; the table states the published basis where available. Vendor prices and social-network permissions can change.

## Feature comparison and gaps

| Capability | Hootsuite Standard / Professional | Sprout Standard / Professional | Buffer Team | DCC with Postiz v2.25.3 |
|---|---|---|---|---|
| Publishing and calendar | Unlimited scheduled posts; Standard supports up to 10 accounts, Professional unlimited | Standard supports 5 profiles; Professional unlimited; publishing calendar | Unlimited scheduled posts; per-channel pricing | DCC approval-gated publish and scheduling exist; Postiz API adapter has not been verified on a real channel |
| Review and approvals | Standard has no advanced approval workflows; higher plans offer more collaboration | Professional adds approval workflows; Standard includes collaboration | Team includes content approval workflows | DCC has versioned content and role-based approval, with author-review separation; approvals remain in DCC |
| Inbox and replies | Central inbox for public and private messages; replies across supported networks | Consolidated Smart Inbox and collaboration; higher tiers add tagging and care features | Community inbox is included | Portal inbox works with the practice engine. Fork inbox endpoints are not implemented; real inbox/reply is a gap (W-08) |
| Analytics and listening | Reporting, competitor benchmarking and social listening are included in Standard | Profile/post reporting; deeper competitive insights and listening vary by plan/add-on | Analytics included; advanced analytics in paid plans | Analytics are not implemented (W-06). DCC does not yet provide listening |
| Company separation and audit | Vendor collaboration and access controls; no DCC-specific approval/audit model | Vendor collaboration and workflows; no DCC-specific approval/audit model | Team access levels; no DCC-specific approval/audit model | DCC owns company/brand access, approvals and audit. Postiz is the publishing executor, not the approval authority |
| Hosting and data control | Vendor-hosted SaaS | Vendor-hosted SaaS | Vendor-hosted SaaS | Self-hosted Postiz; measured empty stack uses about 2.35 GiB RAM at rest. Server operations, backups and network access remain our responsibility |

**Main gaps against the commercial tools:** the fork’s unified inbox, analytics, media handling, and real-network publishing have not been proven end to end. The Postiz adapter is still marked unverified. Hootsuite, Sprout and Buffer provide mature inbox/analytics features today; DCC’s differentiator is its company-scoped approval and audit control, not feature parity yet.

## Cost comparison

The latest account workbook summary in `docs/engine/NETWORK-SETTINGS.md` shows 29 URL-matched entries in the first phase (Facebook 11, LinkedIn 7, Instagram 9, YouTube 2). This is **not a confirmed count of active accounts**. Use it only to illustrate scale; reconcile it privately with Abenezer before budgeting. Cost assumes one user/seat and that all 29 entries are billable social profiles/channels.

| Product / suitable tier for 29 profiles | Published price and billing basis | Illustrative monthly cost at 29 profiles | Pricing basis and limit |
|---|---:|---:|---|
| Hootsuite Professional | $199 per user/month (billing term not shown on the checked pricing page) | $199/month for one user | Unlimited social accounts; Standard is $99/user/month but capped at 10 accounts |
| Sprout Professional | $299 per seat/month (annual-billing plan price) | $299/month for one seat | Unlimited profiles; Standard is $199/seat/month and includes 5 profiles |
| Buffer Team | $120/year per channel for channels 1–10; $40/year for 11–25; $30/year for 26–29 | **$160/month** ($1,920/year) | Per channel; unlimited users; includes approvals and community inbox |
| DCC + self-hosted Postiz | No SaaS subscription price in this comparison | Not priced | Hosting, backup, administration, network-app approvals and support are excluded; local measurement was about 2.35 GiB at rest, not a production capacity guarantee |

Prices checked on vendor pages on 19 November 2026: [Hootsuite plans](https://www.hootsuite.com/plans/standard) and [Hootsuite plan pricing](https://www.hootsuite.com/about/hootgiving) (the page labels its standard prices as normally $99 and $199 per user/month); [Sprout Social pricing](https://sproutsocial.com/pricing/); [Buffer pricing](https://buffer.com/pricing) and [Buffer pricing details](https://support.buffer.com/en-us/articles/buffer-pricing-and-features-6pJrOPuzIt). Buffer annual total uses its published channel bands: 10×$120 + 15×$40 + 4×$30 = $1,920/year. Taxes, add-ons, extra seats, currency conversion, discounts and negotiated enterprise prices are excluded. Confirm current quotes before procurement.

## Sources and status limits

- DCC feature/status evidence: `docs/engine/POSTIZ-ASSESSMENT.md`, `docs/engine/POSTIZ-INTEGRATION.md`, `docs/engine/NETWORK-SETTINGS.md` and `portal/engine-client/src/postiz.ts`.
- The benchmark does not claim that DCC/Postiz can publish to or read from a live social channel. That requires a developer app and a real test channel (W-03/W-04/W-08).
