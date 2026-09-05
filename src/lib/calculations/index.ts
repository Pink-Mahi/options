/**
 * Calculation engine barrel.
 *
 * Every financial number in the UI, scanners, AI layer, and exports MUST come
 * from these functions so the numbers always agree.
 */

export * from "./core";
export * from "./returns";
export * from "./covered-call";
export * from "./cash-secured-put";
export * from "./payoff";
export * from "./historical";
export * from "./opportunity-cost";
export * from "./pricing-model";
export * from "./multi-leg";
export * from "./backtester";
export * from "./prediction-score";
export * from "./assignment-risk";
export * from "./beta-risk";
export * from "./wheel-tracker";
export * from "./tax";
export * from "./market-regime";
export * from "./execution";
