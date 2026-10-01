import { error, json } from "./http";
import { publicIndex } from "./schema";

export const onRequest: PagesFunction = async ({ request }) => {
  if (request.method === "GET") return json(publicIndex());
  return error(405, "Method not allowed.", { allow: ["GET"] }, { Allow: "GET" });
};
