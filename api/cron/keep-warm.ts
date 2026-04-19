import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(
  _req: VercelRequest,
  res: VercelResponse,
) {
  const apiUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}/api/pricing/models`
    : "https://observe.tansohq.com/api/pricing/models";

  try {
    const response = await fetch(apiUrl);
    res.json({ ok: true, status: response.status });
  } catch {
    res.json({ ok: false });
  }
}
