import type { Env, Screening } from "../../types";
export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const slug = String(params.slug || "");
  const screening = await env.DB.prepare("SELECT * FROM screenings WHERE slug = ?").bind(slug).first<any>();
  if (!screening) return Response.json({ error: "Screening not found" }, { status: 404 });
  const polls = await env.DB.prepare("SELECT * FROM polls WHERE screening_id = ? ORDER BY sort_order, title").bind(screening.id).all<any>();
  const result: Screening = { id: screening.id, slug: screening.slug, title: screening.title, venue: screening.venue || undefined, bannerImage: screening.banner_image_key ? `/api/assets/${encodeURIComponent(screening.banner_image_key)}` : undefined, timezone: screening.timezone, startAt: screening.start_at, stopAt: screening.stop_at, polls: [] };
  for (const p of polls.results) {
    const options = await env.DB.prepare("SELECT * FROM options WHERE poll_id = ? ORDER BY sort_order, title").bind(p.id).all<any>();
    result.polls.push({ id: p.id, slug: p.slug, title: p.title, instructions: p.instructions || "", minSelections: p.min_selections, maxSelections: p.max_selections, imageConfig: JSON.parse(p.image_config || "{}"), options: options.results.map((o: any) => ({ id: o.id, title: o.title, description: o.description || undefined, images: JSON.parse(o.image_keys || "[]").map((key: string) => `/api/assets/${encodeURIComponent(key)}`) })) });
  }
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
};
