// Próbka łamiąca regułę: jawny typ `any` w sygnaturze.
export const parse = (raw: string): any => JSON.parse(raw);
