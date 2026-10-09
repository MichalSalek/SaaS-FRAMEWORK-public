// Fixture standalone (bez importow): probki sa kopiowane do mini-projektu
// selftestu, a tsconfig testow i tak kompiluje ten katalog.
declare const DB_CLIENT: {
  use: { galleryRecord: { create: (a: unknown) => Promise<unknown> }; visitResultPhoto: { create: (a: unknown) => Promise<unknown> } };
};
declare const extractPublicIdFromUrl: (url: string) => string | null;

export const createThing_IO = async (accountId: string, asset_url: string) =>
  DB_CLIENT.use.galleryRecord.create({
    data: {
      created_by_account_id: accountId,
      asset_url,
      public_id: extractPublicIdFromUrl(asset_url),
    },
  });
