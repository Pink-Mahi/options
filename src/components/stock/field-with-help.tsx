"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A form field label with an info icon that shows an explainer popover
 * on hover or click. Designed for scanner filter forms.
 */
export function FieldWithHelp({
  label,
  help,
  children,
}: {
  label: string;
  help: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="space-y-1" ref={ref}>
      <div className="flex items-center gap-1">
        <span className="text-xs font-medium">{label}</span>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground transition-colors"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onClick={() => setOpen((v) => !v)}
          aria-label={`Help for ${label}`}
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </div>
      {children}
      {open && (
        <div
          className={cn(
            "absolute z-50 max-w-xs rounded-md border bg-popover p-3 text-xs leading-relaxed shadow-md",
            "text-popover-foreground space-y-1.5",
          )}
          style={{ marginTop: 2 }}
        >
          {help}
        </div>
      )}
    </div>
  );
}

/**
 * A table header cell with an info icon that shows an explainer popover on hover.
 * Designed for the ranked candidate tables.
 */
export function TableHeadWithHelp({
  label,
  help,
}: {
  label: string;
  help: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <th
      className="h-9 px-2 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground"
    >
      <div className="relative inline-flex items-center gap-0.5" ref={ref}>
        <span>{label}</span>
        <button
          type="button"
          className="text-muted-foreground/60 hover:text-foreground transition-colors"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onClick={() => setOpen((v) => !v)}
          aria-label={`Help for ${label}`}
        >
          <HelpCircle className="h-3 w-3" />
        </button>
        {open && (
          <div
            className={cn(
              "absolute left-0 top-full z-50 max-w-xs rounded-md border bg-popover p-3 text-xs leading-relaxed shadow-md",
              "text-popover-foreground space-y-1.5 normal-case tracking-normal",
            )}
            style={{ marginTop: 4 }}
          >
            {help}
          </div>
        )}
      </div>
    </th>
  );
}

/**
 * Pre-written explainers for common scanner filters.
 * Written in plain English for users who are new to options.
 */
export const EXPLAINERS = {
  minOtmPercent: (
    <div className="space-y-1.5">
      <p className="font-semibold">Min OTM % (Out-of-the-Money)</p>
      <p>
        The minimum distance the call strike must be <em>above</em> the current stock price,
        expressed as a percentage. Enter a whole number (5 = 5%).
      </p>
      <p className="text-muted-foreground">
        <strong>Example:</strong> Stock at $100, Min OTM 5% → only shows calls at $105 or higher.
      </p>
      <p className="text-muted-foreground">
        <strong>Higher value</strong> = safer (less likely to be assigned) but lower premium.
        <br />
        <strong>Lower value</strong> = more premium but higher assignment risk.
      </p>
      <p className="text-muted-foreground">
        <strong>Typical range:</strong> 2–10%. Conservative: 5–10%. Aggressive: 0–3%.
      </p>
    </div>
  ),

  maxDelta: (
    <div className="space-y-1.5">
      <p className="font-semibold">Max Delta %</p>
      <p>
        Delta measures how much the option price moves per $1 move in the stock.
        For calls, delta also approximates the probability of assignment. Enter as a percentage (30 = 30%).
      </p>
      <p className="text-muted-foreground">
        <strong>Example:</strong> Delta 30% → ~30% chance the stock finishes above this strike
        at expiration (i.e., ~30% chance of assignment).
      </p>
      <p className="text-muted-foreground">
        <strong>Lower value (15–25%)</strong> = less assignment risk, lower premium.
        <br />
        <strong>Higher value (35–50%)</strong> = more premium, more assignment risk.
      </p>
      <p className="text-muted-foreground">
        <strong>Typical range:</strong> Conservative: 15–25%. Balanced: 25–35%. Aggressive: 35–50%.
      </p>
    </div>
  ),

  minPremiumYield: (
    <div className="space-y-1.5">
      <p className="font-semibold">Min Premium Yield %</p>
      <p>
        The minimum premium as a percentage of the stock price you&apos;re willing to accept.
        Premium yield = (option bid ÷ stock price) × 100. Enter a whole number (1 = 1%, 2 = 2%).
      </p>
      <p className="text-muted-foreground">
        <strong>Example:</strong> Stock at $100, call bid $2 → yield = 2%.
      </p>
      <p className="text-muted-foreground">
        <strong>Higher value</strong> = more income per trade, but usually means closer to the money
        (more assignment risk) or higher volatility.
        <br />
        <strong>0</strong> = show all calls regardless of yield.
      </p>
      <p className="text-muted-foreground">
        <strong>Typical range:</strong> 0.5–3% per expiration. Annualized this can be 5–30%+.
      </p>
    </div>
  ),

  minAnnualizedPremiumYield: (
    <div className="space-y-1.5">
      <p className="font-semibold">Min Annualized Yield %</p>
      <p>
        The minimum premium yield scaled to a one-year rate, so you can compare short and long
        expirations fairly. Enter a whole number (12 = 12% per year, 24 = 24% per year).
      </p>
      <p className="text-muted-foreground">
        <strong>How it&apos;s calculated:</strong> Annualized yield = (premium yield ÷ DTE) × 365.
        A 1% yield over 30 days annualizes to ~12.2%, but the same 1% over 90 days only annualizes
        to ~4.1%.
      </p>
      <p className="text-muted-foreground">
        <strong>Example:</strong> Stock $100, call bid $1, 30 DTE → yield 1%, annualized ≈ 12.2%.
        Setting Min Ann. Yield to 12 would show this call; setting it to 15 would hide it.
      </p>
      <p className="text-muted-foreground">
        <strong>Why use this:</strong> Short-dated options often have higher annualized yields due
        to theta decay, but require more frequent rolling. This filter lets you target a specific
        annual income rate regardless of expiration length.
        <br />
        <strong>0 or empty</strong> = show all calls regardless of annualized yield.
      </p>
      <p className="text-muted-foreground">
        <strong>Typical range:</strong> 10–30% for income-focused strategies. Conservative: 8–15%.
        Aggressive: 20–40%.
      </p>
    </div>
  ),

  minOpenInterest: (
    <div className="space-y-1.5">
      <p className="font-semibold">Min Open Interest</p>
      <p>
        Open interest = number of contracts currently held by market participants.
        Higher open interest means tighter bid/ask spreads and easier fills.
      </p>
      <p className="text-muted-foreground">
        <strong>0</strong> = no filter. <strong>100+</strong> = reasonable liquidity.
        <br />
        <strong>500+</strong> = very liquid. <strong>1000+</strong> = highly liquid.
      </p>
      <p className="text-muted-foreground">
        Low open interest can mean wider spreads and harder to exit the position.
      </p>
    </div>
  ),

  excludeEarnings: (
    <div className="space-y-1.5">
      <p className="font-semibold">Exclude Earnings</p>
      <p>
        If &quot;Yes&quot;, hides calls that expire <em>after</em> the next earnings date.
        Earnings can cause large price gaps that dramatically increase assignment risk.
      </p>
      <p className="text-muted-foreground">
        <strong>Yes (recommended)</strong> = safer, avoids earnings volatility.
        <br />
        <strong>No</strong> = includes earnings-expiration calls (higher premium, much higher risk).
      </p>
    </div>
  ),

  objective: (
    <div className="space-y-1.5">
      <p className="font-semibold">Objective</p>
      <p>How the scanner ranks candidates. Different goals optimize for different outcomes:</p>
      <ul className="text-muted-foreground space-y-0.5 list-disc pl-4">
        <li><strong>Balanced income + upside:</strong> Weighs premium and stock appreciation equally.</li>
        <li><strong>Max immediate income:</strong> Highest premium right now, regardless of upside.</li>
        <li><strong>Max annualized premium:</strong> Premium scaled to annual rate — favors short DTE.</li>
        <li><strong>Max total return:</strong> Premium + potential stock gain up to the strike.</li>
        <li><strong>Max upside retained:</strong> Far OTM calls — keep most of the stock&apos;s upside.</li>
        <li><strong>Lowest assignment risk:</strong> Prioritizes low delta / far OTM.</li>
        <li><strong>LEAPS income + growth:</strong> Long-dated calls for income + long-term upside.</li>
        <li><strong>Long-term / tax-aware:</strong> Favors long DTE for long-term capital gains.</li>
      </ul>
    </div>
  ),

  // Cash-secured put explainers
  targetEntry: (
    <div className="space-y-1.5">
      <p className="font-semibold">Target Effective Entry ($)</p>
      <p>
        The price you&apos;d actually pay per share if assigned. Effective entry = strike − premium.
      </p>
      <p className="text-muted-foreground">
        <strong>Example:</strong> You want to buy at $95. Stock is $100. Sell $97 put for $2 →
        effective entry = $97 − $2 = $95.
      </p>
      <p className="text-muted-foreground">
        Leave blank to show all puts. Set a value to filter for puts that hit your target buy price.
      </p>
    </div>
  ),

  minDiscountPercent: (
    <div className="space-y-1.5">
      <p className="font-semibold">Min Discount %</p>
      <p>
        The minimum distance the put strike must be <em>below</em> the current stock price,
        expressed as a percentage. Enter a whole number (5 = 5%).
      </p>
      <p className="text-muted-foreground">
        <strong>Example:</strong> Stock at $100, Min discount 5% → only shows puts at $95 or lower.
      </p>
      <p className="text-muted-foreground">
        <strong>Higher value</strong> = safer (less likely to be assigned) but lower premium.
        <br />
        <strong>Lower value</strong> = more premium but more likely to be assigned (forced to buy the stock).
      </p>
      <p className="text-muted-foreground">
        <strong>Typical range:</strong> 2–10%. Conservative: 5–10%. Aggressive: 0–3%.
      </p>
    </div>
  ),

  cashAvailable: (
    <div className="space-y-1.5">
      <p className="font-semibold">Cash Available ($)</p>
      <p>
        The cash you have set aside to cover the put if assigned. One put contract = 100 shares × strike price.
      </p>
      <p className="text-muted-foreground">
        <strong>Example:</strong> $10,000 cash → can sell puts up to ~$100 strike (1 contract).
        <br />
        $25,000 cash → can sell puts up to ~$125 strike (2 contracts at $100) or 1 at $250.
      </p>
      <p className="text-muted-foreground">
        The scanner filters out puts that require more collateral than you have.
      </p>
    </div>
  ),

  // -------------------------------------------------------------------------
  // Table column explainers (for ranked candidate tables)
  // -------------------------------------------------------------------------

  liqScore: (
    <div className="space-y-1.5">
      <p className="font-semibold">Liq (Liquidity Score)</p>
      <p>
        A 0–100 score measuring how easy it is to enter and exit the trade at fair prices.
        Based on bid/ask spread, open interest, and volume.
      </p>
      <div className="text-muted-foreground space-y-0.5">
        <p><strong className="text-profit">60+</strong> = Good liquidity. Tight spreads, easy fills.</p>
        <p><strong className="text-warning">30–59</strong> = Moderate. Wider spreads, may need limit orders.</p>
        <p><strong className="text-loss">&lt; 30</strong> = Poor liquidity. Wide spreads, hard to fill at mid.</p>
      </div>
      <p className="text-muted-foreground">
        Low liquidity means you may lose money to the bid/ask spread when entering and exiting.
      </p>
    </div>
  ),

  score: (
    <div className="space-y-1.5">
      <p className="font-semibold">Score (Composite Ranking)</p>
      <p>
        A 0–100 composite score that combines all factors — income, upside, assignment risk,
        liquidity, volatility, and total return — weighted by your selected objective.
      </p>
      <div className="text-muted-foreground space-y-0.5">
        <p><strong className="text-profit">70+</strong> = Excellent fit for your objective.</p>
        <p><strong className="text-warning">50–69</strong> = Good fit. Reasonable trade-offs.</p>
        <p><strong className="text-loss">&lt; 50</strong> = Weak fit. Better options available.</p>
      </div>
      <p className="text-muted-foreground">
        The weighting changes with your objective. &quot;Max income&quot; weighs premium heavily;
        &quot;Lowest assignment risk&quot; weighs delta heavily. The highest-scored option is the
        best match for your stated goal.
      </p>
    </div>
  ),

  iv: (
    <div className="space-y-1.5">
      <p className="font-semibold">IV (Implied Volatility)</p>
      <p>
        The market&apos;s expectation of how much the stock will move, expressed as an annualized
        percentage. Higher IV = higher premiums (but more risk).
      </p>
      <p className="text-muted-foreground">
        <strong>High IV (50%+)</strong> = expensive options, more premium, more risk.
        <br />
        <strong>Low IV (15–25%)</strong> = cheaper options, less premium, less risk.
      </p>
      <p className="text-muted-foreground">
        IV is annualized — a 30% IV means the market expects ~30% price movement over one year.
      </p>
    </div>
  ),

  delta: (
    <div className="space-y-1.5">
      <p className="font-semibold">Delta</p>
      <p>
        For calls: approximates the probability of assignment (stock finishing above the strike).
        For puts: approximates the probability of assignment (stock finishing below the strike).
      </p>
      <p className="text-muted-foreground">
        <strong>Call delta 0.30</strong> → ~30% chance of being assigned.
        <br />
        <strong>Put delta 0.30</strong> → ~30% chance of being assigned (put to you).
      </p>
    </div>
  ),

  calledAway: (
    <div className="space-y-1.5">
      <p className="font-semibold">Called Away %</p>
      <p>
        Estimated probability the option finishes in-the-money and the underlying shares are called away (for calls) or put to you (for puts).
      </p>
      <p className="text-muted-foreground">
        Blends three inputs:
      </p>
      <ul className="text-muted-foreground list-disc pl-4 space-y-0.5">
        <li><strong>Historical:</strong> % of past rolling windows where the stock closed past this strike.</li>
        <li><strong>Vol model:</strong> lognormal projection using historical volatility and drift.</li>
        <li><strong>Delta:</strong> market-implied probability proxy used as a fallback.</li>
      </ul>
      <p className="text-muted-foreground">
        <strong className="text-profit">&lt; 25%</strong> = low assignment risk &nbsp;
        <strong className="text-warning">25–50%</strong> = moderate &nbsp;
        <strong className="text-loss">&gt; 50%</strong> = high risk
      </p>
      <p className="text-muted-foreground italic">This is descriptive, not a guarantee. Hover the cell for the breakdown.</p>
    </div>
  ),

  otmPercent: (
    <div className="space-y-1.5">
      <p className="font-semibold">OTM % (Out-of-the-Money)</p>
      <p>
        How far the call strike is above the current stock price, as a percentage.
        Higher = more upside room before assignment.
      </p>
      <p className="text-muted-foreground">
        <strong>Example:</strong> Stock $100, strike $105 → OTM 5%.
      </p>
    </div>
  ),

  premiumYield: (
    <div className="space-y-1.5">
      <p className="font-semibold">Yield (Premium Yield)</p>
      <p>
        Premium as a percentage of the stock value. Yield = (option bid ÷ stock price) × 100.
      </p>
      <p className="text-muted-foreground">
        <strong>Example:</strong> Stock $100, call bid $2 → yield = 2%.
      </p>
    </div>
  ),

  annualizedYield: (
    <div className="space-y-1.5">
      <p className="font-semibold">Ann. Yield (Annualized Premium Yield)</p>
      <p>
        The premium yield scaled to a one-year rate, so you can compare short and long expirations
        fairly. A 1% yield over 12 days annualizes much higher than 1% over 90 days.
      </p>
      <p className="text-muted-foreground">
        <strong>Example:</strong> 1% yield over 30 days → ~12% annualized.
      </p>
    </div>
  ),

  maxTotalReturn: (
    <div className="space-y-1.5">
      <p className="font-semibold">Max Tot. Ret. (Maximum Total Return)</p>
      <p>
        The best-case return if the stock ends exactly at the strike at expiration.
        Includes the premium received + the stock appreciation up to the strike.
      </p>
      <p className="text-muted-foreground">
        <strong>Example:</strong> Stock $100, strike $105, premium $2 → max return = $2 premium + $5 appreciation = $7 (7%).
      </p>
    </div>
  ),

  annualizedMtr: (
    <div className="space-y-1.5">
      <p className="font-semibold">Ann. MTR (Annualized Max Total Return)</p>
      <p>
        The max total return scaled to a one-year rate, for comparing expirations of different lengths.
      </p>
    </div>
  ),

  // CSP table columns
  discountPercent: (
    <div className="space-y-1.5">
      <p className="font-semibold">Disc % (Discount to Current Price)</p>
      <p>
        How far the put strike is below the current stock price, as a percentage.
        Higher = safer (less likely to be assigned) but lower premium.
      </p>
    </div>
  ),

  effectiveEntry: (
    <div className="space-y-1.5">
      <p className="font-semibold">Eff. Entry (Effective Purchase Price)</p>
      <p>
        The price you&apos;d actually pay per share if assigned = strike − premium.
        This is the real &quot;buy price&quot; you&apos;re agreeing to.
      </p>
      <p className="text-muted-foreground">
        <strong>Example:</strong> Strike $95, premium $2 → effective entry = $93.
      </p>
    </div>
  ),

  effectiveDiscount: (
    <div className="space-y-1.5">
      <p className="font-semibold">Eff. Disc % (Effective Discount)</p>
      <p>
        How far the effective entry price is below the current stock price, as a percentage.
        This is the real discount you&apos;d get if assigned.
      </p>
    </div>
  ),

  returnOnNetCapital: (
    <div className="space-y-1.5">
      <p className="font-semibold">Ret. (net) (Return on Net Capital)</p>
      <p>
        The premium return as a percentage of the collateral you&apos;d need to set aside
        (strike × 100 shares per contract). This is the &quot;interest rate&quot; you earn
        on your cash while waiting.
      </p>
    </div>
  ),

  annualizedReturn: (
    <div className="space-y-1.5">
      <p className="font-semibold">Ann. Ret. (Annualized Return)</p>
      <p>
        The return on net capital scaled to a one-year rate, for comparing puts of different
        expirations. Short-dated puts often annualize much higher.
      </p>
    </div>
  ),

  collateral: (
    <div className="space-y-1.5">
      <p className="font-semibold">Collateral</p>
      <p>
        The cash you must set aside to cover the put if assigned = strike × 100 shares × contracts.
        This cash earns the premium return while you wait.
      </p>
    </div>
  ),
} as const;
