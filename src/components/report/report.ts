// The built-in "Gala report": two pages of widgets over the data sources in ./data.ts.

import type { AgReportState, AgWidgetLayoutState } from "ag-studio";
import type { GalaRegistry } from "./widgets";

const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text: string, subtitle?: string) => ({
  title: { enabled: true, text },
  ...(subtitle && { subtitle: { enabled: true, text: subtitle } }),
});
const sum = (id: string) => ({ id, aggregation: "sum" as const });
const avg = (id: string) => ({ id, aggregation: "avg" as const });

const kpi = (text: string, value: { id: string; aggregation?: "sum" | "avg" }) => ({
  type: "value" as const,
  dataMapping: { value: [value] },
  format: { title: { enabled: true, text } },
});

const overview = {
  id: "overview",
  widgets: {
    "kpi-raised": kpi("Raised (hammer prices)", sum("lots.finalPrice")),
    "kpi-donation": kpi("Above-estimate donation", sum("lots.aboveFmv")),
    "kpi-bids": kpi("Bids placed", sum("lots.bids")),
    "kpi-speed": kpi("Avg seconds to sold", avg("lots.secondsToSold")),
    flow: {
      type: "money-flow",
      dataMapping: { stage: [{ id: "ledger.stage" }], amount: [sum("ledger.amount")] },
      format: title("Where the money went", "PayPal holds to captures, releases and payout"),
    },
    board: {
      type: "paddle-board",
      dataMapping: {
        paddle: [{ id: "paddles.paddle" }],
        status: [{ id: "paddles.status" }],
        hold: [sum("paddles.hold")],
        committed: [sum("paddles.committed")],
        captured: [sum("paddles.captured")],
      },
      format: title("Paddle board", "Hold vs committed vs captured, per bidder"),
    },
    "price-vs-fmv": {
      type: "column-chart-grouped",
      dataMapping: {
        categoryKey: [{ id: "lots.title" }],
        valueKey: [sum("lots.finalPrice"), sum("lots.fmv")],
      },
      format: {
        ...title("Hammer price vs estimated value", "Anything above the estimate is donation"),
        style: { theme: { common: { legend: { enabled: true } } } },
      },
    },
    lots: {
      type: "grid",
      dataMapping: {
        cols: [
          { id: "lots.title" },
          { id: "lots.winner" },
          { id: "lots.beatFmv" },
          sum("lots.finalPrice"),
          sum("lots.fmv"),
          sum("lots.aboveFmv"),
          sum("lots.bids"),
          sum("lots.secondsToSold"),
        ],
      },
      sort: [{ field: sum("lots.finalPrice"), direction: "desc" }],
      format: title("Lots"),
    },
  },
  widgetLayout: {
    "kpi-raised": at(0, 0, 6, 6),
    "kpi-donation": at(6, 0, 6, 6),
    "kpi-bids": at(12, 0, 6, 6),
    "kpi-speed": at(18, 0, 6, 6),
    flow: at(0, 6, 14, 22),
    board: at(14, 6, 10, 22),
    "price-vs-fmv": at(0, 28, 12, 19),
    lots: at(12, 28, 12, 19),
  },
};

const ledger = {
  id: "ledger",
  widgets: {
    "ledger-grid": {
      type: "grid",
      dataMapping: {
        cols: [
          { id: "ledger.ts" },
          { id: "ledger.stage" },
          { id: "ledger.paddle" },
          { id: "ledger.paypalId" },
          { id: "ledger.status" },
          sum("ledger.amount"),
        ],
      },
      sort: [{ field: { id: "ledger.ts" }, direction: "asc" }],
      format: title("PayPal ledger", "Every authorization, capture, release and payout"),
    },
    "events-by-type": {
      type: "bar-chart-grouped",
      dataMapping: { categoryKey: [{ id: "events.type" }], valueKey: [sum("events.count")] },
      format: title("Auction events by type"),
    },
    "events-grid": {
      type: "grid",
      dataMapping: {
        cols: [{ id: "events.ts" }, { id: "events.type" }, { id: "events.lot" }, { id: "events.paddle" }, { id: "events.text" }],
      },
      sort: [{ field: { id: "events.ts" }, direction: "desc" }],
      format: title("Bids and events"),
    },
  },
  widgetLayout: {
    "ledger-grid": at(0, 0, 24, 20),
    "events-by-type": at(0, 20, 9, 20),
    "events-grid": at(9, 20, 15, 20),
  },
};

export const PAGE_TITLES: Record<string, string> = { overview: "Overview", ledger: "Ledger and bids" };

// Custom widget types ("money-flow", "paddle-board") sit outside the default registry's literal
// types, hence the cast.
export const galaReport = (): AgReportState<GalaRegistry> =>
  ({
    pages: [overview, ledger],
    selectedPageId: "overview",
    panels: { filters: { collapsed: true }, data: { collapsed: true } },
  }) as unknown as AgReportState<GalaRegistry>;
