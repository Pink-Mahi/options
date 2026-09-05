import { NextResponse } from "next/server";
import { getHistoricalPrices, getQuote } from "@/features/market-data/service";
import { computeAllIndicators } from "@/lib/calculations/indicators";
import { getAIProvider, isAIStub, type AIMessage } from "@/features/ai/provider";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase().trim();
  const body = await req.json().catch(() => ({}));
  const horizon = Math.min(90, Math.max(7, Number(body.horizon ?? 30)));

  try {
    const [hist, quote] = await Promise.all([
      getHistoricalPrices({ symbol, range: "1y" }),
      getQuote({ symbol }),
    ]);

    const indicators = computeAllIndicators(hist.data.points, symbol);
    const currentPrice = quote.data.price;

    // Prepare a compact data summary for the AI.
    // Recent price action (last 30 bars).
    const recentBars = hist.data.points.slice(-30).map((p) => ({
      date: p.date,
      close: Math.round(p.close * 100) / 100,
      volume: p.volume,
      change: Math.round(((p.close / (hist.data.points[hist.data.points.length - 31]?.close ?? p.close)) - 1) * 10000) / 100,
    }));

    // Indicator summary.
    const indicatorSummary = {
      currentPrice: Math.round(currentPrice * 100) / 100,
      rsi: indicators.rsi.current ? Math.round(indicators.rsi.current * 100) / 100 : null,
      rsiSignal: indicators.rsi.signal,
      macd: indicators.macd.current,
      macdCrossover: indicators.macd.crossover,
      bollinger: indicators.bollinger.current,
      bollingerSqueeze: indicators.bollinger.squeeze,
      stochastic: indicators.stochastic.current,
      stochasticSignal: indicators.stochastic.signal,
      atr: indicators.atr.current ? Math.round(indicators.atr.current * 100) / 100 : null,
      atrPercent: indicators.atr.currentAsPercent ? Math.round(indicators.atr.currentAsPercent * 10000) / 100 : null,
      volatilityRegime: indicators.atr.volatilityRegime,
      obvTrend: indicators.obv.trend,
      obvDivergence: indicators.obv.divergence,
      adx: indicators.adx.current,
      adxTrendStrength: indicators.adx.trendStrength,
      adxTrendDirection: indicators.adx.trendDirection,
      vwap: indicators.vwap.current ? Math.round(indicators.vwap.current * 100) / 100 : null,
      vwapPosition: indicators.vwap.priceVsVwap,
      ichimokuSignal: indicators.ichimoku.signal,
      ichimokuCloudColor: indicators.ichimoku.cloudColor,
      parabolicSARTrend: indicators.parabolicSAR.trend,
      ttmSqueeze: {
        signal: indicators.ttmSqueeze.signal,
        squeezeActive: indicators.ttmSqueeze.current.squeezeActive,
        squeezeFired: indicators.ttmSqueeze.current.squeezeFired,
        histogram: indicators.ttmSqueeze.current.histogram != null ? Math.round(indicators.ttmSqueeze.current.histogram * 100) / 100 : null,
      },
      williamsR: {
        current: indicators.williamsR.current != null ? Math.round(indicators.williamsR.current * 100) / 100 : null,
        signal: indicators.williamsR.signal,
      },
      cci: {
        current: indicators.cci.current != null ? Math.round(indicators.cci.current * 100) / 100 : null,
        signal: indicators.cci.signal,
      },
      mfi: {
        current: indicators.mfi.current != null ? Math.round(indicators.mfi.current * 100) / 100 : null,
        signal: indicators.mfi.signal,
      },
      keltner: indicators.keltner.current,
      donchian: indicators.donchian.current,
      signalScore: indicators.signalScore,
      tradeLevels: indicators.tradeLevels,
      movingAverages: indicators.movingAverages,
      summary: indicators.summary,
    };

    const systemPrompt = `You are a quantitative analyst. Analyze the technical indicators and recent price/volume action for ${symbol}.

CRITICAL RULES:
1. You are analyzing PATTERNS, not predicting the future with certainty.
2. Every statement must be grounded in the provided data.
3. Clearly state probabilities and confidence levels.
4. Always note when signals conflict.
5. Never guarantee any outcome.
6. Frame everything as "based on historical patterns, when similar indicator configurations appeared, X% of the time..."
7. Include risk factors and what would invalidate the pattern.
8. This is educational analysis, NOT investment advice.

Structure your response as:
1. **Current Technical Picture** — what the indicators are saying right now
2. **Pattern Recognition** — what historical pattern the current configuration resembles
3. **Probabilistic Outlook** — over the next ${horizon} days, what the indicators suggest (with explicit probabilities and confidence)
4. **Key Levels to Watch** — support/resistance from the indicators
5. **Risk Factors** — what would invalidate this analysis
6. **Options Strategy Implications** — how this affects covered call / CSP decisions`;

    const userMessage = `Analyze ${symbol} at $${currentPrice.toFixed(2)}.

Technical indicators:
${JSON.stringify(indicatorSummary, null, 2)}

Recent 30-day price/volume action:
${JSON.stringify(recentBars, null, 2)}

Based on these indicators and price action, identify the pattern and provide a probabilistic outlook for the next ${horizon} days. What are the key support/resistance levels? How does this affect options income strategy (covered calls / cash-secured puts)?`;

    const messages: AIMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    const provider = getAIProvider();
    const stub = isAIStub();

    if (stub) {
      // Deterministic fallback analysis from the indicators.
      const analysis = generateStubAnalysis(symbol, currentPrice, indicators, horizon);
      return NextResponse.json({
        symbol,
        analysis,
        indicators: indicatorSummary,
        aiPowered: false,
        warnings: ["AI provider not configured — showing deterministic indicator-based analysis. Add AI_API_KEY for AI-powered pattern recognition."],
      });
    }

    // Pattern analysis doesn't need tool calls — all data is already in the prompt.
    // Temporarily clear tools so the AI responds with content directly instead of
    // requesting tools. Restore afterward so the singleton isn't permanently mutated.
    const savedTools = provider.tools;
    provider.tools = [];
    const response = await provider.complete(messages, { portfolio: null, goals: null, symbol });
    provider.tools = savedTools;

    if (!response.content) {
      return NextResponse.json({
        symbol,
        analysis: generateStubAnalysis(symbol, currentPrice, indicators, horizon),
        indicators: indicatorSummary,
        aiPowered: false,
        warnings: ["AI returned an empty response. Showing deterministic analysis instead. Try again or adjust the horizon."],
      });
    }

    return NextResponse.json({
      symbol,
      analysis: response.content,
      indicators: indicatorSummary,
      aiPowered: true,
      warnings: indicators.warnings,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

function generateStubAnalysis(
  symbol: string,
  price: number,
  indicators: ReturnType<typeof computeAllIndicators>,
  horizon: number,
): string {
  const s = indicators.summary;
  const lines: string[] = [];

  lines.push(`## Current Technical Picture — ${symbol} at $${price.toFixed(2)}`);
  lines.push("");
  lines.push(`**Overall bias: ${s.overallBias.toUpperCase()}** (${s.signalCount.bullish} bullish, ${s.signalCount.bearish} bearish, ${s.signalCount.neutral} neutral signals)`);
  lines.push("");

  if (s.bullishSignals.length > 0) {
    lines.push("**Bullish signals:**");
    for (const sig of s.bullishSignals) lines.push(`- ${sig}`);
    lines.push("");
  }

  if (s.bearishSignals.length > 0) {
    lines.push("**Bearish signals:**");
    for (const sig of s.bearishSignals) lines.push(`- ${sig}`);
    lines.push("");
  }

  if (s.neutralSignals.length > 0) {
    lines.push("**Neutral signals:**");
    for (const sig of s.neutralSignals) lines.push(`- ${sig}`);
    lines.push("");
  }

  lines.push(`## Pattern Recognition`);
  lines.push("");
  const rsi = indicators.rsi.current;
  const adx = indicators.adx.current.adx;
  const macdHist = indicators.macd.current.histogram;
  const ttmSig = indicators.ttmSqueeze.signal;
  if (ttmSig === "fired") {
    const dir = (indicators.ttmSqueeze.current.histogram ?? 0) > 0 ? "bullish" : "bearish";
    lines.push(`The TTM Squeeze has **fired** — Bollinger Bands just expanded outside Keltner Channels with ${dir} momentum (histogram: ${(indicators.ttmSqueeze.current.histogram ?? 0).toFixed(2)}). Historically, squeeze firings precede directional moves of 1-3 ATRs.`);
    lines.push("");
  } else if (ttmSig === "squeeze") {
    lines.push(`The TTM Squeeze is **active** — Bollinger Bands are inside Keltner Channels, indicating volatility compression. Historically, these precede directional breakouts. The direction will be determined by which band the price breaks through.`);
    lines.push("");
  }
  if (s.overallBias === "bullish" && (adx ?? 0) > 25) {
    lines.push(`The indicator configuration resembles a **trending bullish pattern** with ADX at ${(adx ?? 0).toFixed(1)} indicating trend strength. RSI at ${(rsi ?? 0).toFixed(1)} suggests momentum without extreme overbought conditions.`);
  } else if (s.overallBias === "bearish" && (adx ?? 0) > 25) {
    lines.push(`The indicator configuration resembles a **trending bearish pattern** with ADX at ${(adx ?? 0).toFixed(1)}. RSI at ${(rsi ?? 0).toFixed(1)} and MACD histogram ${macdHist != null && macdHist < 0 ? "negative" : "positive"} confirm downward momentum.`);
  } else if (indicators.bollinger.squeeze) {
    lines.push(`The Bollinger Band squeeze indicates a **volatility contraction pattern**. Historically, these precede directional breakouts. The direction will be determined by which band the price breaks through.`);
  } else {
    lines.push(`The indicator configuration is **mixed/neutral** with no dominant pattern. This typically suggests range-bound trading or a transition period.`);
  }
  lines.push("");

  lines.push(`## Probabilistic Outlook (${horizon} days)`);
  lines.push("");
  if (s.overallBias === "bullish") {
    lines.push(`Based on the current bullish signal configuration (${s.signalCount.bullish} vs ${s.signalCount.bearish}):`);
    lines.push(`- **Upside scenario (~55-65%):** Price could test the upper Bollinger Band at $${indicators.bollinger.current.upper?.toFixed(2) ?? "—"}.`);
    lines.push(`- **Downside risk (~25-35%):** Support at the 50-day SMA ($${indicators.movingAverages.sma50?.toFixed(2) ?? "—"}) or lower Bollinger Band ($${indicators.bollinger.current.lower?.toFixed(2) ?? "—"}).`);
    lines.push(`- **Expected move (1σ):** ±$${(indicators.atr.current ? indicators.atr.current * Math.sqrt(horizon / 14) : 0).toFixed(2)} over ${horizon} days (ATR-based).`);
  } else if (s.overallBias === "bearish") {
    lines.push(`Based on the current bearish signal configuration (${s.signalCount.bearish} vs ${s.signalCount.bullish}):`);
    lines.push(`- **Downside scenario (~55-65%):** Price could test the lower Bollinger Band at $${indicators.bollinger.current.lower?.toFixed(2) ?? "—"} or 200-day SMA ($${indicators.movingAverages.sma200?.toFixed(2) ?? "—"}).`);
    lines.push(`- **Bounce risk (~25-35%):** If RSI is oversold, a mean-reversion bounce toward $${indicators.bollinger.current.middle?.toFixed(2) ?? "—"} is possible.`);
    lines.push(`- **Expected move (1σ):** ±$${(indicators.atr.current ? indicators.atr.current * Math.sqrt(horizon / 14) : 0).toFixed(2)} over ${horizon} days (ATR-based).`);
  } else {
    lines.push(`With mixed signals, the outlook is range-bound:`);
    lines.push(`- **Range-bound (~50-60%):** Price likely oscillates between $${indicators.bollinger.current.lower?.toFixed(2) ?? "—"} and $${indicators.bollinger.current.upper?.toFixed(2) ?? "—"}.`);
    lines.push(`- **Breakout upside (~20-25%):** Above $${indicators.bollinger.current.upper?.toFixed(2) ?? "—"}.`);
    lines.push(`- **Breakout downside (~20-25%):** Below $${indicators.bollinger.current.lower?.toFixed(2) ?? "—"}.`);
    lines.push(`- **Expected move (1σ):** ±$${(indicators.atr.current ? indicators.atr.current * Math.sqrt(horizon / 14) : 0).toFixed(2)} over ${horizon} days (ATR-based).`);
  }
  lines.push("");

  lines.push(`## Key Levels to Watch`);
  lines.push("");
  lines.push(`- **Resistance:** $${indicators.bollinger.current.upper?.toFixed(2) ?? "—"} (upper Bollinger), $${indicators.movingAverages.sma50?.toFixed(2) ?? "—"} (SMA50)`);
  lines.push(`- **Support:** $${indicators.bollinger.current.lower?.toFixed(2) ?? "—"} (lower Bollinger), $${indicators.movingAverages.sma200?.toFixed(2) ?? "—"} (SMA200)`);
  lines.push(`- **VWAP:** $${indicators.vwap.current?.toFixed(2) ?? "—"}`);
  lines.push(`- **Parabolic SAR:** $${indicators.parabolicSAR.current?.toFixed(2) ?? "—"} (trailing ${indicators.parabolicSAR.trend})`);
  lines.push("");

  lines.push(`## Risk Factors`);
  lines.push("");
  lines.push(`- Conflicting signals reduce confidence — always use position sizing to manage risk.`);
  lines.push(`- Bollinger squeeze ${indicators.bollinger.squeeze ? "is active" : "is not active"} — ${indicators.bollinger.squeeze ? "breakout imminent" : "normal volatility"}.`);
  lines.push(`- ADX trend strength: ${indicators.adx.trendStrength} (${(adx ?? 0).toFixed(1)}) — ${indicators.adx.trendStrength === "weak" ? "trendless markets are harder to predict" : "trending markets favor directional strategies"}.`);
  lines.push(`- OBV divergence: ${indicators.obv.divergence !== "none" ? indicators.obv.divergence + " — warning signal" : "none — volume confirms price action"}.`);
  lines.push("");

  lines.push(`## Options Strategy Implications`);
  lines.push("");
  if (s.overallBias === "bullish") {
    lines.push(`- **Covered calls:** Favor slightly OTM strikes to capture premium while allowing some upside participation. The bullish bias suggests assignment is less likely if you sell above resistance.`);
    lines.push(`- **Cash-secured puts:** Consider selling puts at or below support levels ($${indicators.bollinger.current.lower?.toFixed(2) ?? "—"}) for entry at good prices.`);
  } else if (s.overallBias === "bearish") {
    lines.push(`- **Covered calls:** Favor ATM or slightly ITM strikes to capture more premium as protection against downside. Higher assignment probability but you lock in a higher sell price.`);
    lines.push(`- **Cash-secured puts:** Be cautious — only sell puts at strikes where you'd genuinely want to own the stock. Consider lower strikes for more downside protection.`);
  } else {
    lines.push(`- **Covered calls:** Range-bound markets are ideal for covered call writing. Sell at or slightly OTM to capture premium while the stock oscillates.`);
    lines.push(`- **Cash-secured puts:** Sell at or below support to target entry at favorable prices. The range-bound nature means you may keep premium without assignment.`);
  }
  lines.push("");
  lines.push(`*This is deterministic indicator-based analysis, NOT a prediction. Add an AI API key for AI-powered pattern recognition that examines historical analogs.*`);

  return lines.join("\n");
}
