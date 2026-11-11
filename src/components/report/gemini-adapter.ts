// A small custom AgLlmAdapter for the Studio Agent Framework, backed by Google Gemini.
//
// Studio's loop (directLlmRunner) owns the turns, the conversation and the tool execution; this
// adapter only translates ONE turn: AgLlmRequest -> Gemini generateContent body, and the reply back
// into Studio's AG-UI style events + a final AgLlmResponse. The browser never sees the API key: the
// body is POSTed to this app's own route (/api/report-agent), which adds GEMINI_API_KEY.

import type {
  AgAiEvent,
  AgAiOutputItem,
  AgLlmAdapter,
  AgLlmRequest,
  AgLlmResponse,
  AgLlmResponseHandler,
} from "ag-studio";

type Json = Record<string, unknown>;
type Part = Json;
type Content = { role: "user" | "model"; parts: Part[] };

// --- JSON Schema: Studio's shapes -> what Gemini accepts (parametersJsonSchema) -----------------
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isUndefinedSentinel = (s: unknown) =>
  isObj(s) && Object.keys(s).length === 1 && isObj(s.not) && Object.keys(s.not).length === 0;

function cleanSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(cleanSchema);
  if (!isObj(node)) return node;
  const out: Json = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "$schema" || k === "not") continue;
    if (k === "const") {
      out.enum = [v];
      continue;
    }
    if (k === "anyOf" && Array.isArray(v)) {
      const branches = v.filter((b) => !isUndefinedSentinel(b)).map(cleanSchema);
      if (branches.length === 1 && isObj(branches[0])) Object.assign(out, branches[0]);
      else out.anyOf = branches;
      continue;
    }
    out[k] = cleanSchema(v);
  }
  return out;
}

// Gemini 3 models return a thoughtSignature on function calls and require it echoed back on the
// next turn, so it is remembered per call id.
const signatures = new Map<string, string>();
// Calls Studio seeds itself (defaultToolCalls) never came from the model, so they have no signature;
// Gemini documents this placeholder for that case.
const SKIP_SIGNATURE = "skip_thought_signature_validator";

// --- request -------------------------------------------------------------------------------------
function toContents(input: AgLlmRequest["input"]): Content[] {
  const names = new Map<string, string>();
  const contents: Content[] = [];
  const push = (role: Content["role"], part: Part) => {
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(part);
    else contents.push({ role, parts: [part] });
  };
  for (const item of input) {
    if (item.kind === "input" && item.type === "message") {
      for (const c of item.content) {
        if (c.type === "text") push("user", { text: c.text });
      }
    } else if (item.kind === "output" && item.type === "message") {
      for (const c of item.content) {
        if (c.type === "text" && c.text) push("model", { text: c.text });
      }
    } else if (item.kind === "output" && item.type === "function_call") {
      names.set(item.callId, item.name);
      let args: unknown = {};
      try {
        args = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        /* keep {} */
      }
      push("model", { functionCall: { name: item.name, args }, thoughtSignature: signatures.get(item.callId) ?? SKIP_SIGNATURE });
    } else if (item.type === "function_call_output") {
      let response: unknown = item.output;
      try {
        response = JSON.parse(item.output as string);
      } catch {
        /* plain text */
      }
      push("user", {
        functionResponse: {
          name: names.get(item.callId) ?? "tool",
          response: isObj(response) ? response : { output: response },
        },
      });
    }
    // reasoning items carry nothing Gemini needs
  }
  if (!contents.length) contents.push({ role: "user", parts: [{ text: "Hello" }] });
  return contents;
}

function buildBody(req: AgLlmRequest): Json {
  const body: Json = {
    contents: toContents(req.input),
    generationConfig: { temperature: 0.2, thinkingConfig: { thinkingBudget: 1024 } },
  };
  if (req.instructions) body.systemInstruction = { parts: [{ text: req.instructions }] };

  const tools = (req.tools ?? []).filter((t) => (t.kind ?? "client") !== "provided");
  if (tools.length) {
    body.tools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parametersJsonSchema: cleanSchema(t.parameters),
        })),
      },
    ];
    const choice = req.toolChoice;
    if (choice === "none") body.toolConfig = { functionCallingConfig: { mode: "NONE" } };
    else if (choice === "required") body.toolConfig = { functionCallingConfig: { mode: "ANY" } };
    else if (choice && typeof choice === "object")
      body.toolConfig = { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [choice.name] } };
  }
  if (req.responseFormat?.type === "json") {
    Object.assign(body.generationConfig as Json, {
      responseMimeType: "application/json",
      responseJsonSchema: cleanSchema(req.responseFormat.schema),
    });
  }
  return body;
}

// --- response ------------------------------------------------------------------------------------
let seq = 0;
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

function decode(json: Json, model: string): { events: AgAiEvent[]; response: AgLlmResponse } {
  const events: AgAiEvent[] = [];
  const output: AgAiOutputItem[] = [];
  const cand = (json.candidates as Json[] | undefined)?.[0];
  const parts = ((cand?.content as Json | undefined)?.parts as Part[] | undefined) ?? [];

  const text = parts
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text as string)
    .join("");
  if (text) {
    const id = uid("msg");
    events.push({ type: "TEXT_MESSAGE_START", messageId: id, role: "assistant" });
    events.push({ type: "TEXT_MESSAGE_CONTENT", messageId: id, delta: text });
    events.push({ type: "TEXT_MESSAGE_END", messageId: id });
    output.push({
      id,
      kind: "output",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "text", text, annotations: [] }],
    });
  }
  for (const p of parts) {
    const fc = p.functionCall as { name: string; args?: unknown; id?: string } | undefined;
    if (!fc) continue;
    const callId = fc.id ?? uid("call");
    if (typeof p.thoughtSignature === "string") signatures.set(callId, p.thoughtSignature);
    const args = JSON.stringify(fc.args ?? {});
    events.push({ type: "TOOL_CALL_START", toolCallId: callId, toolCallName: fc.name });
    events.push({ type: "TOOL_CALL_ARGS", toolCallId: callId, delta: args });
    events.push({ type: "TOOL_CALL_END", toolCallId: callId });
    output.push({ id: callId, kind: "output", type: "function_call", callId, name: fc.name, arguments: args, status: "completed" });
  }

  const usage = json.usageMetadata as Json | undefined;
  const blocked = !output.length && (cand?.finishReason === "SAFETY" || (json.promptFeedback as Json | undefined)?.blockReason);
  return {
    events,
    response: {
      id: uid("resp"),
      createdAt: Date.now(),
      model,
      output,
      status: blocked ? "incomplete" : "completed",
      incompleteDetails: blocked ? { reason: "content_filter" } : undefined,
      usage: usage
        ? {
            inputTokens: Number(usage.promptTokenCount ?? 0),
            outputTokens: Number(usage.candidatesTokenCount ?? 0),
            totalTokens: Number(usage.totalTokenCount ?? 0),
          }
        : undefined,
    },
  };
}

export function geminiAdapter(options: { endpoint?: string; model?: string } = {}): AgLlmAdapter {
  const endpoint = options.endpoint ?? "/api/report-agent";
  return {
    executeTurn(request, opts): AgLlmResponseHandler {
      const result = (async () => {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: buildBody(request) }),
          signal: opts?.signal,
        });
        const json = (await res.json().catch(() => ({}))) as Json;
        if (!res.ok) {
          const msg = (json.error as Json | undefined)?.message ?? `Agent request failed (HTTP ${res.status}).`;
          throw new Error(String(msg));
        }
        return decode(json, String(json.modelVersion ?? options.model ?? "gemini"));
      })();
      result.catch(() => {});

      async function* stream(): AsyncIterableIterator<AgAiEvent> {
        const { events } = await result;
        yield* events;
      }
      return {
        stream: { [Symbol.asyncIterator]: () => stream() },
        complete: result.then((r) => r.response),
      };
    },
  };
}
