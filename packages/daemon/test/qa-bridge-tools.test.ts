import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import qaBridgeTools, { QA_BRIDGE_TOOL_NAMES } from "../src/extensions/qa-bridge-tools.ts";
import { QA_BRIDGE_CONFIG_ENV } from "../src/qa-bridge-config.ts";

const fixture = fileURLToPath(new URL("./fixtures/qa-bridge-sample.json", import.meta.url));

type Tool = {
	name: string;
	execute: (
		id: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
		onUpdate?: unknown,
		ctx?: unknown,
	) => Promise<{ content: Array<{ type: string; text: string }> }>;
};

function fakePi() {
	const tools: Tool[] = [];
	const pi = {
		registerTool(tool: Tool) {
			tools.push(tool);
		},
	};
	return { pi: pi as unknown as ExtensionAPI, tools };
}

afterEach(() => {
	delete process.env[QA_BRIDGE_CONFIG_ENV];
});

describe("QA bridge model tools", () => {
	it("registers nothing while the bridge is off", () => {
		process.env[QA_BRIDGE_CONFIG_ENV] = JSON.stringify({ activa: false, snapshotPath: fixture });
		const { pi, tools } = fakePi();
		qaBridgeTools(pi);
		expect(tools).toEqual([]);
	});

	it("registers nothing when no config reaches the engine", () => {
		const { pi, tools } = fakePi();
		qaBridgeTools(pi);
		expect(tools).toEqual([]);
	});

	it("registers the five read-only tools and returns state without content", async () => {
		process.env[QA_BRIDGE_CONFIG_ENV] = JSON.stringify({
			activa: true,
			modo: "passive",
			snapshotPath: fixture,
			staleAfterMs: 86_400_000,
		});
		const { pi, tools } = fakePi();
		qaBridgeTools(pi);
		expect(tools.map((tool) => tool.name).sort()).toEqual([...QA_BRIDGE_TOOL_NAMES].sort());

		const estado = tools.find((tool) => tool.name === "qa_estado");
		const result = await estado?.execute("1", {});
		const parsed = JSON.parse(result?.content[0]?.text ?? "{}") as {
			activa?: boolean;
			snapshot?: { path?: string; bugs?: number; stale?: boolean };
			bugs?: unknown;
		};
		expect(parsed.activa).toBe(true);
		expect(parsed.snapshot).toMatchObject({ path: fixture, bugs: 2, stale: false });
		expect(parsed.bugs).toBeUndefined();
	});

	it("serves scan data through the same bridge", async () => {
		process.env[QA_BRIDGE_CONFIG_ENV] = JSON.stringify({
			activa: true,
			snapshotPath: fixture,
			staleAfterMs: 86_400_000,
		});
		const { pi, tools } = fakePi();
		qaBridgeTools(pi);
		const scan = tools.find((tool) => tool.name === "qa_scan");
		const result = await scan?.execute("2", {});
		const parsed = JSON.parse(result?.content[0]?.text ?? "{}") as { bugs?: unknown[] };
		expect(parsed.bugs).toHaveLength(2);
	});
});
