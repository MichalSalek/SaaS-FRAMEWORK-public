export type CloudinaryType = {
  asset_id: string;
  public_id: string;
  secure_url: string;
  // Present only when the provider-side upload configuration returns a token; we do
  // NOT send `return_delete_token` as a request parameter (see the DECISION in
  // `domain/gallery/galleryIO.possibilities.api.ts`). Authorises a single client-side
  // `delete_by_token` (valid ~10 min after the upload).
  delete_token?: string;
};
