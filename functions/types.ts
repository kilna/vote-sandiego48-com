export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ACCESS_DEV_BYPASS?: string;
}
export interface PollImageConfig { aspectRatio: string; cycle: number; zoomable: boolean; }
export interface PollOption { id: string; title: string; description?: string; images: string[]; }
export interface Poll { id: string; slug: string; title: string; instructions: string; minSelections: number; maxSelections: number; imageConfig: PollImageConfig; startAt: string; stopAt: string; voting: "scheduled" | "open" | "closed"; votingOpen: boolean; options: PollOption[]; }
export interface Event { id: string; slug: string; title: string; venue?: string; bannerImage?: string; timezone: string; startAt: string; stopAt: string; polls: Poll[]; }
