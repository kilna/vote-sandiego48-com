import { assetUrl } from "../assets";
import { votingMode, votingOpen } from "../voting";

export type EventRow = {
  id: string;
  slug: string;
  title: string;
  venue: string | null;
  banner_image_key: string | null;
  timezone: string;
  start_at: string;
  stop_at: string;
  voting?: string | null;
};

export type PollRow = {
  id: string;
  event_id: string;
  slug: string;
  title: string;
  instructions: string | null;
  min_selections: number;
  max_selections: number;
  image_config: string;
  sort_order: number;
  voting?: string | null;
  start_at?: string | null;
  stop_at?: string | null;
};

export type OptionRow = {
  id: string;
  poll_id: string;
  title: string;
  description: string | null;
  image_keys: string;
  sort_order: number;
};

export type ImageConfig = { aspectRatio: string; cycle: number; zoomable: boolean };

export const imageCycleMin = 1;
export const imageCycleMax = 60;
export const imageCycleDefault = 2;

export function imageCycleSeconds(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= imageCycleMin && value <= imageCycleMax ? value : imageCycleDefault;
}

export function parseKeys(raw: string | null) {
  try {
    const value = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function parseImageConfig(raw: string | null): ImageConfig {
  try {
    const value = JSON.parse(raw || "{}") as Partial<ImageConfig> | null;
    if (value && typeof value === "object" && typeof value.aspectRatio === "string") {
      return { aspectRatio: value.aspectRatio, cycle: imageCycleSeconds(value.cycle), zoomable: value.zoomable === true };
    }
  } catch {
    /* Fall through to the ballot default. */
  }
  return { aspectRatio: "16:9", cycle: imageCycleDefault, zoomable: false };
}

export function presentOption(row: OptionRow) {
  const imageKeys = parseKeys(row.image_keys);
  return {
    id: row.id,
    pollId: row.poll_id,
    title: row.title,
    description: row.description,
    imageKeys,
    images: imageKeys.map(assetUrl),
    sortOrder: row.sort_order,
  };
}

export function presentPoll(screeningSlug: string, row: PollRow, options: ReturnType<typeof presentOption>[]) {
  const slug = encodeURIComponent(screeningSlug);
  const pollSlug = encodeURIComponent(row.slug);
  const startAt = row.start_at || "";
  const stopAt = row.stop_at || "";
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    instructions: row.instructions,
    minSelections: row.min_selections,
    maxSelections: row.max_selections,
    imageConfig: parseImageConfig(row.image_config),
    sortOrder: row.sort_order,
    startAt,
    stopAt,
    voting: votingMode(row.voting),
    votingOpen: Boolean(startAt && stopAt && votingOpen(startAt, stopAt)),
    options,
    links: {
      self: `/api/admin/events/${slug}/polls/${pollSlug}`,
      options: `/api/admin/events/${slug}/polls/${pollSlug}/options`,
    },
  };
}

export function presentEventSummary(row: EventRow) {
  const slug = encodeURIComponent(row.slug);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    venue: row.venue,
    timezone: row.timezone,
    startAt: row.start_at,
    stopAt: row.stop_at,
    bannerImageKey: row.banner_image_key,
    bannerImage: row.banner_image_key ? assetUrl(row.banner_image_key) : null,
    links: {
      self: `/api/admin/events/${slug}`,
      polls: `/api/admin/events/${slug}/polls`,
      images: `/api/admin/events/${slug}/images`,
      codes: `/api/admin/events/${slug}/codes`,
      public: `/api/events/${slug}`,
      ballot: `/s/${slug}`,
    },
  };
}

export function presentEvent(row: EventRow, polls: ReturnType<typeof presentPoll>[]) {
  return { ...presentEventSummary(row), polls };
}
