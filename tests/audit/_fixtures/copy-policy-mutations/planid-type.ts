export type Row = { planId: 'pro' };
export const row = { planId: readPlan() };
declare function readPlan(): string;
