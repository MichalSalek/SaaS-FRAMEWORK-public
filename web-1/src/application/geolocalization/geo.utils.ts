import geoip from 'fast-geoip';
import type { UserMetadata } from '@kernel/models/db_models.manual.dto';

export const getCountryAndCity = async (
  props: Pick<UserMetadata, 'client_ip'>
): Promise<string | null> => {
  const ip = props?.client_ip;
  if (!ip) {
    return null;
  }

  try {
    const geo = await geoip.lookup(ip);
    if (!geo) {
      return null;
    }
    return `${geo.country}, ${geo.city}. Timezone: ${geo.timezone}`;
  } catch {
    return null;
  }
};
