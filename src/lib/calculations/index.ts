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
