import { readBallot } from "../ballot";
import { hashCode } from "../codes";
import type { Env } from "../types";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json<{ code?: string }>().catch(() => null);
  const code = body?.code?.trim() || "";
  if (!code) return Response.json({ error: "Enter your vote code." }, { status: 400 });
  const state = await readBallot(env, await hashCode(code));
  if (!state) return Response.json({ error: "That vote code isn't recognized. Check the code on your ticket and try again." }, { status: 403 });
  return Response.json(state, { headers: { "Cache-Control": "no-store" } });
};
