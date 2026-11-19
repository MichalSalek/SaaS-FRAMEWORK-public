import type { NextApiRequest, NextApiResponse } from 'next';

import { serveDevFilm } from '../../../../application/dev-films/dev-films.server';

export const config = { api: { responseLimit: false } };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  await serveDevFilm(req, res, req.query.asset);
}
