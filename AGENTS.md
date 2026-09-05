# AI Options Income & Profit Calculator

## Stack
- Next.js 14 (App Router) + React 18 + TypeScript (strict, `noUncheckedIndexedAccess`)
- Tailwind CSS + shadcn-style primitives in `src/components/ui`
- Prisma + PostgreSQL (Docker dev instance on :5432)
- Recharts for payoff/price charts
- Vitest for the calculation engine

## Commands
- `pnpm dev` — Next.js dev server (port 3001; use `pnpm exec next dev -p <port>` if 3001 is taken)
- `pnpm build` — production build
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` — Vitest (calculation engine unit tests)
- `pnpm db:push` — push Prisma schema to DB
- `pnpm db:generate` — regenerate Prisma client

## Environment
Copy `.env.example` to `.env.local` (and `.env` for Prisma). Required for live data:
- `MARKET_DATA_PROVIDER=tradier`
- `MARKET_DATA_API_KEY=<Tradier token>`
- `TRADIER_BASE_URL` (sandbox: `https://sandbox.tradier.com/v1`)
- `TRADIER_ENTITLEMENT=delayed|realtime`

Without a key, the app runs in **demo mode** with a deterministic mock provider (clearly bannered). No functionality is lost.

AI (Phase 5, not yet active): `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`.

## Architecture (per spec)
- `src/lib/types.ts` — canonical domain models (single source of truth)
- `src/lib/calculations/` — **deterministic** financial engine. Every number in the UI, scanners, and AI layer comes from here. Unit-tested.
- `src/features/market-data/` — provider abstraction (`provider.ts`), Tradier (`tradier.ts`), mock (`mock.ts`), TTL cache (`cache.ts`), service (`service.ts`). Provider responses are normalized into canonical models; provider field names never leak.
- `src/features/options/` — scanners (`scanner.ts`) filter & rank using the calc engine; `stock-data.ts` assembles server payloads.
- `src/features/ai/` — AI provider abstraction + tool contracts (Phase 5). Stub returns templated analysis from the calc engine.
- `src/lib/database/` — Prisma client + portfolio repository (single default user/portfolio; auth is Phase 9).

## Product principles (enforced)
1. Math before AI. 2. Goals before rankings. 3. Total return before premium alone.
4. Portfolio before isolated trades. 5. Liquidity before headline yield.
6. Historical context, not certainty. 7. No trade is a valid result.
8. Explain opportunity cost. 9. Separate realized/unrealized/potential income.
10. Every recommendation is auditable.

## MVP status (Phase 1–8 complete)
- **Phase 1–4**: Stock search, live/demo options chains, covered-call & CSP calculators with payoff graphs and profit tables, option chain table with sorting/filtering, DTE comparison (30/45/90/180/365/LEAP), portfolio holdings + goals, covered-call/CSP/LEAPS scanners with deterministic scoring, historical analysis with rolling move probability.
- **Phase 5 (AI)**: OpenAI-compatible provider with real function calling (`src/features/ai/openai-provider.ts`), tool execution layer (`tool-executor.ts`), chat orchestrator with tool-call loop (`chat-orchestrator.ts`), AI chat UI at `/ai` and per-stock AI tab. Stub provider returns deterministic analysis when no `AI_API_KEY` is set. The AI calls 13 tools: getQuote, getExpirations, getOptionChain, scanCoveredCalls, scanCashSecuredPuts, calculateCoveredCall, calculateCashSecuredPut, getPortfolio, analyzePortfolioIncome, calculateHistoricalMoveProbability, getIVAnalytics, runMonteCarlo, searchStock.
- **Phase 6 (Income)**: Monthly income planner at `/income-planner` with goal feasibility engine. Estimates achievable income from current holdings + available cash, classifies feasibility (easily_supported / potentially_achievable / requires_relaxing / not_supported).
- **Phase 7 (Positions)**: Option position tracking at `/positions` — open/close/assign/roll positions, trade journal with realized P/L, roll & buyback analyzer with deterministic hold-vs-close-vs-roll comparison.
- **Phase 8 (Risk)**: IV percentile/rank + expected move (`src/lib/calculations/iv-analytics.ts`), Monte Carlo simulation comparing covered-call vs buy-and-hold (`src/lib/calculations/monte-carlo.ts`), Risk Analysis tab on stock pages. Both exposed as AI tools.
- **Phase 9 (Pro chain & analytics)**: Rebuilt options chain as professional side-by-side calls|strike|puts view with ATM highlighting, clickable rows → quick-analysis modal, complete Greeks (gamma/vega/rho), bid/ask spread, vol/OI ratio, breakeven, assignment probability, strike search, pagination, data freshness indicator, greeks provenance. IV skew chart (IV by strike). Side-by-side contract comparison (up to 5 contracts). Rolling income projection (what if you sold every N days for a year?). Risk-adjusted returns (Sharpe, Sortino, Calmar). Portfolio-level Greeks aggregation + assignment risk heatmap on portfolio page.
- **Phase 10 (Technical analysis & AI prediction)**: Comprehensive technical indicators library (`src/lib/calculations/indicators.ts`) with 11 indicators: RSI, MACD, Bollinger Bands, Stochastic, ATR, OBV, ADX, VWAP, Ichimoku Cloud, Parabolic SAR, EMA/SMA series. Automatic bullish/bearish/neutral signal summary with overall bias. Technical Analysis tab on stock pages with indicator cards, RSI/MACD charts, moving average grid, golden/death cross detection. AI pattern analysis: feeds all indicators + 30-day price/volume to AI for pattern recognition and probabilistic outlook (7-90 day horizon). Deterministic fallback when no AI key. Both exposed as AI tools (`getTechnicalIndicators`, `analyzePattern`). 22 unit tests for indicators (96 total).
- **Phase 11 (News, earnings & peers)**: News & sentiment analysis (`src/features/news/sentiment-service.ts`): fetches articles via NewsAPI or Alpha Vantage, AI reads each article for sentiment (bullish/bearish/neutral), confidence, impact rating, key topics, and options strategy implications. Aggregate sentiment score with distribution bar, high-impact article highlighting, key topic extraction. Keyword-based fallback when no AI key. Earnings IV crush analysis (`src/features/options/earnings-analyzer.ts`): historical earnings reactions (avg/median/max up/max down move, up-move frequency), next earnings date with countdown, expected move (historical avg vs ATM IV), IV crush estimate, strategy implications by proximity to earnings. Sector & peer comparison (`src/features/options/peer-comparison.ts`): compares stock against sector peers and SPY benchmark on return, volatility, yield, P/E. Rankings with percentiles. All three exposed as AI tools (`getNews`, `getEarningsAnalysis`, `getPeerComparison`). 3 new API routes, 3 new tabs (News & Sentiment, Earnings, Peers). 18 AI tools total.
- **Phase 12 (Watchlist & alerts)**: Watchlist model added to Prisma schema. Watchlist repository (`src/lib/database/watchlist-repo.ts`) with CRUD for watchlist entries (symbol, notes, target price/IV/yield) and alerts. Alert evaluation engine (`src/features/alerts/alert-evaluator.ts`) checks 9 rule types against live market data: price_above, price_below, iv_above, iv_below, yield_above, yield_below, earnings_within_days, delta_above, delta_below. `/watchlist` page with add/remove watchlist items, create/toggle/delete alerts, triggered alert banner. 2 new API routes (`/api/watchlist`, `/api/alerts`). Watchlist added to main navigation (8 nav items).

## Notes
- Port 3000 is used by another container on this machine; the dev server uses 3001+.
- Annualized rates are always labeled as comparison tools, not expected returns.
- The mock provider generates deterministic fixtures so the app is fully functional offline.
