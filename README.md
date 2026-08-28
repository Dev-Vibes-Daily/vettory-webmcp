# Vettory for WebMCP

**A trust layer AI agents can query in the page, before they act.**

Live: **https://vettory-webmcp.misti.workers.dev**
Built for [The WebMCP Challenge](https://webmcp.devpost.com/).

---

## The problem

In September 2025, a package called `postmark-mcp` appeared on npm. Same name as
Postmark's official tool. Same docs. Agents installed it and used it to send email —
and it quietly BCC'd every message to an address the author controlled. It had 1,643
downloads before anyone noticed.

That happened when agent tools were still something a *developer* chose, ahead of time,
in a config file.

WebMCP changes the shape of that risk. Now any page on the open web can hand an agent a
set of callable tools, at runtime, mid-task. That is a genuinely good thing — it is what
makes agents useful instead of clumsy. But it means "which tools can this agent trust?"
stops being a question someone answers in advance and becomes a question that has to be
answerable *right now, in the page*.

Nothing answers it. So we built the thing that does.

## What this is

[Vettory](https://vettory-webmcp.misti.workers.dev) is a small, deliberately curated
catalog of tools for AI agents. Each one is scored against a published six-part rubric
— trust, fit, ease, reliability, reach, cost — assessed against a source, and given an
editorial verdict of **trusted**, **caution**, or **warning**. Anything carrying an
unresolved material risk is held off the catalog entirely.

It is intentionally about 22 tools, not 200,000. A large unchecked list is a liability,
not a feature.

This repository makes that catalog **directly callable by an agent through WebMCP**.

## The tools this page registers

All five are registered in [`site/webmcp.js`](site/webmcp.js).

| Tool | What it does |
|---|---|
| `search_vetted_tools` | Find vetted tools for a capability — "send email", "take payments", "remember things". Returns verdicts, watch-outs, and what each is best for. |
| `check_tool_trust` | **The safety gate.** Check a named tool *before* installing or calling it. Returns Vettory's verdict — or an explicit *"nobody here has checked this"*, which is a gap in coverage, not a clean bill of health. |
| `get_tool_report` | The full scorecard: all six dimensions scored 1–5, incident history, disclosed watch-out, source, and when a person last looked at it. |
| `filter_catalog` | Drives the catalog UI on the page itself, so the human sees the same shortlist the agent is working from. |
| `request_vetting` | The human/agent loop. When an agent hits something Vettory does not cover, that unmet need is recorded and surfaced to the person — who does the vetting. |

## Why this use case suits WebMCP

Three reasons, in order of how much we believe them.

**1. The question is only answerable at runtime.** An agent does not know which tool it
will need until it is halfway through a task. A trust check that has to happen before the
session starts is a trust check that does not happen. WebMCP puts the answer where the
decision actually gets made.

**2. Humans and agents end up looking at the same screen.** Every tool here drives the
visible page, not just the response. When an agent calls `filter_catalog`, the catalog
on screen filters. When it calls `check_tool_trust`, that tool's scorecard opens. An
activity panel logs every call as it happens. The person is not reading a summary of
what their agent did — they are watching it, and can disagree while it is still cheap to.

**3. `request_vetting` is a loop that does not close without a human.** The agent finds
the gap; a person does the vetting; the catalog gets better; the next agent gets a real
answer. Deliberately, the agent cannot write to the queue unattended — a queue an agent
can fill on its own is a queue that can be gamed. The human has to send it.

## Honesty, on purpose

Vettory is a trust brand, so the language in the tool responses is chosen carefully, and
the distinctions are load-bearing:

- **`status` is a rubric verdict** — an editorial judgement informed by the scorecard.
  It is not a human sign-off.
- **`verified: true`** means a person personally checked that tool. Most entries are not
  verified, and every response says so plainly rather than blurring it.
- **"Not in the catalog" is not a verdict of unsafe.** It means nobody here has looked.
  `check_tool_trust` returns exactly that, in those words, because an unearned all-clear
  from a trust layer is worse than no trust layer.

If an agent reads a Vettory answer as stronger than it is, that is our bug.

## Try it

The page works normally in any browser. To use the tools you need a WebMCP-capable agent:

- **ChatGPT's in-app browser** — supported out of the box.
- **Chrome 149+** — enable `chrome://flags/#enable-webmcp-testing`, then load the site.

Then ask your agent things like:

- *"Find me a vetted tool for sending email."*
- *"Is Chroma safe to use for memory?"* — it is listed as a **warning**, and it will say why.
- *"Check whether postmark-mcp is trustworthy."* — not in the catalog; watch how it answers.
- *"Show me only the tools a human has personally verified."*

The panel in the bottom-right shows whether an agent is connected and logs each call.

## How it works

One Cloudflare Worker serves everything.

```
worker.js
 ├── /             → the site (static assets) + CSP and hardening headers
 ├── /api/catalog  → public JSON that powers the page, rate-limited per IP
 └── /api/search   → the agent door: API-key gated, rate-limited
                     (public demo key: vty_public_demo)

data/catalog.json  → single source of truth. The website, the HTTP API, and the
                     WebMCP tools all read it, so they cannot drift apart.

site/webmcp.js     → the WebMCP layer: registers the five tools above.
```

`site/webmcp.js` registers on **`document.modelContext`** per the current spec, and falls
back to **`navigator.modelContext`** for Chrome 149's origin trial (deprecated in 150),
matching the response shape each surface expects. Registration failures are caught, so a
browser without WebMCP gets a perfectly normal website.

Everything is same-origin and inline — no external scripts — which keeps it inside the
site's existing Content-Security-Policy.

## Run it locally

```bash
npm install
npx wrangler dev --port 8788 --local
# then open http://localhost:8788
```

Deploy (Cloudflare Workers, free plan):

```bash
npx wrangler deploy
```

## Provenance — what is new for this hackathon

Being straight about this, since the rules ask.

**Existed before the submission period:** the Vettory catalog and its vetting rubric, the
website, the Cloudflare Worker, and the `/api/search` HTTP API. That work is Misti's, from
earlier in 2026, and runs at `vettory.misti.workers.dev`.

**Built during the submission period, in this repository:** the entire WebMCP layer —
`site/webmcp.js`, the five tool definitions, the `window.VettoryUI` bridge that lets agent
tools drive the page, the live agent-activity panel, and this deployment. The commit
history here is timestamped and starts at the beginning of that work.

## License

MIT — see [LICENSE](LICENSE).

Built by Misti Lantz · [MindXpansion, LLC](https://mindxpansion.ai)
