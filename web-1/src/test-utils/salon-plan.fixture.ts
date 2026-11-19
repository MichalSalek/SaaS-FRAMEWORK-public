export function activeSalonMembershipFixture(plan: 'STUDIO' | 'SCALE' | null) {
  return plan
    ? [
        {
          user_id: 'member',
          accepted_at: new Date(),
          is_active: true,
          stylist_account: {
            account_id: 'salon',
            business_name: 'Salon',
            display_name: 'Owner',
            pricing_plan: plan,
            subscription_status: 'ACTIVE',
          },
        },
      ]
    : [];
}
