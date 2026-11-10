# The words we use (glossary)

You do not need to memorise this. Come back whenever a word confuses you.

## The project

| Word                        | What it means                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **DCC**                     | Digital Communications Control Center. The thing we are building.                                                            |
| **Group**                   | The whole Kerchanshe Group (all companies together).                                                                         |
| **Company**                 | One company in the Group. Company A must never see Company B's data.                                                         |
| **Brand**                   | A brand that belongs to a company. A company can have several.                                                               |
| **Social account**          | One page or profile on a network, for example "Company A's LinkedIn page".                                                   |
| **Network**                 | Facebook, Instagram, LinkedIn, YouTube, TikTok or X.                                                                         |
| **Portal**                  | The DCC website and what runs behind it. Lives in the folder `portal`.                                                       |
| **Frontend**                | The part you can see and click in the browser. Folder `portal/frontend`.                                                     |
| **Backend**                 | The part behind the screens that thinks, checks rules and saves data. Folder `portal/backend`.                               |
| **Operational engine**      | The program that really posts to the networks. For us it is a customised **Postiz**. Folder `operational-engine`.            |
| **Postiz**                  | An open-source program that schedules and posts to social networks. We made our own copy (a "fork") and change it to fit us. |
| **Fork**                    | Our own copy of someone else's project, so we can change it. Ours: `DawitBK/postiz-app` on GitHub.                           |
| **SSO**                     | Single Sign-On. The Group's existing login. You log in once and many systems trust it. DCC uses it. We make no passwords.    |
| **MFA**                     | Multi-factor authentication. A second proof it is really you (a code from your phone). DCC requires it.                      |
| **Role**                    | A job inside DCC, like "content creator" or "publisher". The role decides what a person may do.                              |
| **Permission**              | One thing a role may do, like "read audit log".                                                                              |
| **Approval**                | A checker says "yes, this post may go out". Nothing is posted without it.                                                    |
| **Separation of duties**    | The person who writes a post can never be the one who approves it.                                                           |
| **Audit trail / audit log** | A notebook of everything that happened, who did it and when. It cannot be quietly changed.                                   |
| **Publishing freeze**       | An emergency switch that stops all posting through DCC.                                                                      |
| **Unified inbox**           | One place to read and answer comments and messages from all pages. Woluman adds it to our Postiz.                            |
| **Mirror**                  | A practice copy of the real setup on Dawit's computer. We test there before the real server.                                 |
| **Production**              | The real, live system that real people use. Only Dawit deploys there.                                                        |

## Working with code and Git

| Word                  | What it means                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| **Repository (repo)** | The project folder with all its history. Ours is on GitHub: `DawitBK/DCC`.                            |
| **Git**               | The tool that remembers every change to the project, like unlimited "undo" and "save as".             |
| **GitHub**            | The website where our repo lives so everyone can share it.                                            |
| **Clone**             | Download a copy of the repo to your computer.                                                         |
| **Branch**            | Your own copy of the work where you can change things safely without disturbing others.               |
| **`main`**            | The finished, official version. **Nobody touches it except Dawit.**                                   |
| **`develop`**         | Where everyone's finished work comes together. **You never work on it directly.** You branch from it. |
| **Commit**            | A saved snapshot of your changes with a short message.                                                |
| **Push**              | Send your commits from your computer to GitHub.                                                       |
| **Pull request (PR)** | A request: "please check my branch and add it to `develop`". This is how work gets in.                |
| **Review**            | Someone reads your PR and says OK or asks for changes. A good thing, not an attack.                   |
| **Merge**             | Joining a branch into another one. People do this after the review, not the AI and not you alone.     |
| **Conflict**          | Two people changed the same line. Git cannot choose. Ask for help ([04](04-WHEN-YOU-ARE-STUCK.md)).   |
| **CI**                | A robot on GitHub that runs all checks on your PR. It must show green ✅ before merging.              |
| **Issue**             | A written task or question on GitHub.                                                                 |

## Computer words

| Word                      | What it means                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Terminal**              | The window where you type commands (in VS Code: menu Terminal > New Terminal).                                               |
| **Node / npm**            | The engine that runs our code (Node) and its tool for running scripts (npm). When we say `npm run x`, you type exactly that. |
| **Docker**                | A program that runs small ready-made boxes. We use it only to run the practice database on your computer.                    |
| **Database (PostgreSQL)** | Where information is stored in tables, like very organised spreadsheets.                                                     |
| **Migration**             | A small file that changes the database structure (add a table). Once merged, **never edit it**. Add a new one instead.       |
| **`.env` file**           | Your private settings file. It is **never** sent to GitHub. `.env.example` is the template that is.                          |
| **Port**                  | A numbered door on your computer. The backend is door 7716, the frontend door 7717.                                          |
| **API**                   | How the frontend asks the backend for things ("give me the list of companies").                                              |
| **Test**                  | A small program that checks our code still works. `npm test` runs them all. A red test means something is broken.            |
| **Lint**                  | A spell-checker for code. `npm run lint`.                                                                                    |
| **Build**                 | Turning our code into the form that can run. `npm run build`.                                                                |
| **Cookie**                | A small note the browser keeps so the website knows you are logged in.                                                       |
| **Secret**                | Anything that must stay private: password, key, token. **Never in the project.**                                             |
