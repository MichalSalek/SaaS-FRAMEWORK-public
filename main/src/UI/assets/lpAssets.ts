import { BRAND_ASSETS, refreshedAsset } from './brandAssets';

// DECISION: changed assets keep their file paths but get a new request URL: production image
// optimization caches variants for a year across releases, so versioning stops old photos/screens
// from surviving a deployment. The catalog stays compact so related assets scan together.
// prettier-ignore
export const LP_ASSETS = {
  hero: {
    heroNail01Nude: refreshedAsset('/img/lp/hero/hero-nail-01-nude.webp'),
    heroNail03Geometric: refreshedAsset('/img/lp/hero/hero-nail-03-geometric.webp'),
    heroNail04Ombre: refreshedAsset('/img/lp/hero/hero-nail-04-ombre.webp'),
    heroNail05Floral: refreshedAsset('/img/lp/hero/hero-nail-05-floral.webp'),
    heroNail06InkViolet: refreshedAsset('/img/lp/hero/hero-nail-06-ink-violet.webp'),
    heroNail09DarkEditorial: refreshedAsset('/img/lp/hero/hero-nail-09-dark-editorial.webp'),
    heroNail10BridalFloral: refreshedAsset('/img/lp/hero/hero-nail-10-bridal-floral.webp'),
    heroNail11SalonCleanGirl: refreshedAsset('/img/lp/hero/hero-nail-11-salon-clean-girl.webp'),
    heroNail12PearlChromePortrait: refreshedAsset('/img/lp/hero/hero-nail-12-pearl-chrome-portrait.webp'),
    heroNail13AutumnWineSalon: refreshedAsset('/img/lp/hero/hero-nail-13-autumn-wine-salon.webp'),
    heroNail14BridalMilkyWhite: refreshedAsset('/img/lp/hero/hero-nail-14-bridal-milky-white.webp'),
    heroNail15DarkChocolate: refreshedAsset('/img/lp/hero/hero-nail-15-dark-chocolate.webp'),
    heroNail16VelvetCatEye: refreshedAsset('/img/lp/hero/hero-nail-16-velvet-cat-eye.webp'),
    heroNail17GlazedKnit: refreshedAsset('/img/lp/hero/hero-nail-17-glazed-knit.webp'),
    heroNail18CherryBottle: refreshedAsset('/img/lp/hero/hero-nail-18-cherry-bottle.webp'),
    heroNail19MoltenFrench: refreshedAsset('/img/lp/hero/hero-nail-19-molten-french.webp'),
    heroNail20Application: refreshedAsset('/img/lp/hero/hero-nail-20-application.webp'),
    heroDiv01SideProfile: refreshedAsset('/img/lp/hero/hero-div-01-side-profile.webp'),
    heroDiv02LowAngle: refreshedAsset('/img/lp/hero/hero-div-02-low-angle.webp'),
    heroDiv03WideForearm: refreshedAsset('/img/lp/hero/hero-div-03-wide-forearm.webp'),
  },
  portfolio: {
    manicure01: refreshedAsset('/img/lp/portfolio/manicure-01.webp'),
    manicure03: refreshedAsset('/img/lp/portfolio/manicure-03.webp'),
    manicure06: refreshedAsset('/img/lp/portfolio/manicure-06.webp'),
    manicure08: refreshedAsset('/img/lp/portfolio/manicure-08.webp'),
    nailCobaltGlass: refreshedAsset('/img/lp/portfolio/nail-cobalt-glass.webp'),
    nail01: refreshedAsset('/img/lp/portfolio/nail-01.webp'),
    nail03: refreshedAsset('/img/lp/portfolio/nail-03.webp'),
    nail05: refreshedAsset('/img/lp/portfolio/nail-05.webp'),
    nail06: refreshedAsset('/img/lp/portfolio/nail-06.webp'),
    nail07: refreshedAsset('/img/lp/portfolio/nail-07.webp'),
    nail08: refreshedAsset('/img/lp/portfolio/nail-08.webp'),
    nail09ShortNude: refreshedAsset('/img/lp/portfolio/nail-09-short-nude.webp'),
    nail13ShortPastel: refreshedAsset('/img/lp/portfolio/nail-13-short-pastel.webp'),
    nail14ShortGlitter: refreshedAsset('/img/lp/portfolio/nail-14-short-glitter.webp'),
    nail17MediumOmbre: refreshedAsset('/img/lp/portfolio/nail-17-medium-ombre.webp'),
    nail20MediumGeometric: refreshedAsset('/img/lp/portfolio/nail-20-medium-geometric.webp'),
    nail21MediumRed: refreshedAsset('/img/lp/portfolio/nail-21-medium-red.webp'),
    nail22MediumWedding: refreshedAsset('/img/lp/portfolio/nail-22-medium-wedding.webp'),
    nail24MediumFloral: refreshedAsset('/img/lp/portfolio/nail-24-medium-floral.webp'),
    nail26LongOmbre: refreshedAsset('/img/lp/portfolio/nail-26-long-ombre.webp'),
    nail27LongFrench: refreshedAsset('/img/lp/portfolio/nail-27-long-french.webp'),
    nail30LongFloral: refreshedAsset('/img/lp/portfolio/nail-30-long-floral.webp'),
    nail32LongMinimalLine: refreshedAsset('/img/lp/portfolio/nail-32-long-minimal-line.webp'),
    nail33XlDarkEditorial: refreshedAsset('/img/lp/portfolio/nail-33-xl-dark-editorial.webp'),
    nail40XlPastel: refreshedAsset('/img/lp/portfolio/nail-40-xl-pastel.webp'),
    nail41MediumBabyBoomer: refreshedAsset('/img/lp/portfolio/nail-41-medium-baby-boomer.webp'),
    nail42MediumSageMicroFrench: refreshedAsset('/img/lp/portfolio/nail-42-medium-sage-micro-french.webp'),
    nail43MediumCatEyeRoseGold: refreshedAsset('/img/lp/portfolio/nail-43-medium-cat-eye-rose-gold.webp'),
    nail44ShortCherryRed: refreshedAsset('/img/lp/portfolio/nail-44-short-cherry-red.webp'),
    nail45LongChampagneChrome: refreshedAsset('/img/lp/portfolio/nail-45-long-champagne-chrome.webp'),
    nail46MediumTortoiseshell: refreshedAsset('/img/lp/portfolio/nail-46-medium-tortoiseshell.webp'),
    nail47MediumAuraBlush: refreshedAsset('/img/lp/portfolio/nail-47-medium-aura-blush.webp'),
    nail48ShortClassicFrench: refreshedAsset('/img/lp/portfolio/nail-48-short-classic-french.webp'),
    nail49MediumMarbleAccent: refreshedAsset('/img/lp/portfolio/nail-49-medium-marble-accent.webp'),
    nail50LongBlackCherry: refreshedAsset('/img/lp/portfolio/nail-50-long-black-cherry.webp'),
    nail51Medium3dGelDroplets: refreshedAsset('/img/lp/portfolio/nail-51-medium-3d-gel-droplets.webp'),
    nail52ChampagneChromeSilk: refreshedAsset('/img/lp/portfolio/nail-52-champagne-chrome-silk.webp'),
    nail53JellyOilDroplet: refreshedAsset('/img/lp/portfolio/nail-53-jelly-oil-droplet.webp'),
    nailDiscover01: refreshedAsset('/img/lp/portfolio/nail-discover-01.webp'),
    nailDiscover02: refreshedAsset('/img/lp/portfolio/nail-discover-02.webp'),
    nailDiscover03: refreshedAsset('/img/lp/portfolio/nail-discover-03.webp'),
    nailWideBand: refreshedAsset('/img/lp/portfolio/nail-wide-band.webp'),
    nailDivPov01: refreshedAsset('/img/lp/portfolio/nail-div-pov-01.webp'),
    nailDivThreequarter02: refreshedAsset('/img/lp/portfolio/nail-div-threequarter-02.webp'),
    nailDivInteraction03: refreshedAsset('/img/lp/portfolio/nail-div-interaction-03.webp'),
    nailDivPhone04: refreshedAsset('/img/lp/portfolio/nail-div-phone-04.webp'),
    nailDivStation05: refreshedAsset('/img/lp/portfolio/nail-div-station-05.webp'),
  },
  editorial: {
    salonTeamSwatch: refreshedAsset('/img/lp/editorial/salon-team-swatch.webp'),
    editorialNail01SalonBlackCherry: refreshedAsset('/img/lp/editorial/editorial-nail-01-salon-black-cherry.webp'),
    editorialNail02DetailFloralTools: refreshedAsset('/img/lp/editorial/editorial-nail-02-detail-floral-tools.webp'),
    editorialNail03ChromeSalonTools: refreshedAsset('/img/lp/editorial/editorial-nail-03-chrome-salon-tools.webp'),
    editorialNail04ClientLampMoment: refreshedAsset('/img/lp/editorial/editorial-nail-04-client-lamp-moment.webp'),
    staticSalonEntrance01: refreshedAsset('/img/lp/editorial/static-salon-entrance-01.webp'),
    staticPricingPolishShelf02: refreshedAsset('/img/lp/editorial/static-pricing-polish-shelf-02.webp'),
    staticHelpDesk03: refreshedAsset('/img/lp/editorial/static-help-desk-03.webp'),
    staticGetAppPhone04: refreshedAsset('/img/lp/editorial/static-get-app-phone-04.webp'),
    staticPrivacyClosedBook05: refreshedAsset('/img/lp/editorial/static-privacy-closed-book-05.webp'),
    staticClientPhoneCafe06: refreshedAsset('/img/lp/editorial/static-client-phone-cafe-06.webp'),
  },
  mockups: {
    phoneNail01EmptyScreen: refreshedAsset('/img/lp/mockups/phone-nail-01-empty-screen.webp'),
    phoneNail02OverlayScreen: refreshedAsset('/img/lp/mockups/phone-nail-02-overlay-screen.webp'),
    phoneNail03TableOverlay: refreshedAsset('/img/lp/mockups/phone-nail-03-table-overlay.webp'),
  },
  /* App screens for the `PhoneMockup` frame, per LANGUAGE (390px, DPR2, current dark interface).
   *
   * DECISION: (1) the shots are TRILINGUAL: app screens contain text, so a Polish
   * phone on an English page gives the mockup away. (2) Hence an entry is a MAP by language, not one
   * path. The path is chosen by the `useAppScreenshots` hook (UI/assets/useAppScreenshots.ts); never
   * build it from the locale in a component, because `audit:asset-paths` verifies file existence only
   * for literals in THIS file. (3) The set is the screens the owner picked.
   * Regenerate: scripts/assets/app-screens/{capture.cjs,shots-lp.json} (persona + route + scroll per
   * screen), then convert to 780px webp. (owner)
   */
  app: {
    /** stylist dashboard */
    appDashboard: {
      pl: refreshedAsset('/img/lp/app/pl/appDashboard.webp'),
      en: refreshedAsset('/img/lp/app/en/appDashboard.webp'),
      de: refreshedAsset('/img/lp/app/de/appDashboard.webp'),
    },
    /** stylist gallery, tile view (two columns) */
    appGalleryFeed: {
      pl: refreshedAsset('/img/lp/app/pl/appGalleryFeed.webp'),
      en: refreshedAsset('/img/lp/app/en/appGalleryFeed.webp'),
      de: refreshedAsset('/img/lp/app/de/appGalleryFeed.webp'),
    },
    /** stylist gallery, default view: one photo across the full width
        (owner: the shots show both views, not tiles six times) */
    appGalleryWide: {
      pl: refreshedAsset('/img/lp/app/pl/appGalleryWide.webp'),
      en: refreshedAsset('/img/lp/app/en/appGalleryWide.webp'),
      de: refreshedAsset('/img/lp/app/de/appGalleryWide.webp'),
    },
    /** work detail (red) */
    appPhotoRed: {
      pl: refreshedAsset('/img/lp/app/pl/appPhotoRed.webp'),
      en: refreshedAsset('/img/lp/app/en/appPhotoRed.webp'),
      de: refreshedAsset('/img/lp/app/de/appPhotoRed.webp'),
    },
    /** work detail (chrome) */
    appPhotoChrome: {
      pl: refreshedAsset('/img/lp/app/pl/appPhotoChrome.webp'),
      en: refreshedAsset('/img/lp/app/en/appPhotoChrome.webp'),
      de: refreshedAsset('/img/lp/app/de/appPhotoChrome.webp'),
    },
    /** connection requests and the client list */
    appPairingRequests: {
      pl: refreshedAsset('/img/lp/app/pl/appPairingRequests.webp'),
      en: refreshedAsset('/img/lp/app/en/appPairingRequests.webp'),
      de: refreshedAsset('/img/lp/app/de/appPairingRequests.webp'),
    },
    /** client card, contact */
    appClientCard: {
      pl: refreshedAsset('/img/lp/app/pl/appClientCard.webp'),
      en: refreshedAsset('/img/lp/app/en/appClientCard.webp'),
      de: refreshedAsset('/img/lp/app/de/appClientCard.webp'),
    },
    /** client card, visit history */
    appClientCardVisits: {
      pl: refreshedAsset('/img/lp/app/pl/appClientCardVisits.webp'),
      en: refreshedAsset('/img/lp/app/en/appClientCardVisits.webp'),
      de: refreshedAsset('/img/lp/app/de/appClientCardVisits.webp'),
    },
    /** conversation list */
    appMessages: {
      pl: refreshedAsset('/img/lp/app/pl/appMessages.webp'),
      en: refreshedAsset('/img/lp/app/en/appMessages.webp'),
      de: refreshedAsset('/img/lp/app/de/appMessages.webp'),
    },
    /** conversation with a client */
    appThread: {
      pl: refreshedAsset('/img/lp/app/pl/appThread.webp'),
      en: refreshedAsset('/img/lp/app/en/appThread.webp'),
      de: refreshedAsset('/img/lp/app/de/appThread.webp'),
    },
    /** inspiration session from a client */
    appInboxSession: {
      pl: refreshedAsset('/img/lp/app/pl/appInboxSession.webp'),
      en: refreshedAsset('/img/lp/app/en/appInboxSession.webp'),
      de: refreshedAsset('/img/lp/app/de/appInboxSession.webp'),
    },
    /** inspiration session, photos */
    appInboxSessionScrolled: {
      pl: refreshedAsset('/img/lp/app/pl/appInboxSessionScrolled.webp'),
      en: refreshedAsset('/img/lp/app/en/appInboxSessionScrolled.webp'),
      de: refreshedAsset('/img/lp/app/de/appInboxSessionScrolled.webp'),
    },
    /** studio team */
    appSalonStaff: {
      pl: refreshedAsset('/img/lp/app/pl/appSalonStaff.webp'),
      en: refreshedAsset('/img/lp/app/en/appSalonStaff.webp'),
      de: refreshedAsset('/img/lp/app/de/appSalonStaff.webp'),
    },
    /** adding a work */
    appUpload: {
      pl: refreshedAsset('/img/lp/app/pl/appUpload.webp'),
      en: refreshedAsset('/img/lp/app/en/appUpload.webp'),
      de: refreshedAsset('/img/lp/app/de/appUpload.webp'),
    },
    /** stylist public profile */
    appPublicProfile: {
      pl: refreshedAsset('/img/lp/app/pl/appPublicProfile.webp'),
      en: refreshedAsset('/img/lp/app/en/appPublicProfile.webp'),
      de: refreshedAsset('/img/lp/app/de/appPublicProfile.webp'),
    },
    /** client dashboard */
    appClientHome: {
      pl: refreshedAsset('/img/lp/app/pl/appClientHome.webp'),
      en: refreshedAsset('/img/lp/app/en/appClientHome.webp'),
      de: refreshedAsset('/img/lp/app/de/appClientHome.webp'),
    },
    /** client's favorite works */
    appClientFavorites: {
      pl: refreshedAsset('/img/lp/app/pl/appClientFavorites.webp'),
      en: refreshedAsset('/img/lp/app/en/appClientFavorites.webp'),
      de: refreshedAsset('/img/lp/app/de/appClientFavorites.webp'),
    },
    /** client's inspiration session list */
    appClientSessions: {
      pl: refreshedAsset('/img/lp/app/pl/appClientSessions.webp'),
      en: refreshedAsset('/img/lp/app/en/appClientSessions.webp'),
      de: refreshedAsset('/img/lp/app/de/appClientSessions.webp'),
    },
    /** client session, chosen works */
    appClientSessionDetail: {
      pl: refreshedAsset('/img/lp/app/pl/appClientSessionDetail.webp'),
      en: refreshedAsset('/img/lp/app/en/appClientSessionDetail.webp'),
      de: refreshedAsset('/img/lp/app/de/appClientSessionDetail.webp'),
    },
    /** client profile */
    appClientProfile: {
      pl: refreshedAsset('/img/lp/app/pl/appClientProfile.webp'),
      en: refreshedAsset('/img/lp/app/en/appClientProfile.webp'),
      de: refreshedAsset('/img/lp/app/de/appClientProfile.webp'),
    },
    /** client-stylist connection */
    appClientPairing: {
      pl: refreshedAsset('/img/lp/app/pl/appClientPairing.webp'),
      en: refreshedAsset('/img/lp/app/en/appClientPairing.webp'),
      de: refreshedAsset('/img/lp/app/de/appClientPairing.webp'),
    },
  },
  decor: {
    nailOutline: refreshedAsset('/img/nail-art/v2/clients.webp'),
    phoneGalleryOutline: refreshedAsset('/img/nail-art/v2/portfolio.webp'),
    womanPhoneOutline: refreshedAsset('/img/nail-art/v2/get-app.webp'),
    decorNail01LineArt: refreshedAsset('/img/nail-art/v2/line-art.webp'),
    decorNail02SwatchCorners: refreshedAsset('/img/nail-art/v2/swatches.webp'),
    staticPricingPlans: refreshedAsset('/img/nail-art/v2/pricing.webp'),
    staticHelpThread: refreshedAsset('/img/nail-art/v2/help.webp'),
    staticPrivacyShield: refreshedAsset('/img/nail-art/v2/privacy.webp'),
    staticContactEnvelope: refreshedAsset('/img/nail-art/v2/contact.webp'),
    staticAppDownload: refreshedAsset('/img/nail-art/v2/download.webp'),
    staticLocationPin: refreshedAsset('/img/nail-art/v2/location.webp'),
    homeFinale: refreshedAsset('/img/nail-art/v2/home-finale.webp'),
    pricingIntro: refreshedAsset('/img/nail-art/v2/pricing-intro.webp'),
    supportInbox: refreshedAsset('/img/nail-art/v2/support-inbox.webp'),
  },
  steps: {
    step01Upload: refreshedAsset('/img/nail-art/v2/upload.webp'),
    step02Qr: refreshedAsset('/img/nail-art/v2/qr.webp'),
    step03Filter: refreshedAsset('/img/nail-art/v2/filter.webp'),
    stepDiv01HandPhone: refreshedAsset('/img/nail-art/v2/process.webp'),
  },
  empty: {
    emptyFavorites: refreshedAsset('/img/nail-art/v2/favorites.webp'),
    emptyGallery: refreshedAsset('/img/nail-art/v2/empty-gallery.webp'),
    emptyPairing: refreshedAsset('/img/nail-art/v2/empty-pairing.webp'),
    emptyExplore: refreshedAsset('/img/nail-art/v2/explore.webp'),
    clientStart: refreshedAsset('/img/nail-art/v2/client-start.webp'),
    connectionsWidget: refreshedAsset('/img/nail-art/v2/connections-widget.webp'),
    clientProfile: refreshedAsset('/img/nail-art/v2/client-profile.webp'),
  },
  cta: {
    beautyNailsHomeCta01: refreshedAsset('/img/lp/beauty-nails-home-cta-01.webp'),
    beautyNailsClientsCta02: refreshedAsset('/img/lp/beauty-nails-clients-cta-02.webp'),
    beautyNailsPortrait03: refreshedAsset('/img/lp/beauty-nails-portrait-03.webp'),
    salonMomentQr04: refreshedAsset('/img/lp/salon-moment-qr-04.webp'),
    beautyNailsHomeCta03RedSilk: refreshedAsset('/img/lp/beauty-nails-home-cta-03-red-silk.webp'),
    beautyNailsClientsCta03Hands: refreshedAsset('/img/lp/beauty-nails-clients-cta-03-hands.webp'),
    beautyDiv04HandsJewelry: refreshedAsset('/img/lp/beauty-div-04-hands-jewelry.webp'),
    beautyDiv01WindowLight: refreshedAsset('/img/lp/beauty-div-01-window-light.webp'),
    beautyDiv02TwoHands: refreshedAsset('/img/lp/beauty-div-02-two-hands.webp'),
    beautyDiv03LedStilllife: refreshedAsset('/img/lp/beauty-div-03-led-stilllife.webp'),
  },
  process: {
    clientBeforeVisit: refreshedAsset('/img/lp/process/client-before-visit.svg'),
    stylistPortfolio: refreshedAsset('/img/lp/process/stylist-portfolio.svg'),
    clientConnection: refreshedAsset('/img/lp/process/client-connection.svg'),
  },
  contextual: {
    salonSharedGallery: refreshedAsset('/img/lp/contextual/salon-shared-gallery.svg'),
    home: refreshedAsset('/img/lp/contextual/home.svg'),
    clients: refreshedAsset('/img/lp/contextual/for-clients.svg'),
    stylists: refreshedAsset('/img/lp/contextual/for-stylists.svg'),
    pricing: refreshedAsset('/img/lp/contextual/pricing.svg'),
    contact: refreshedAsset('/img/lp/contextual/contact.svg'),
    getApp: refreshedAsset('/img/lp/contextual/get-app.svg'),
  },
  seo: BRAND_ASSETS,
} as const;
