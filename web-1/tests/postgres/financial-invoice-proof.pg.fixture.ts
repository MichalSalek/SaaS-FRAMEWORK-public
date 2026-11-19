export type AccountSeed = {
  id: string;
  plan: string;
  paymentStatus: string;
  accountStatus: string;
  subscriptionStatus: string | null;
  subscriptionId: string | null;
  adminGrant: boolean;
  trial: boolean;
};

export type EventSeed = {
  id: string;
  atOffsetDays: number;
  payload: unknown;
};

/**
 * id, plan, payment_status, account_status, subscription_status, subscription_id,
 * admin grant, trial. payment_status is planted as the old false signal.
 */
const ACCOUNTS: Array<
  [
    string,
    string,
    string,
    string,
    string | null,
    string | null,
    boolean,
    boolean,
  ]
> = [
  ['A', 'PRO', 'PAID', 'ACTIVE', 'ACTIVE', 'sub_A', false, true],
  ['B', 'PRO', 'PAID', 'ACTIVE', 'TRIALING', 'sub_B', false, true],
  ['C', 'PRO', 'PAID', 'ACTIVE', 'ACTIVE', 'sub_C', false, true],
  ['D', 'PRO', 'PAID', 'ACTIVE', 'ACTIVE', 'sub_D', false, true],
  ['E', 'PRO', 'PAID', 'ACTIVE', 'CANCELED', 'sub_E', false, false],
  ['F', 'FREE', 'UNPAID', 'ACTIVE', null, null, false, false],
  ['G', 'STUDIO', 'PAID', 'ACTIVE', 'ACTIVE', 'sub_G', true, false],
  ['H', 'PRO', 'PAID', 'ACTIVE', 'ACTIVE', 'sub_H_new', false, false],
  ['I', 'PRO', 'PAID', 'ACTIVE', 'ACTIVE', 'sub_I', false, false],
  ['J', 'PRO', 'PAID', 'ACTIVE', 'ACTIVE', 'sub_J', false, false],
  ['K', 'PRO', 'UNPAID', 'ACTIVE', 'ACTIVE', 'sub_K', false, false],
  ['L', 'PRO', 'IN_PROGRESS', 'ACTIVE', 'PAST_DUE', 'sub_L', false, false],
  ['M', 'PRO', 'PAID', 'NOT_ACTIVE', 'ACTIVE', 'sub_M', false, false],
  ['N', 'PRO', 'PAID', 'ACTIVE', 'ACTIVE', 'sub_N', false, false],
  ['P', 'FREE', 'PAID', 'ACTIVE', 'ACTIVE', 'sub_P', false, false],
];

const invoice = (
  accountId: string,
  invoiceId: string,
  amountPaid: unknown,
  subscriptionId?: string
) => ({
  accountId,
  invoiceId,
  amountPaid,
  ...(subscriptionId ? { subscriptionId } : {}),
});

/** atOffsetDays is relative to the test clock. periodEnd is day -10, now is day 0. */
const EVENTS: EventSeed[] = [
  {
    id: 'ev_A',
    atOffsetDays: -25,
    payload: invoice('A', 'in_A', 4900, 'sub_A'),
  },
  { id: 'ev_B', atOffsetDays: -25, payload: invoice('B', 'in_B', 0, 'sub_B') },
  { id: 'ev_C', atOffsetDays: -25, payload: invoice('C', 'in_C', 4900) },
  {
    id: 'ev_D1',
    atOffsetDays: -24,
    payload: invoice('D', 'in_D1', 4900, 'sub_D'),
  },
  {
    id: 'ev_D2',
    atOffsetDays: -16,
    payload: invoice('D', 'in_D2', 0, 'sub_D'),
  },
  {
    id: 'ev_E',
    atOffsetDays: -25,
    payload: invoice('E', 'in_E', 4900, 'sub_E'),
  },
  {
    id: 'ev_G',
    atOffsetDays: -25,
    payload: invoice('G', 'in_G', 9900, 'sub_G'),
  },
  {
    id: 'ev_H',
    atOffsetDays: -25,
    payload: invoice('H', 'in_H', 4900, 'sub_H_old'),
  },
  {
    id: 'ev_I_text',
    atOffsetDays: -25,
    payload: invoice('I', 'in_I1', '12abc'),
  },
  { id: 'ev_I_bool', atOffsetDays: -25, payload: invoice('I', 'in_I2', true) },
  {
    id: 'ev_I_obj',
    atOffsetDays: -25,
    payload: invoice('I', 'in_I3', { v: 1 }),
  },
  { id: 'ev_I_arr', atOffsetDays: -25, payload: invoice('I', 'in_I4', [4900]) },
  { id: 'ev_I_blank', atOffsetDays: -25, payload: invoice('I', 'in_I5', '') },
  { id: 'ev_payload_array', atOffsetDays: -25, payload: [4900] },
  { id: 'ev_payload_string', atOffsetDays: -25, payload: '4900' },
  { id: 'ev_payload_null', atOffsetDays: -25, payload: null },
  {
    id: 'ev_J1',
    atOffsetDays: -25,
    payload: invoice('J', 'in_J', '4900', 'sub_J'),
  },
  { id: 'ev_J2', atOffsetDays: -24, payload: invoice('J', 'in_J', 0, 'sub_J') },
  {
    id: 'ev_K',
    atOffsetDays: -5,
    payload: invoice('K', 'in_K', 4900, 'sub_K'),
  },
  {
    id: 'ev_L',
    atOffsetDays: -25,
    payload: invoice('L', 'in_L', 4900, 'sub_L'),
  },
  {
    id: 'ev_M',
    atOffsetDays: -25,
    payload: invoice('M', 'in_M', 4900, 'sub_M'),
  },
  { id: 'ev_N', atOffsetDays: 2, payload: invoice('N', 'in_N', 4900, 'sub_N') },
  {
    id: 'ev_P',
    atOffsetDays: -25,
    payload: invoice('P', 'in_P', 4900, 'sub_P'),
  },
];

export const accountSeeds = (): AccountSeed[] =>
  ACCOUNTS.map(
    ([
      id,
      plan,
      paymentStatus,
      accountStatus,
      subscriptionStatus,
      subscriptionId,
      adminGrant,
      trial,
    ]) => ({
      id,
      plan,
      paymentStatus,
      accountStatus,
      subscriptionStatus,
      subscriptionId,
      adminGrant,
      trial,
    })
  );

export const eventSeeds = (): EventSeed[] => EVENTS;
