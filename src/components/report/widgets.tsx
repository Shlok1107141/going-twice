"use client";

// Two custom AG Studio widgets for the Gala Report:
//   - "Money flow":   Held -> Captured / Released -> Paid out, drawn as a sankey-style ribbon diagram
//   - "Paddle board": per-paddle hold vs committed vs captured, with the PayPal status chip
// Both read their data through widgetApi.getData(), so page filters and cross-filters apply.

import { useEffect, useMemo, useRef, useState } from "react";
import { createWidgets } from "ag-studio-react";
import type {
  AgBaseRegistry,
  AgDefaultWidgetDefinition,
  AgWidgetFormParams,
  AgWidgetParams,
  AgWidgetsConfig,
  AgWidgetField,
} from "ag-studio";
import { galaFormatShape } from "./format-shape";

// --- palette (matches the Going Twice tokens in globals.css) ------------------------------------
const C = {
  ink: "#141413",
  muted: "#6b6a63",
  line: "#e5e2d8",
  held: "#c15f3c",
  captured: "#3f6b4e",
  released: "#8a8780",
  paid: "#141413",
  paper: "#ffffff",
};

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// --- registry types ------------------------------------------------------------------------------
type MoneyFlowDef = {
  dataMapping: { stage: AgWidgetField[]; amount: AgWidgetField[] };
  format?: Record<string, unknown>;
};
type PaddleBoardDef = {
  dataMapping: { paddle: AgWidgetField[]; status: AgWidgetField[]; hold: AgWidgetField[]; committed: AgWidgetField[]; captured: AgWidgetField[] };
  format?: Record<string, unknown>;
};
export interface GalaRegistry extends AgBaseRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  widgets: readonly (AgDefaultWidgetDefinition | any)[];
}

// --- data hook ----------------------------------------------------------------------------------
type Row = Record<string, unknown>;

/** Reads `fields` through the widget API and re-reads when Studio says the data changed. */
type LooseApi = {
  getData(
    q: { fields: AgWidgetField[] },
    o?: { queryId?: string; onDataUpdated?: (r: LooseResponse) => void },
  ): Promise<LooseResponse>;
};
type LooseResponse = { results?: { rows?: unknown[] }; replaced?: boolean };

function useRows(widgetApiIn: AgWidgetParams["widgetApi"], fields: AgWidgetField[], key: string): Row[] | null {
  const widgetApi = widgetApiIn as unknown as LooseApi;
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    let live = true;
    if (!fields.length) return;
    widgetApi
      .getData(
        { fields },
        {
          queryId: key,
          onDataUpdated: (r) => {
            if (live && r.results?.rows) setRows(r.results.rows as Row[]);
          },
        },
      )
      .then((r) => {
        if (!live || r.replaced) return;
        if (r.results?.rows) setRows(r.results.rows as Row[]);
      })
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
    // fields identity changes each render; the JSON key captures the actual selection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetApiIn, JSON.stringify(fields)]);
  return rows;
}

/** Value of a mapped field in a result row (rows are keyed by the resolved field's `key`). */
function pick(row: Row, field: AgWidgetField | undefined): unknown {
  if (!field) return undefined;
  const f = field as unknown as { key?: string; fieldId?: string };
  return (f.key && row[f.key]) ?? (f.fieldId ? row[f.fieldId] : undefined);
}
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

/** Pixel size of an element, kept current with a ResizeObserver. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 640, h: 300 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width > 0 && height > 0) setSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

// ================================================================================================
// Money flow
// ================================================================================================
function MoneyFlow({ dataMapping, widgetApi }: AgWidgetParams<never>) {
  const mapping = dataMapping as unknown as MoneyFlowDef["dataMapping"];
  const fields = useMemo(() => [...(mapping.stage ?? []), ...(mapping.amount ?? [])], [mapping]);
  const rows = useRows(widgetApi, fields, "flow");

  const t = { held: 0, captured: 0, released: 0, paid: 0 };
  for (const r of rows ?? []) {
    const stage = String(pick(r, mapping.stage?.[0]) ?? "");
    const v = num(pick(r, mapping.amount?.[0]));
    if (stage === "Held") t.held += v;
    else if (stage === "Captured") t.captured += v;
    else if (stage === "Released") t.released += v;
    else if (stage === "Paid out") t.paid += v;
  }
  const pending = Math.max(0, t.held - t.captured - t.released);
  const total = Math.max(t.held, t.captured + t.released + pending, 1);

  // geometry in real pixels, so text stays crisp at any widget size
  const [boxRef, box] = useSize<HTMLDivElement>();
  const W = box.w;
  const H = box.h;
  const top = 30;
  const bar = 16;
  const usable = Math.max(60, H - top - 12);
  const gap = Math.min(14, usable / 12);
  const k = (usable - gap * 2) / total; // px per dollar
  const x0 = 8;
  const x1 = Math.round(W * 0.43);
  const x2 = Math.max(x1 + bar + 80, W - bar - 8);

  const hH = t.held * k;
  const colX1 = [
    { key: "captured", v: t.captured, color: C.captured, label: "Captured" },
    { key: "released", v: t.released, color: C.released, label: "Released" },
    { key: "pending", v: pending, color: C.held, label: "Still on hold" },
  ].filter((n) => n.v > 0);

  let y = top;
  const mid = colX1.map((n) => {
    const h = n.v * k;
    const node = { ...n, y, h };
    y += h + gap;
    return node;
  });
  const cap = mid.find((n) => n.key === "captured");
  const paidH = t.paid * k;
  const paidY = cap ? cap.y : top;

  const ribbon = (xa: number, ya: number, xb: number, yb: number, h: number) => {
    const cx = (xa + xb) / 2;
    return `M${xa},${ya} C${cx},${ya} ${cx},${yb} ${xb},${yb} L${xb},${yb + h} C${cx},${yb + h} ${cx},${ya + h} ${xa},${ya + h} Z`;
  };

  if (rows && t.held + t.captured + t.released + t.paid === 0) {
    return <Empty text="No money has moved yet." />;
  }

  // running offset inside the Held node
  let off = top;
  const heldOut = mid.map((n) => {
    const o = off;
    off += n.v * k;
    return o;
  });

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", fontFamily: "var(--font-ui), system-ui, sans-serif" }}>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", padding: "2px 4px 0" }}>
        <Kpi label="Held" value={t.held} color={C.held} />
        <Kpi label="Captured" value={t.captured} color={C.captured} />
        <Kpi label="Released" value={t.released} color={C.released} />
        <Kpi label="Paid out" value={t.paid} color={C.paid} />
      </div>
      <div ref={boxRef} style={{ flex: 1, minHeight: 0, width: "100%" }}>
      <svg width={W} height={H} style={{ display: "block" }} role="img" aria-label="Money flow from held to captured, released and paid out">
        <defs>
          <linearGradient id="gt-g-cap" x1="0" x2="1"><stop offset="0" stopColor={C.held} stopOpacity=".7" /><stop offset="1" stopColor={C.captured} stopOpacity=".7" /></linearGradient>
          <linearGradient id="gt-g-rel" x1="0" x2="1"><stop offset="0" stopColor={C.held} stopOpacity=".45" /><stop offset="1" stopColor={C.released} stopOpacity=".5" /></linearGradient>
          <linearGradient id="gt-g-pend" x1="0" x2="1"><stop offset="0" stopColor={C.held} stopOpacity=".5" /><stop offset="1" stopColor={C.held} stopOpacity=".25" /></linearGradient>
          <linearGradient id="gt-g-paid" x1="0" x2="1"><stop offset="0" stopColor={C.captured} stopOpacity=".55" /><stop offset="1" stopColor={C.paid} stopOpacity=".7" /></linearGradient>
        </defs>
        {/* column captions */}
        {[["HOLDS PLACED", x0, "start"], ["OUTCOME", x1, "start"], ["TO THE PTA", x2 + bar, "end"]].map(([l, x, a]) => (
          <text key={l as string} x={x as number} y={18} textAnchor={a as "start" | "end"} fontSize="10.5" letterSpacing="1.6" fill={C.muted} fontWeight="600">{l}</text>
        ))}
        {/* held -> outcome ribbons */}
        {mid.map((n, i) => (
          <path key={n.key} d={ribbon(x0 + bar, heldOut[i], x1, n.y, n.h)} fill={`url(#gt-g-${n.key === "captured" ? "cap" : n.key === "released" ? "rel" : "pend"})`} />
        ))}
        {/* captured -> paid out */}
        {cap && t.paid > 0 && <path d={ribbon(x1 + bar, cap.y, x2, paidY, paidH)} fill="url(#gt-g-paid)" />}
        {/* nodes */}
        {t.held > 0 && <Node x={x0} y={top} w={bar} h={hH} color={C.held} label="Held" amount={t.held} side="right" />}
        {mid.map((n) => (
          <Node key={n.key} x={x1} y={n.y} w={bar} h={n.h} color={n.color} label={n.label} amount={n.v} side="right" />
        ))}
        {t.paid > 0 && <Node x={x2} y={paidY} w={bar} h={paidH} color={C.paid} label="Paid out" amount={t.paid} side="left" />}
      </svg>
      </div>
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: "inline-block" }} />
      <span style={{ fontSize: 11.5, color: C.muted, letterSpacing: ".04em", textTransform: "uppercase" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-display), Georgia, serif", fontWeight: 600, fontSize: 20, color: C.ink, fontVariantNumeric: "lining-nums tabular-nums" }}>{money(value)}</span>
    </div>
  );
}

function Node({ x, y, w, h, color, label, amount, side }: { x: number; y: number; w: number; h: number; color: string; label: string; amount: number; side: "left" | "right" }) {
  const hh = Math.max(h, 3);
  const tx = side === "right" ? x + w + 8 : x - 8;
  const anchor = side === "right" ? "start" : "end";
  return (
    <g>
      <rect x={x} y={y} width={w} height={hh} rx={3} fill={color} />
      <text x={tx} y={y + hh / 2 - 2} textAnchor={anchor} fontSize="12.5" fontWeight="600" fill={C.ink} stroke="#fffdf8" strokeWidth="3" paintOrder="stroke">{label}</text>
      <text x={tx} y={y + hh / 2 + 14} textAnchor={anchor} fontSize="16" fontWeight="600" fill={color} stroke="#ffffff" strokeWidth="3" paintOrder="stroke" style={{ fontFamily: "var(--font-display), Georgia, serif", fontVariantNumeric: "lining-nums tabular-nums" }}>{money(amount)}</text>
    </g>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center", color: C.muted, fontSize: 13 }}>{text}</div>
  );
}

// ================================================================================================
// Paddle board
// ================================================================================================
const CHIP: Record<string, { bg: string; fg: string; label: string }> = {
  held: { bg: "#e8ebf4", fg: "#4b5a8c", label: "AUTH HELD" },
  captured: { bg: "#e5eee7", fg: "#3f6b4e", label: "CAPTURED" },
  voided: { bg: "#f2f0e8", fg: "#6b6a63", label: "RELEASED" },
  pending: { bg: "#f6e7de", fg: "#a9512f", label: "PENDING" },
};

function PaddleBoard({ dataMapping, widgetApi }: AgWidgetParams<never>) {
  const m = dataMapping as unknown as PaddleBoardDef["dataMapping"];
  const fields = useMemo(
    () => [...(m.paddle ?? []), ...(m.status ?? []), ...(m.hold ?? []), ...(m.committed ?? []), ...(m.captured ?? [])],
    [m],
  );
  const rows = useRows(widgetApi, fields, "paddles");

  const list = (rows ?? [])
    .map((r) => ({
      name: String(pick(r, m.paddle?.[0]) ?? ""),
      status: String(pick(r, m.status?.[0]) ?? "held").toLowerCase(),
      hold: num(pick(r, m.hold?.[0])),
      committed: num(pick(r, m.committed?.[0])),
      captured: num(pick(r, m.captured?.[0])),
    }))
    .filter((p) => p.name)
    .sort((a, b) => b.hold - a.hold);
  const max = Math.max(1, ...list.map((p) => p.hold));

  if (rows && !list.length) return <Empty text="No paddles yet." />;

  return (
    <div style={{ height: "100%", overflow: "auto", fontFamily: "var(--font-ui), system-ui, sans-serif", padding: "2px 4px" }}>
      <div style={{ display: "flex", gap: 14, fontSize: 11, color: C.muted, margin: "0 0 8px", letterSpacing: ".04em", textTransform: "uppercase" }}>
        <Legend color="#e7e0d2" label="Hold" />
        <Legend color={C.held} label="Committed" />
        <Legend color={C.captured} label="Captured" />
      </div>
      {list.map((p) => {
        const chip = CHIP[p.status] ?? CHIP.pending;
        const w = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
        return (
          <div key={p.name} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 1.2fr) 3fr 118px", alignItems: "center", gap: 12, padding: "7px 0", borderBottom: `1px solid ${C.line}` }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
              <span style={{ display: "inline-block", marginTop: 3, padding: "1px 7px", borderRadius: 999, background: chip.bg, color: chip.fg, fontSize: 9.5, fontWeight: 700, letterSpacing: ".08em" }}>{chip.label}</span>
            </div>
            <div style={{ position: "relative", height: 22, background: "#f1ece0", borderRadius: 6, overflow: "hidden" }} title={`Hold ${money(p.hold)} / committed ${money(p.committed)} / captured ${money(p.captured)}`}>
              <div style={{ position: "absolute", inset: 0, width: w(p.hold), background: "#e7e0d2", borderRadius: 6 }} />
              <div style={{ position: "absolute", top: 5, height: 12, left: 0, width: w(p.committed), background: C.held, borderRadius: 4, opacity: 0.9 }} />
              <div style={{ position: "absolute", top: 8, height: 6, left: 0, width: w(p.captured), background: C.captured, borderRadius: 3 }} />
            </div>
            <div style={{ textAlign: "right", fontSize: 12, color: C.muted, lineHeight: 1.25, whiteSpace: "nowrap" }}>
              <div><b style={{ color: C.ink }}>{money(p.captured)}</b> of {money(p.hold)}</div>
              {p.committed > 0 && <div style={{ color: C.held }}>{money(p.committed)} committed</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: "inline-block" }} />
      {label}
    </span>
  );
}

// ================================================================================================
// Registration
// ================================================================================================
const svgIcon = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">${inner}</svg>`;
const FLOW_ICON = svgIcon(
  `<rect x="2" y="5" width="5" height="22" rx="1.5" fill="#c15f3c"/><path d="M7 7C16 7 16 6 25 6V16C16 16 16 17 7 17Z" fill="#3f6b4e" opacity=".6"/><path d="M7 19C16 19 16 21 25 21V26C16 26 16 25 7 25Z" fill="#8a8780" opacity=".7"/><rect x="25" y="6" width="5" height="10" rx="1.5" fill="#3f6b4e"/><rect x="25" y="21" width="5" height="5" rx="1.5" fill="#8a8780"/>`,
);
const BOARD_ICON = svgIcon(
  `<rect x="3" y="5" width="26" height="6" rx="3" fill="#e5e2d8"/><rect x="3" y="5" width="18" height="6" rx="3" fill="#c15f3c"/><rect x="3" y="14" width="26" height="6" rx="3" fill="#e5e2d8"/><rect x="3" y="14" width="22" height="6" rx="3" fill="#3f6b4e"/><rect x="3" y="23" width="26" height="6" rx="3" fill="#e5e2d8"/><rect x="3" y="23" width="9" height="6" rx="3" fill="#8a8780"/>`,
);

/** The widgets config for <AgStudio widgets={...}>. */
export function createGalaWidgets() {
  return (base: AgWidgetsConfig<GalaRegistry>) =>
    createWidgets<GalaRegistry>({
      additionalTypes: [
        {
          id: "money-flow",
          label: "Money flow",
          icon: FLOW_ICON,
          dataMapping: {
            stage: {
              type: "field",
              supportedRoles: ["category"],
              requires: { cardinality: "many" },
              required: true,
              aiDescription: "Money stage of each ledger row: the text field 'ledger.stage' (Held, Captured, Released, Paid out).",
            },
            amount: {
              type: "field",
              supportedRoles: ["numeric"],
              requires: { per: "dataMapping.stage", cardinality: "one" },
              required: true,
              aiDescription: "Dollar amount, summed per stage: 'ledger.amount' with aggregation sum.",
            },
          },
          formatShape: galaFormatShape,
          form: (params: AgWidgetFormParams<MoneyFlowDef>) =>
            params.createDefaults({
              dataMappingItems: [
                { key: "stage", label: "Stage" },
                { key: "amount", label: "Amount" },
              ],
            }),
          comp: MoneyFlow,
          defaultSize: { width: 640, height: 380 },
          minSize: { width: 360, height: 240 },
          ai: {
            label: "Money flow",
            description: "A sankey-style diagram of how PayPal holds became money: Held splits into Captured and Released, and Captured flows to Paid out.",
            usage: "Use for the money story of the gala: where the held dollars ended up. Map ledger.stage and ledger.amount (sum). Always prefer this over a plain chart for questions about held vs captured vs released vs paid out.",
            configuration: "dataMapping.stage = [{id:'ledger.stage'}], dataMapping.amount = [{id:'ledger.amount', aggregation:'sum'}].",
          },
        },
        {
          id: "paddle-board",
          label: "Paddle board",
          icon: BOARD_ICON,
          dataMapping: {
            paddle: {
              type: "field",
              supportedRoles: ["category"],
              requires: { cardinality: "many" },
              required: true,
              aiDescription: "Bidder paddle label: 'paddles.paddle'.",
            },
            status: {
              type: "field",
              supportedRoles: ["category"],
              requires: { per: "dataMapping.paddle", cardinality: "one" },
              aiDescription: "PayPal hold status of the paddle: 'paddles.status' (held, captured, voided, pending).",
            },
            hold: { type: "field", supportedRoles: ["numeric"], requires: { per: "dataMapping.paddle", cardinality: "one" }, required: true, aiDescription: "The PayPal authorization hold: 'paddles.hold' sum." },
            committed: { type: "field", supportedRoles: ["numeric"], requires: { per: "dataMapping.paddle", cardinality: "one" }, aiDescription: "Sum of current winning bids not yet captured: 'paddles.committed' sum." },
            captured: { type: "field", supportedRoles: ["numeric"], requires: { per: "dataMapping.paddle", cardinality: "one" }, aiDescription: "Amount actually captured: 'paddles.captured' sum." },
          },
          formatShape: galaFormatShape,
          form: (params: AgWidgetFormParams<PaddleBoardDef>) =>
            params.createDefaults({
              dataMappingItems: [
                { key: "paddle", label: "Paddle" },
                { key: "status", label: "Hold status" },
                { key: "hold", label: "Hold" },
                { key: "committed", label: "Committed" },
                { key: "captured", label: "Captured" },
              ],
            }),
          comp: PaddleBoard,
          defaultSize: { width: 640, height: 380 },
          minSize: { width: 360, height: 200 },
          ai: {
            label: "Paddle board",
            description: "One row per bidder paddle with bars for hold vs committed vs captured and a PayPal status chip.",
            usage: "Use to compare what each bidder had on hold with what they committed and what was captured. Map paddles.paddle, paddles.status, and sums of paddles.hold, paddles.committed, paddles.captured.",
            configuration: "dataMapping.paddle=[{id:'paddles.paddle'}], status=[{id:'paddles.status'}], hold/committed/captured=[{id:'paddles.<f>', aggregation:'sum'}].",
          },
        },
      ],
      menu: [{ label: "Gala", widgetIds: ["money-flow", "paddle-board"] }, ...base.menu],
    });
}
