import type { Agent } from '@clwa/engine';

/**
 * Debt ledger (M7 P5) — module-scope state, reconstructed-from-events on reload (mirrors crime's
 * imprisonmentTimers). A loan records what the debtor owes the creditor; collection settles it via the E2
 * overdraft transfer (the debtor's gold may go negative down to a floor before defaulting).
 */
export interface DebtRecord { creditorId: string; amount: number; }

export const debtLedger = new Map<string, DebtRecord>(); // keyed by debtorId (one active loan per debtor in v1)

export const LOAN_AMOUNT = 30;
export const LOAN_INTEREST = 1.25;  // debtor owes 125% of principal
export const DEBT_FLOOR = -120;     // E2: gold may overdraft this far to settle a debt before defaulting

export function recordDebt(debtorId: string, creditorId: string, amount: number): void {
  debtLedger.set(debtorId, { creditorId, amount });
}
export function getDebt(debtorId: string): DebtRecord | undefined { return debtLedger.get(debtorId); }
export function clearDebt(debtorId: string): void { debtLedger.delete(debtorId); }

/** Is this agent owed by anyone? (collect_debt `isCreditorOf` requirement) */
export function isCreditor(creditorId: string): boolean {
  for (const d of debtLedger.values()) if (d.creditorId === creditorId) return true;
  return false;
}
/** First debtor who owes this creditor — the `debtor` target finder. */
export function findDebtorOf(creditorId: string): string | undefined {
  for (const [debtorId, d] of debtLedger) if (d.creditorId === creditorId) return debtorId;
  return undefined;
}
/** A needy agent with no existing debt — a candidate for a (predatory) loan. */
export function canBorrow(agent: Agent): boolean {
  return !debtLedger.has(agent.profile.id);
}
