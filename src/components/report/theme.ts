// AG Studio theme for the Gala Report: cream paper, stone borders, amber accent, Playfair headings
// (the same palette and --font-display as the rest of Going Twice).

import { studioTheme } from "ag-studio";

const SERIF = "var(--font-display), Georgia, serif";
const SANS = "var(--font-geist-sans), system-ui, sans-serif";
const INK = "#1c1917";
const MUTED = "#78716c";
const LINE = "#e7e0d2";
const AMBER = "#b45309";
const line = { width: 1, color: LINE };
const PALETTE = ["#d97706", "#15803d", "#a8a29e", "#92400e", "#0f766e", "#b91c1c", "#78716c", "#ca8a04", "#4d7c0f", "#57534e"];
const palette = Object.fromEntries(
  PALETTE.flatMap((c, i) => [
    [`chartPaletteFills${i + 1}Color`, c],
    [`chartPaletteStrokes${i + 1}Color`, c],
  ]),
);

export const galaTheme = studioTheme.withParams({
  fontFamily: SANS,
  fontSize: 14,
  textColor: INK,
  foregroundColor: INK,
  subtleTextColor: MUTED,
  backgroundColor: "#fffdf8",
  borderColor: LINE,
  accentColor: AMBER,
  iconColor: "#57534e",
  rowHoverColor: "#fef3c7",

  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: "transparent",
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: "transparent",
  studioCanvasPadding: 12,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: SANS,

  studioWidgetBackgroundColor: "#fffdf8",
  studioWidgetBorder: line,
  studioWidgetBorderRadius: 14,
  studioWidgetPadding: 14,
  studioWidgetTitleFontFamily: SERIF,
  studioWidgetTitleFontSize: 19,
  studioWidgetTitleFontWeight: 700,
  studioWidgetTitleTextColor: INK,
  studioWidgetSubtitleFontFamily: SANS,
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleTextColor: MUTED,
  studioWidgetCaptionFontFamily: SANS,
  studioWidgetCaptionFontSize: 12,
  studioWidgetCaptionTextColor: MUTED,
  studioWidgetResizeBorderColor: AMBER,

  studioPanelContainerBackgroundColor: "#fffdf8",
  studioPanelContainerBorder: line,
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: LINE,
  studioPanelDividerActiveColor: AMBER,
  studioPanelSectionBorderColor: LINE,
  studioPanelHeaderFontFamily: SERIF,
  studioPanelHeaderFontWeight: 700,
  studioPanelChevronButtonHoverBackgroundColor: "#fef3c7",
  studioPanelChevronButtonHoverColor: AMBER,
  studioToggleButtonActiveBackgroundColor: "#fef3c7",
  studioToggleButtonActiveBorderColor: AMBER,
  studioToggleButtonActiveColor: AMBER,

  gridFontFamily: SANS,
  gridFontSize: 13,
  gridCellTextColor: INK,
  gridHeaderBackgroundColor: "#faf6ee",
  gridHeaderTextColor: MUTED,
  gridHeaderFontWeight: 600,
  gridHeaderFontSize: 12,
  gridRowHeight: 38,
  gridRowBorder: { width: 1, color: "#f1ece0" },
  gridHeaderRowBorder: line,
  gridPinnedRowBorder: line,
  gridRowHoverColor: "#fef3c7",
  gridWrapperBorder: false,

  chartFontFamily: SANS,
  chartTextColor: INK,
  chartSubtleTextColor: MUTED,
  chartAxisLineColor: LINE,
  chartGridLineColor: "#f1ece0",
  ...palette,
});
