// Editable event details and lot CRUD (additive; keeps engine.ts untouched apart from reading state.event).
import { getState, nextId, pushEvent, save } from "./store";
import { EngineError } from "./engine";
import type { EventInfo, Lot } from "./types";

/** Plain text only: no angle brackets or control characters; collapsed whitespace. UI also renders as text. */
export function cleanText(v: unknown, max: number, multiline = false): string | null {
  if (typeof v !== "string") return null;
  let t = v.replace(multiline ? /[\u0000-\u0009\u000b-\u001f\u007f<>]/g : /[\u0000-\u001f\u007f<>]/g, "");
  t = multiline ? t.trim() : t.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : null;
}

function field(input: Record<string, unknown>, key: string, max: number, required: boolean, multiline = false): string | undefined {
  if (input[key] === undefined) return undefined;
  const t = cleanText(input[key], max, multiline);
  if (t === null) throw new EngineError(400, `${key} must be text up to ${max} characters`);
  if (required && !t) throw new EngineError(400, `${key} cannot be empty`);
  return t;
}

function money(input: Record<string, unknown>, key: string, min: number, max: number): number | undefined {
  const v = input[key];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new EngineError(400, `${key} must be a number from ${min} to ${max}`);
  return Math.round(v * 100) / 100;
}

export function updateEvent(input: Record<string, unknown>): EventInfo {
  const s = getState();
  const name = field(input, "name", 80, true);
  const organizer = field(input, "organizer", 80, true);
  const beneficiary = field(input, "beneficiary", 100, true);
  const tagline = field(input, "tagline", 120, false);
  if (input.currency !== undefined && input.currency !== "USD") throw new EngineError(400, "currency must be USD");
  s.event = {
    ...s.event,
    ...(name !== undefined ? { name } : {}),
    ...(organizer !== undefined ? { organizer } : {}),
    ...(beneficiary !== undefined ? { beneficiary } : {}),
    currency: "USD",
  };
  if (tagline !== undefined) {
    if (tagline) s.event.tagline = tagline;
    else delete s.event.tagline;
  }
  save();
  return s.event;
}

function lotById(id: string): Lot {
  const lot = getState().lots.find((l) => l.id === id);
  if (!lot) throw new EngineError(404, "Unknown lot");
  return lot;
}

export function createBlankLot(): Lot {
  const s = getState();
  if (s.status === "closed") throw new EngineError(409, "Auction is closed");
  if (s.lots.length >= 60) throw new EngineError(409, "Too many lots (60 max)");
  const lot: Lot = {
    id: nextId("lot"),
    title: "New lot",
    description: "",
    emoji: "\u{1F381}",
    startPrice: 10,
    increment: 5,
    status: "pending",
    highBid: 0,
    phase: "bidding",
    fmv: 0,
  };
  s.lots.push(lot);
  save();
  return lot;
}

export function patchLot(id: string, input: Record<string, unknown>): Lot {
  const lot = lotById(id);
  if (lot.status !== "pending") throw new EngineError(409, "Only lots that have not started can be edited");
  const title = field(input, "title", 120, true);
  const description = field(input, "description", 600, false, true);
  const emoji = field(input, "emoji", 8, false);
  const startPrice = money(input, "startPrice", 1, 100_000);
  const increment = money(input, "increment", 1, 10_000);
  const fmv = money(input, "fmv", 0, 1_000_000);
  let image: string | null | undefined;
  if (input.image !== undefined) {
    if (input.image === null || input.image === "") image = null;
    else if (typeof input.image === "string" && input.image.length <= 200_000 && /^(data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$|https:\/\/[^\s<>"']+$)/.test(input.image)) image = input.image;
    else throw new EngineError(400, "image must be an https URL or a small jpeg/png/webp data URL");
  }
  if (title !== undefined) lot.title = title;
  if (description !== undefined) lot.description = description;
  if (emoji !== undefined) lot.emoji = emoji || "\u{1F381}";
  if (startPrice !== undefined) lot.startPrice = startPrice;
  if (increment !== undefined) lot.increment = increment;
  if (fmv !== undefined) lot.fmv = fmv;
  if (image === null) delete lot.image;
  else if (image) lot.image = image;
  save();
  return lot;
}

export function removeLot(id: string): void {
  const s = getState();
  const lot = lotById(id);
  if (lot.status !== "pending" || s.currentLotId === id) throw new EngineError(409, "Only lots that have not started can be removed");
  s.lots = s.lots.filter((l) => l.id !== id);
  pushEvent({ type: "system", text: `Lot removed: ${lot.title}.` });
  save();
}
