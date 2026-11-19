export type FeatureFlagDTO = {
  id: string;
  key: string;
  description: string | null;
  is_enabled: boolean;
  expires_at: string | null;
  updated_at: string;
};
