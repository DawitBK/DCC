# Social network app application drafts (W-04)

**Owner:** Woluman · **Checked:** 19 November 2026 · **Status:** draft for Dawit and Abenezer to review; not submitted.

Use these as draft text and a private information checklist. Network forms change. Check each form and its current official requirements before submitting. Do not put real contact details, account identifiers, credentials, app secrets or company documents in this repository. Abenezer should send private values to Dawit directly. Dawit approves every submission.

## Shared company and product description

> Kerchanshe Group is an Ethiopian business group. DCC (Digital Communications Control Center) is an internal tool for the Group's official social media accounts. Employees prepare content in DCC, an authorized reviewer approves the exact version for the relevant company and account, and DCC records the decision and publication outcome. Postiz is a separate publishing service used by DCC after approval. DCC is not offered to customers or the public.

Confirm the Group's approved legal description, the final list of participating subsidiaries and the privacy wording with Dawit before reuse. Do not add claims about live features: the real-network adapter, media upload and inbox have not all been proven.

## Network-specific draft use cases

| Network | Draft text for the application | Requested capability / permission names from current notes |
|---|---|---|
| Facebook Pages | “DCC will let authorized Group staff prepare and publish approved posts to the Group's official Facebook Pages, review comments and respond as the Page. Only Pages managed by the Group are in scope.” | `pages_manage_posts`, `pages_manage_engagement`, `pages_read_engagement`, `pages_read_user_engagement`; video adds `publish_video`. Inbox may require `pages_messaging`, `pages_show_list`, `pages_manage_metadata`, `business_management`. See [Facebook notes](facebook.md); confirm the minimal app request with Dawit. |
| Instagram | “DCC will let authorized Group staff publish approved content to the Group's professional Instagram accounts and, where approved, read and respond to comments and direct messages. Each account is managed by the Group.” | Facebook Login: `instagram_basic`, `pages_show_list`, `pages_read_engagement`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_messages`. Instagram Login has corresponding `instagram_business_*` scopes. See [Instagram notes](instagram.md); choose the login route with Dawit. |
| LinkedIn Pages | Use the detailed [LinkedIn application draft](linkedin-application.md). The proposed use is publishing approved posts as the Group's Pages and reading/replying to comments; it excludes member-profile posting and direct messages. | Community Management API; current notes identify `w_organization_social` and relevant organization-read scopes. Confirm exact requested scopes against the live application form before submission. |
| YouTube | “DCC will let authorized Group staff upload approved videos to official Group channels and, if approved, read and reply to comments on those videos.” | `https://www.googleapis.com/auth/youtube.upload`; comment/reply access uses `https://www.googleapis.com/auth/youtube.force-ssl`. See [YouTube notes](youtube.md). |
| TikTok | “DCC will let authorized Group staff publish approved video or photo content to official Group TikTok accounts through TikTok's Content Posting API. The publisher will complete TikTok's required post settings and consent steps.” | `video.publish`; Direct Post audit is required for public posts. Current notes do not identify comment or message permissions, so make no inbox claims. See [TikTok notes](tiktok.md). |
| X | “DCC will let authorized Group staff publish approved posts and media to official Group X accounts and, if approved, read and moderate replies and manage direct messages.” | `tweet.write`, `tweet.read`, `users.read`, `media.write`; replies moderation uses `tweet.moderate.write`; DMs use `dm.read`, `dm.write`; persistent access needs `offline.access`. See [X notes](x.md). Do not request inbox scopes until W-08 feasibility is confirmed. |

All proposed capabilities are goals, not claims that DCC already provides them. Remove any capability from a form that is not in the first approved phase.

## Information and documents to collect

| Needed | Who supplies or confirms it | Network / why |
|---|---|---|
| Exact legal entity name(s) that own the official accounts; registered address; official public website | Abenezer collects from company records; Dawit confirms the approved legal wording | LinkedIn application and any business verification; Meta/X forms if requested |
| Public privacy-policy URL covering DCC, social account tokens, post/comment data, retention and contact details | Dawit arranges/approves; Abenezer confirms the business owner and contact | LinkedIn, Google consent screen, Meta review if requested; TikTok/X if their current form requests it |
| Public app name, approved logo, short product description and supported network list | Dawit approves; Woluman supplies the draft text above | Every developer-app listing and OAuth consent screen |
| Business email for app ownership/support; authorized business admin who can receive verification notices | Abenezer identifies the business mailbox/admin; Dawit confirms who may act | LinkedIn specifically requires a verified business email; Meta Business Portfolio and Google support contact |
| Meta Business Portfolio ID/owner and the admin who can connect the app and complete any Business Verification | Abenezer identifies the current portfolio/admin; Dawit arranges supporting company documents if verification is required | One Meta app covers Facebook and Instagram; exact verification documents depend on Meta's flow |
| LinkedIn Page super admin and confirmation the app publisher Page is the correct Group Page | Abenezer identifies the Page and its authorized super admin; Dawit approves the app submission | LinkedIn Community Management API application; do not put the person's name or private contact in Git |
| Whether the Group has Google Workspace, which organization owns the Google Cloud project, and its project owner | Abenezer confirms Workspace/project ownership; Dawit approves the owner | YouTube OAuth consent screen: determines whether Internal mode is possible and who controls the project |
| Official domain or URL prefix and a company contact able to verify it | Abenezer identifies the domain owner; Dawit approves public exposure | TikTok photo-post verification and public app/site details, if required by the current portal |
| X developer account owner, company payment card and monthly credit budget | Dawit provides/approves through the official developer console; Abenezer confirms the account owner | X API is pay-per-use in current notes; never send card details to Woluman or store them in Git |
| Company registry / business verification documents, only if a network asks for them | Dawit obtains and submits them through that network's official portal | Meta Advanced Access/business verification; other networks only if their live application flow requires them |
| Reviewer test account credentials or externally reachable demonstration instance | Dawit decides and supplies through the network's approved secure channel only if required | LinkedIn review and some other app reviews; never put credentials in this repository. Temporary external access requires Dawit's explicit approval each time. |

The current [LinkedIn draft](linkedin-application.md) lists the legal name, address, website, privacy URL, business email and Page super admin as missing. The current notes do **not** establish a fixed company-document list for every network. Confirm the exact documents in each live portal; do not assume that one network's verification packet applies to another.

## Submission gate

Before any app is submitted, Dawit confirms the legal description, privacy policy, app ownership and access model; Abenezer confirms the participating accounts and account owners; and Woluman checks the requested permissions against Postiz's provider code. Record the application date and result in that network's status table. Never put credentials or real private account data in the status notes.
