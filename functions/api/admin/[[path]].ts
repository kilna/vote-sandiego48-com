import { handleAdmin } from "../../admin/routes";
import { error } from "../http";
import type { Env } from "../../types";

export const onRequest: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const raw = (params as { path?: string | string[] }).path;
    const parts = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((part) => {
      try { return decodeURIComponent(part); } catch { return part; }
    }).filter(Boolean);
    return await handleAdmin(request, env, parts);
  } catch (err) {
    console.error(err);
    return error(500, "The admin API failed before completing the request.");
  }
};
