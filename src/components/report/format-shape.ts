// The Studio shape builder (`s`) is only handed to AI tools, not to a widget's formatShape, so we
// borrow it from a throwaway server-kind tool. This gives the custom widgets a typed `format`
// schema, which the Studio Agent Framework needs to configure them.

import type { AgFormatShapeParams, AgAiParamsBuilder, AgExternalShape } from "ag-studio";

type Format = { title?: { enabled?: boolean; text?: string }; subtitle?: { enabled?: boolean; text?: string }; caption?: { enabled?: boolean; text?: string } };

export function galaFormatShape(params: AgFormatShapeParams): AgExternalShape<Format> {
  let builder: AgAiParamsBuilder | undefined;
  const tool = params.api.defineAiTool({
    name: "gala_format_shape_probe",
    description: "internal",
    kind: "server",
    params: (s) => {
      builder = s;
      return s.object({}) as never;
    },
  });
  tool.schema();
  const s = builder as AgAiParamsBuilder;
  const text = () =>
    s.object({ enabled: s.boolean().optional(), text: s.string().optional() }).optional();
  return s.object({ title: text(), subtitle: text(), caption: text() }) as unknown as AgExternalShape<Format>;
}
