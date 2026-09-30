export interface Env { DB: D1Database; MEDIA: R2Bucket; ADMIN_TOKEN?: string; }
export interface PollImageConfig { aspectRatio: string; min: number; max: number; cycle?: boolean; }
export interface PollOption { id: string; title: string; description?: string; images: string[]; }
export interface Poll { id: string; slug: string; title: string; instructions: string; minSelections: number; maxSelections: number; imageConfig: PollImageConfig; options: PollOption[]; }
export interface Screening { id: string; slug: string; title: string; venue?: string; bannerImage?: string; timezone: string; startAt: string; stopAt: string; polls: Poll[]; }
