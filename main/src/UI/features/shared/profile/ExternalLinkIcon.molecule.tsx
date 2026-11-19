import {
  CalendarCheckIcon,
  FacebookLogoIcon,
  GlobeSimpleIcon,
  InstagramLogoIcon,
  MapPinIcon,
  ScissorsIcon,
  TiktokLogoIcon,
  WhatsappLogoIcon,
} from '@phosphor-icons/react';
import { detectExternalLinkService } from '@kernel/domain/user-and-account/external-links.config';

export function ExternalLinkIconMolecule({
  url,
  size = 18,
}: {
  url: string;
  size?: number;
}) {
  const service = detectExternalLinkService(url);
  const props = { size, weight: 'regular' as const, 'aria-hidden': true };
  switch (service.id) {
    case 'booksy':
      return <CalendarCheckIcon {...props} />;
    case 'fresha':
    case 'treatwell':
      return <ScissorsIcon {...props} />;
    case 'instagram':
      return <InstagramLogoIcon {...props} />;
    case 'facebook':
      return <FacebookLogoIcon {...props} />;
    case 'tiktok':
      return <TiktokLogoIcon {...props} />;
    case 'whatsapp':
      return <WhatsappLogoIcon {...props} />;
    case 'maps':
      return <MapPinIcon {...props} />;
    default:
      return <GlobeSimpleIcon {...props} />;
  }
}
