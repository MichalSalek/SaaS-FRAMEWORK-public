// asset-ownership-allow:
// Fixture standalone (bez importow): probki sa kopiowane do mini-projektu
// selftestu, a tsconfig testow i tak kompiluje ten katalog.
declare const DB_CLIENT: {
  use: { galleryRecord: { create: (a: unknown) => Promise<unknown> }; visitResultPhoto: { create: (a: unknown) => Promise<unknown> } };
};
declare const extractPublicIdFromUrl: (url: string) => string | null;

export const createThing_IO = async (accountId: string, publicId: string) =>
  DB_CLIENT.use.visitResultPhoto.create({
    data: { stylist_account_id: accountId, public_id: publicId },
  });
