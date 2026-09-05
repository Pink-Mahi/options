"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OverviewTab } from "@/components/stock/tabs/overview-tab";
import { CoveredCallsTab } from "@/components/stock/tabs/covered-calls-tab";
import { CashSecuredPutsTab } from "@/components/stock/tabs/cash-secured-puts-tab";
import { OptionChainTab } from "@/components/stock/tabs/option-chain-tab";
import { HistoricalTab } from "@/components/stock/tabs/historical-tab";
import { CalculatorTab } from "@/components/stock/tabs/calculator-tab";
import { ComparisonTab } from "@/components/stock/tabs/comparison-tab";
import { ContractComparisonTab } from "@/components/stock/tabs/contract-comparison-tab";
import { StockAIChat } from "@/components/stock/tabs/stock-ai-chat";
import { RiskAnalysisTab } from "@/components/stock/tabs/risk-analysis-tab";
import { TechnicalAnalysisTab } from "@/components/stock/tabs/technical-analysis-tab";
import { NewsSentimentTab } from "@/components/stock/tabs/news-sentiment-tab";
import { EarningsTab } from "@/components/stock/tabs/earnings-tab";
import { PeersTab } from "@/components/stock/tabs/peers-tab";
import type { StockData } from "@/features/options/stock-data";
import type { Portfolio } from "@/lib/types";

export function StockTabs({ data, portfolio }: { data: StockData; portfolio: Portfolio | null }) {
  const [expiration, setExpiration] = useState<string>(
    data.expirations[0]?.expirationDate ?? "",
  );

  return (
    <Tabs defaultValue="overview">
      <TabsList className="flex w-full flex-wrap h-auto">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="covered-calls">Covered Calls</TabsTrigger>
        <TabsTrigger value="cash-secured-puts">Cash-Secured Puts</TabsTrigger>
        <TabsTrigger value="option-chain">Option Chain</TabsTrigger>
        <TabsTrigger value="compare-contracts">Compare Contracts</TabsTrigger>
        <TabsTrigger value="historical">Historical</TabsTrigger>
        <TabsTrigger value="technical">Technical Analysis</TabsTrigger>
        <TabsTrigger value="news">News &amp; Sentiment</TabsTrigger>
        <TabsTrigger value="earnings">Earnings</TabsTrigger>
        <TabsTrigger value="peers">Peers</TabsTrigger>
        <TabsTrigger value="risk">Risk Analysis</TabsTrigger>
        <TabsTrigger value="comparison">Compare DTE</TabsTrigger>
        <TabsTrigger value="calculator">Profit Calculator</TabsTrigger>
        <TabsTrigger value="ai">AI Analysis</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <OverviewTab data={data} portfolio={portfolio} expiration={expiration} onExpirationChange={setExpiration} />
      </TabsContent>
      <TabsContent value="covered-calls">
        <CoveredCallsTab data={data} portfolio={portfolio} expiration={expiration} onExpirationChange={setExpiration} />
      </TabsContent>
      <TabsContent value="cash-secured-puts">
        <CashSecuredPutsTab data={data} portfolio={portfolio} expiration={expiration} onExpirationChange={setExpiration} />
      </TabsContent>
      <TabsContent value="option-chain">
        <OptionChainTab data={data} expiration={expiration} onExpirationChange={setExpiration} />
      </TabsContent>
      <TabsContent value="compare-contracts">
        <ContractComparisonTab data={data} expiration={expiration} onExpirationChange={setExpiration} />
      </TabsContent>
      <TabsContent value="historical">
        <HistoricalTab data={data} />
      </TabsContent>
      <TabsContent value="technical">
        <TechnicalAnalysisTab data={data} />
      </TabsContent>
      <TabsContent value="news">
        <NewsSentimentTab data={data} />
      </TabsContent>
      <TabsContent value="earnings">
        <EarningsTab data={data} />
      </TabsContent>
      <TabsContent value="peers">
        <PeersTab data={data} />
      </TabsContent>
      <TabsContent value="risk">
        <RiskAnalysisTab data={data} />
      </TabsContent>
      <TabsContent value="comparison">
        <ComparisonTab data={data} />
      </TabsContent>
      <TabsContent value="calculator">
        <CalculatorTab data={data} expiration={expiration} onExpirationChange={setExpiration} />
      </TabsContent>
      <TabsContent value="ai">
        <StockAIChat symbol={data.symbol} />
      </TabsContent>
    </Tabs>
  );
}
