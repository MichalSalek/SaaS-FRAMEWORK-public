export type CloudinaryType = {
  asset_id: string;
  public_id: string;
  secure_url: string;
  // Obecny tylko wtedy, gdy konfiguracja uploadu u dostawcy zwraca token; nie
  // wysyłamy `return_delete_token` jako parametru requestu (DECISION w
  // galleryIO). Autoryzuje pojedynczy client-side `delete_by_token` (ważny
  // ~10 min po uploadzie).
  delete_token?: string;
};
