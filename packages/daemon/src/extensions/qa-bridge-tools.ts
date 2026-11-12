/**
 * Model-facing QA bridge tools, loaded into the engine with `-e`.
 *
 * The extension is inert unless the daemon passes `qaBridge.activa === true`
 * through GENTLE_DOT_QA_BRIDGE_CONFIG. It registers exactly five read-only
 * tools; it never opens the network, the QA plugin, SQLite, CDP or profiles.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { QaBridge } from "../qa-bridge.ts";
import { createQaBridgeFromConfig, QA_BRIDGE_CONFIG_ENV, type QaBridgeSection } from "../qa-bridge-config.ts";

export const QA_BRIDGE_TOOL_NAMES = [
	"qa_estado",
	"qa_scan",
	"qa_disponibles",
	"qa_duplicados",
	"qa_pasos",
] as const;

function configFromEnv(): QaBridgeSection | null {
	const raw = process.env[QA_BRIDGE_CONFIG_ENV];
	if (!raw) return null;
	try {
		const value: unknown = JSON.parse(raw);
		if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
		return value as QaBridgeSection;
	} catch {
		return null;
	}
}

export default function qaBridgeTools(pi: ExtensionAPI): void {
	const section = configFromEnv();
	if (section?.activa !== true) return;
	let bridge: QaBridge;
	try {
		bridge = createQaBridgeFromConfig({ qaBridge: section });
	} catch {
		// A malformed QA config must not take the whole engine down.
		return;
	}

	const register = (
		name: string,
		label: string,
		description: string,
		parameters: Record<string, unknown>,
	) => {
		pi.registerTool({
			name,
			label,
			description,
			parameters: parameters as never,
			async execute(_toolCallId, params) {
				const result = await bridge.ejecutar(name, (params ?? {}) as Record<string, unknown>);
				return {
					content: [{ type: "text", text: JSON.stringify(result.datos, null, 2) }],
					details: {},
				};
			},
		});
	};

	register(
		"qa_estado",
		"QA bridge status",
		"Return the read-only QA bridge state: activation, mode, backend, snapshot path, generation date, bug count and staleness. It never returns the snapshot content.",
		{ type: "object", additionalProperties: false, properties: {} },
	);
	register(
		"qa_scan",
		"QA snapshot",
		"Read the whole QA snapshot in place: cycle metadata and the clean list of bugs. Read-only; no network, plugin, SQLite, CDP or profiles.",
		{ type: "object", additionalProperties: false, properties: {} },
	);
	register(
		"qa_disponibles",
		"QA available candidates",
		"Read the available reproduction candidates from the same local QA snapshot. Read-only.",
		{ type: "object", additionalProperties: false, properties: {} },
	);
	register(
		"qa_duplicados",
		"QA duplicate check",
		"Compare a title with the cycle's local QA snapshot and return ranked similarity candidates. It never decides a duplicate. Read-only.",
		{
			type: "object",
			additionalProperties: false,
			required: ["title"],
			properties: { title: { type: "string" }, text: { type: "string" } },
		},
	);
	register(
		"qa_pasos",
		"QA reproduction steps",
		"Return the stored reporter steps, actual and expected result for one bug number from the local QA snapshot. Read-only.",
		{
			type: "object",
			additionalProperties: false,
			required: ["bugNumber"],
			properties: { bugNumber: { type: "string" } },
		},
	);
}
