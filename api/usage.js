import { getUsage } from './_usage.js';

export default async function handler(req, res) {
  res.status(200).json(getUsage());
}
