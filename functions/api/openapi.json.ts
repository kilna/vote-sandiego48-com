import { error, json } from "./http";
import { openapiDocument } from "./schema";

export const onRequest: PagesFunction = async ({ request }) => {
  if (request.method === "GET") return json(openapiDocument());
  return error(405, "Method not allowed.", { allow: ["GET"] }, { Allow: "GET" });
};
