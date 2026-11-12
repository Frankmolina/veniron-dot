import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createQaBridgeFromConfig } from "../src/qa-bridge-config.ts";

const fixture = fileURLToPath(new URL("./fixtures/qa-bridge-sample.json", import.meta.url));

describe("QA bridge app config", () => {
	it("is off by default and never reads a snapshot", async () => {
		const bridge = createQaBridgeFromConfig();
		expect(bridge.estado()).toEqual({
			activa: false,
			modo: "passive",
			backend: "json-snapshot",
			herramientas: ["qa_estado", "qa_scan", "qa_disponibles", "qa_duplicados", "qa_pasos"],
			soloLectura: true,
		});
		await expect(bridge.ejecutar("qa_scan", {})).rejects.toMatchObject({ code: "UNAVAILABLE" });
	});

	it("activates against the fixed snapshot when the app config says so", async () => {
		const bridge = createQaBridgeFromConfig({
			qaBridge: {
				activa: true,
				modo: "passive",
				snapshotPath: fixture,
				staleAfterMs: 10 * 365 * 24 * 60 * 60 * 1000,
			},
		});
		const scan = await bridge.ejecutar("qa_scan", {});
		expect(scan.datos.bugs).toHaveLength(2);
		expect(bridge.estado().snapshot).toMatchObject({
			path: fixture,
			bugs: 2,
			stale: false,
		});
	});

	it("reports a stale snapshot without treating it as current", async () => {
		const bridge = createQaBridgeFromConfig({
			qaBridge: { activa: true, snapshotPath: fixture, staleAfterMs: 1 },
		});
		expect(bridge.estado().snapshot).toMatchObject({ path: fixture, bugs: 2, stale: true });
	});

	it("keeps the switch off until it is exactly true", () => {
		const bridge = createQaBridgeFromConfig({ qaBridge: { activa: false, snapshotPath: fixture } });
		expect(bridge.estado().activa).toBe(false);
	});
});
