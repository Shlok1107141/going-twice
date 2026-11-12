// Auction type config: pure data (no server imports) so the admin UI, store, engine and Gus share it.
// Charity is the default hero; the others reuse the same hold-then-capture engine.
import type { AuctionSettings, AuctionType, EventInfo } from "./types";

export type SampleLot = {
  id: string;
  title: string;
  emoji: string;
  description: string;
  startPrice: number;
  increment: number;
  fmv?: number;
  /** estate: who is selling this lot (public label). */
  consignor?: string;
  /** farm: head count when sold as a pen. */
  unit?: "head" | "lot";
  quantity?: number;
};

export type GusHints = {
  /** Persona sentence, spliced into the Claude system prompt. */
  persona: string;
  /** Vocabulary hints for Claude. */
  vocabulary: string;
  /** Extra template lines per event; they replace the charity lines for that event.
   *  Placeholders: {lot} {name} {amount} {next} {consignor} {each} */
  lines: Partial<Record<"open" | "bid" | "going-once" | "going-twice" | "sold" | "close" | "stall", string[]>>;
};

export type AuctionTypeConfig = {
  type: AuctionType;
  label: string;
  icon: string;
  /** Header label on the stage. */
  stageLabel: string;
  blurb: string;
  /** Name of whoever is selling, for receipts and invoices (placeholder organizations). */
  orgName: string;
  /** Invoice business name. */
  invoicerName: string;
  softDescriptor: string;
  receiptKind: "donation" | "sale";
  /** Where the money goes. */
  payoutPlan: "organizer" | "consignment";
  payoutLabel: string;
  defaults: AuctionSettings & { increment: number };
  editable: { premium: boolean; commission: boolean; consignors: boolean };
  /** Key numbers for the admin cards. */
  keyNumbers: string[];
  gus: GusHints;
  lots: SampleLot[];
};

/** Default editable event details per auction type (placeholders; all editable in admin). */
export const EVENT_DEFAULTS: Record<AuctionType, EventInfo> = {
  charity: { name: "Spring Gala", organizer: "Maple Street Elementary PTA", beneficiary: "the school library fund", tagline: "An evening of giving", currency: "USD" },
  estate: { name: "Hendricks Estate Sale", organizer: "Lakeside Auction House", beneficiary: "the Hendricks estate and its consignors", tagline: "Fine furniture, silver and curiosities", currency: "USD" },
  collectibles: { name: "Riverside Art & Collectibles Auction", organizer: "Riverside Art & Collectibles Fair", beneficiary: "the house and its consignors", tagline: "Prints, records and ceramics", currency: "USD" },
  farm: { name: "Dry Creek Farm & Livestock Sale", organizer: "Dry Creek Sale Barn", beneficiary: "the seller", tagline: "Livestock, equipment and feed", currency: "USD" },
};

export function defaultEvent(t: AuctionType): EventInfo {
  return { ...EVENT_DEFAULTS[t] };
}

export const AUCTION_TYPES: Record<AuctionType, AuctionTypeConfig> = {
  charity: {
    type: "charity",
    label: "Charity gala",
    icon: "\u{1F3EB}",
    stageLabel: "Charity Auction",
    blurb: "School or nonprofit fundraiser. Donation receipts with fair market value; proceeds go to the organizer.",
    orgName: "Maple Street Elementary PTA (placeholder nonprofit)",
    invoicerName: "Maple Street Elementary PTA",
    softDescriptor: "GOINGTWICE PTA",
    receiptKind: "donation",
    payoutPlan: "organizer",
    payoutLabel: "100% to the organizer",
    defaults: { premiumPct: 0, commissionPct: 0, increment: 10 },
    editable: { premium: false, commission: false, consignors: false },
    keyNumbers: ["No premium", "Donation receipts + FMV", "100% to PTA"],
    gus: {
      persona: "the warm, funny, slightly over-caffeinated volunteer auctioneer at an elementary school charity gala",
      vocabulary: "school gala, PTA, library fund, bake sale, donated item",
      lines: {},
    },
    lots: [
      { id: "lot-principal", title: "Principal for a Day", emoji: "\u{1F393}", description: "Your child runs morning announcements, picks the lunch dessert, and gets the big chair.", startPrice: 50, increment: 10, fmv: 0 },
      { id: "lot-pizza", title: "Family Pizza Night Basket", emoji: "\u{1F355}", description: "Two large pizzas, a board game, and movie-night snacks from a local pizzeria.", startPrice: 40, increment: 5, fmv: 75 },
      { id: "lot-cabin", title: "Weekend Cabin Getaway", emoji: "\u{1F3D5}\u{FE0F}", description: "Two nights at a family's lakeside cabin. Sleeps six. Canoe included.", startPrice: 200, increment: 25, fmv: 450 },
      { id: "lot-quilt", title: "Signed Class Quilt", emoji: "\u{1F9F5}", description: "Hand-stitched by Room 4B, every square signed by a student.", startPrice: 75, increment: 10, fmv: 60 },
    ],
  },
  estate: {
    type: "estate",
    label: "Estate / consignment",
    icon: "\u{1F3FA}",
    stageLabel: "Estate Sale",
    blurb: "Each lot has a consignor. At close the consignor is paid the hammer minus the house commission; the house keeps the commission.",
    orgName: "Hendricks Estate Sales (placeholder auction house)",
    invoicerName: "Hendricks Estate Sales",
    softDescriptor: "GOINGTWICE ESTATE",
    receiptKind: "sale",
    payoutPlan: "consignment",
    payoutLabel: "Consignor paid hammer minus commission; house keeps commission",
    defaults: { premiumPct: 0, commissionPct: 15, increment: 25 },
    editable: { premium: true, commission: true, consignors: true },
    keyNumbers: ["15% house commission", "Split payout batch", "Sales receipts"],
    gus: {
      persona: "a seasoned, dry-witted estate auctioneer who respects provenance and loves a good story about where things came from",
      vocabulary: "estate, consignor, provenance, lot, hammer price, circa, patina, from the collection of",
      lines: {
        open: [
          "Lot up next, from {consignor}: {lot}. Starting at {amount}. Let's see some paddles.",
          "From {consignor}, we have {lot}. Who'll open me at {amount}?",
        ],
        bid: [
          "{amount} from {name}, for the piece from {consignor}. Do I hear {next}?",
          "{name} at {amount}. Fine taste, and it has the patina to prove it.",
        ],
        sold: [
          "Sold! {lot}, from {consignor}, to {name} for {amount}. The consignor will be paid out at close.",
          "Hammer's down at {amount}. {name} takes {lot}, and {consignor} will be pleased.",
        ],
        close: ["That concludes the sale. Winners are charged the hammer price, holds are released, and the consignors are paid out with the house commission split. Thank you all."],
      },
    },
    lots: [
      { id: "lot-sideboard", title: "Walnut Mid-Century Sideboard", emoji: "\u{1FA91}", description: "Circa 1962 walnut sideboard, sliding doors, original brass pulls. Light wear.", startPrice: 150, increment: 25, consignor: "the Hendricks estate" },
      { id: "lot-clock", title: "Seth Thomas Mantel Clock", emoji: "\u{1F570}\u{FE0F}", description: "Running 8-day mantel clock with its original key. Chimes on the half hour.", startPrice: 80, increment: 10, consignor: "the Hendricks estate" },
      { id: "lot-silver", title: "Sterling Flatware Service for 8", emoji: "\u{1F374}", description: "Forty-piece sterling set in a fitted chest, monogrammed H.", startPrice: 300, increment: 25, consignor: "the Alvarez family" },
      { id: "lot-rug", title: "Hand-Knotted Persian Runner", emoji: "\u{1F9F6}", description: "Wool runner, 2 ft 6 in by 10 ft, rich reds and indigo, minor edge fray.", startPrice: 200, increment: 25, consignor: "the Alvarez family" },
    ],
  },
  collectibles: {
    type: "collectibles",
    label: "Art & collectibles",
    icon: "\u{1F3A8}",
    stageLabel: "Art & Collectibles Auction",
    blurb: "Buyer's premium on top of the hammer. Your hold must cover hammer plus premium. Sales receipts, not donations.",
    orgName: "Riverside Art & Collectibles Fair (placeholder gallery)",
    invoicerName: "Riverside Art & Collectibles Fair",
    softDescriptor: "GOINGTWICE ART",
    receiptKind: "sale",
    payoutPlan: "organizer",
    payoutLabel: "Hammer plus premium to the house",
    defaults: { premiumPct: 10, commissionPct: 0, increment: 25 },
    editable: { premium: true, commission: false, consignors: false },
    keyNumbers: ["10% buyer's premium", "Hold covers hammer + premium", "Sales receipts"],
    gus: {
      persona: "a polished gallery auctioneer with a gentle sense of theater, who always reminds the room the buyer's premium is added to the hammer price",
      vocabulary: "hammer price, plus buyer's premium, provenance, edition, signed, condition report, lot",
      lines: {
        open: [
          "Lot up now: {lot}. Opening at {amount}, plus buyer's premium. Who'll start me?",
          "Presenting {lot}. We open at {amount}, plus buyer's premium.",
        ],
        bid: [
          "{amount} from {name}, plus buyer's premium. Do I hear {next}?",
          "{name} at {amount}. A discerning eye, and the premium is added at the hammer.",
        ],
        sold: [
          "Sold! {lot} to {name} at a hammer price of {amount}, plus buyer's premium.",
          "Hammer down at {amount} plus premium. {name}, congratulations on a fine acquisition.",
        ],
        close: ["The sale is concluded. Winners are charged hammer plus buyer's premium, every other hold is released. Thank you."],
      },
    },
    lots: [
      { id: "lot-print", title: "Signed Screenprint, Edition 12/50", emoji: "\u{1F5BC}\u{FE0F}", description: "Abstract screenprint in four colors, signed and numbered in pencil, framed.", startPrice: 200, increment: 25 },
      { id: "lot-vinyl", title: "First-Pressing Jazz LP, Sealed", emoji: "\u{1F4BF}", description: "Original 1959 mono pressing, factory sealed, sleeve in near-mint condition.", startPrice: 120, increment: 20 },
      { id: "lot-ceramic", title: "Studio Ceramic Vase", emoji: "\u{1F3FA}", description: "Wheel-thrown stoneware vase with a crackle glaze, signed on the base.", startPrice: 90, increment: 10 },
      { id: "lot-cards", title: "Graded Baseball Card, PSA 8", emoji: "\u{26BE}", description: "1975 rookie card in a graded slab, sharp corners, centered.", startPrice: 250, increment: 25 },
    ],
  },
  farm: {
    type: "farm",
    label: "Farm & livestock",
    icon: "\u{1F69C}",
    stageLabel: "Farm & Livestock Sale",
    blurb: "Livestock, equipment and feed, quoted per head or per lot, with bigger bid steps. Sales receipts; proceeds to the seller.",
    orgName: "Dry Creek Farm & Livestock Sale (placeholder sale barn)",
    invoicerName: "Dry Creek Farm & Livestock Sale",
    softDescriptor: "GOINGTWICE FARM",
    receiptKind: "sale",
    payoutPlan: "organizer",
    payoutLabel: "Proceeds to the seller",
    defaults: { premiumPct: 0, commissionPct: 0, increment: 100 },
    editable: { premium: true, commission: false, consignors: false },
    keyNumbers: ["Per head / per lot", "$100+ bid steps", "Sales receipts"],
    gus: {
      persona: "a fast-talking, friendly livestock-sale auctioneer with a country drawl who talks in per-head and per-lot terms",
      vocabulary: "per head, per lot, pen, head, heifers, bred cows, round bales, hammer, sold on the dollar",
      lines: {
        open: [
          "Next in the ring: {lot}. Start me at {amount}, I'm looking for a bid{each}.",
          "Here's {lot}. Who'll give me {amount}?",
        ],
        bid: [
          "{amount} from {name}{each}! Now {next}, now {next}, who'll give it?",
          "I have {amount}{each}, {name} is in. Do I hear {next}?",
        ],
        sold: [
          "Sold! {lot} to {name} at {amount}{each}.",
          "Sold on the dollar, {amount}{each}. {name}, she's yours.",
        ],
        close: ["That's the sale, folks. Buyers are charged what they won, the rest of the holds are released, and the seller is paid. Thanks for coming."],
      },
    },
    lots: [
      { id: "lot-heifers", title: "Pen of 6 Angus Heifers", emoji: "\u{1F404}", description: "Bred Angus heifers, vaccinated, due in the spring. One bid for the pen of six head.", startPrice: 3600, increment: 100, unit: "head", quantity: 6 },
      { id: "lot-tractor", title: "Kubota L3901 Tractor, 1,200 hrs", emoji: "\u{1F69C}", description: "4WD compact tractor with loader, serviced this year. Sold per lot.", startPrice: 14000, increment: 250, unit: "lot", quantity: 1 },
      { id: "lot-bales", title: "40 Round Bales Mixed Hay", emoji: "\u{1F33E}", description: "Net-wrapped round bales, stored under cover, tested feed grade. Sold per lot.", startPrice: 2000, increment: 100, unit: "lot", quantity: 40 },
      { id: "lot-goats", title: "Pair of Nubian Dairy Goats", emoji: "\u{1F410}", description: "Two registered Nubian does, bred, gentle with kids. One bid for the pair of head.", startPrice: 600, increment: 50, unit: "head", quantity: 2 },
    ],
  },
};

export const AUCTION_TYPE_LIST = Object.values(AUCTION_TYPES);
export const DEFAULT_AUCTION_TYPE: AuctionType = "charity";

export function isAuctionType(v: unknown): v is AuctionType {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(AUCTION_TYPES, v);
}

export function typeConfig(t: AuctionType | undefined): AuctionTypeConfig {
  return AUCTION_TYPES[t && isAuctionType(t) ? t : DEFAULT_AUCTION_TYPE];
}

export function defaultSettings(t: AuctionType): AuctionSettings {
  const d = AUCTION_TYPES[t].defaults;
  return { premiumPct: d.premiumPct, commissionPct: d.commissionPct };
}

/** Whole-cent premium on an amount in cents. Same rounding everywhere (hold check, capture, receipts). */
export function premiumCents(hammerCents: number, premiumPct: number): number {
  return Math.round((hammerCents * premiumPct) / 100);
}

/** Total owed by a buyer (cents) for a hammer total (cents). */
export function grossCents(hammerCents: number, premiumPct: number): number {
  return hammerCents + premiumCents(hammerCents, premiumPct);
}
