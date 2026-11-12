// AG Studio theme for the Gala Report, mapped to the Going Twice tokens in globals.css:
// paper canvas, near-black ink, clay accent, Cormorant Garamond titles, Inter for data.

import { studioTheme } from "ag-studio";

const SERIF = "var(--font-display), Georgia, serif";
const SANS = "var(--font-ui), system-ui, sans-serif";
const INK = "#141413";
const MUTED = "#6b6a63";
const LINE = "#e5e2d8";
const AMBER = "#a9512f";
const line = { width: 1, color: LINE };
const PALETTE = ["#c15f3c", "#3f6b4e", "#4b5a8c", "#b5935a", "#141413", "#a23b2e", "#8a8780", "#d9a083", "#6f8f78", "#3d3d3a"];
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
  backgroundColor: "#ffffff",
  borderColor: LINE,
  accentColor: AMBER,
  iconColor: "#3d3d3a",
  rowHoverColor: "#f6e7de",

  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: "transparent",
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: "transparent",
  studioCanvasPadding: 0,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: SANS,

  studioWidgetBackgroundColor: "#ffffff",
  studioWidgetBorder: line,
  studioWidgetBorderRadius: 14,
  studioWidgetPadding: 20,
  studioWidgetTitleFontFamily: SERIF,
  studioWidgetTitleFontSize: 22,
  studioWidgetTitleFontWeight: 500,
  studioWidgetTitleTextColor: INK,
  studioWidgetSubtitleFontFamily: SANS,
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleTextColor: MUTED,
  studioWidgetCaptionFontFamily: SANS,
  studioWidgetCaptionFontSize: 12,
  studioWidgetCaptionTextColor: MUTED,
  studioWidgetResizeBorderColor: AMBER,

  studioPanelContainerBackgroundColor: "#ffffff",
  studioPanelContainerBorder: line,
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: LINE,
  studioPanelDividerActiveColor: AMBER,
  studioPanelSectionBorderColor: LINE,
  studioPanelHeaderFontFamily: SERIF,
  studioPanelHeaderFontWeight: 500,
  studioPanelChevronButtonHoverBackgroundColor: "#f6e7de",
  studioPanelChevronButtonHoverColor: AMBER,
  studioToggleButtonActiveBackgroundColor: "#f6e7de",
  studioToggleButtonActiveBorderColor: AMBER,
  studioToggleButtonActiveColor: AMBER,

  gridFontFamily: SANS,
  gridFontSize: 13,
  gridCellTextColor: INK,
  gridHeaderBackgroundColor: "#faf9f5",
  gridHeaderTextColor: MUTED,
  gridHeaderFontWeight: 500,
  gridHeaderFontSize: 12,
  gridRowHeight: 38,
  gridRowBorder: { width: 1, color: "#efece4" },
  gridHeaderRowBorder: line,
  gridPinnedRowBorder: line,
  gridRowHoverColor: "#f6e7de",
  gridWrapperBorder: false,

  chartFontFamily: SANS,
  chartTextColor: INK,
  chartSubtleTextColor: MUTED,
  chartAxisLineColor: LINE,
  chartGridLineColor: "#efece4",
  ...palette,
});
