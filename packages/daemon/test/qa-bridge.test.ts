import { describe, expect, it } from "vitest";
import {
	createQaBridge,
	QA_BRIDGE_READ_TOOLS,
	type QaBridgeArgs,
	type QaBridgeBackend,
	QaBridgeError,
	type QaBridgeResult,
} from "../src/qa-bridge.ts";

function fakeBackend() {
	const calls: Array<[string, QaBridgeArgs]> = [];
	const backend: QaBridgeBackend = {
		qa_scan: async (args) => {
			calls.push(["qa_scan", args]);
			return { texto: "scan ok", bugs: 3 };
		},
		qa_disponibles: async (args) => {
			calls.push(["qa_disponibles", args]);
			return { texto: "2 disponibles", candidatos: [{ bug: "1" }] };
		},
		qa_duplicados: async (args) => {
			calls.push(["qa_duplicados", args]);
			return { texto: "sin duplicados", candidatos: [] };
		},
		qa_pasos: async (args) => {
			calls.push(["qa_pasos", args]);
			return { texto: "pasos", pasos: ["uno", "dos"] };
		},
	};
	return { backend, calls };
}

describe("qa bridge contract", () => {
	it("starts disabled and never calls the backend", async () => {
		const { backend, calls } = fakeBackend();
		const bridge = createQaBridge({ backend });

		expect(bridge.estado()).toEqual({
			activa: false,
			modo: "passive",
			backend: null,
			herramientas: [...QA_BRIDGE_READ_TOOLS],
			soloLectura: true,
		});
		await expect(bridge.ejecutar("qa_scan", {})).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});
		expect(calls).toEqual([]);
	});

	it("calls the matching read-only backend method once", async () => {
		const { backend, calls } = fakeBackend();
		const bridge = createQaBridge({
			config: { activa: true, modo: "passive", backend: "test" },
			backend,
		});

		const scan = await bridge.ejecutar("qa_scan", { cycleUrl: "https://example.test/cycle" });
		expect(scan.ok).toBe(true);
		expect(scan.texto).toBe("scan ok");
		expect(scan.datos.bugs).toBe(3);
		expect(calls).toEqual([["qa_scan", { cycleUrl: "https://example.test/cycle" }]]);

		const pasos = await bridge.ejecutar("qa_pasos", { bug: "123" });
		expect(pasos.ok).toBe(true);
		expect(pasos.datos.pasos).toEqual(["uno", "dos"]);
		expect(calls).toHaveLength(2);
	});

	it("qa_estado needs no backend", async () => {
		const bridge = createQaBridge({
			config: { activa: true, modo: "passive", backend: "test" },
		});
		const respuesta = await bridge.ejecutar("qa_estado", {});
		expect(respuesta.ok).toBe(true);
		expect(respuesta.datos.activa).toBe(true);
		expect(respuesta.datos.soloLectura).toBe(true);
	});

	it("rejects write and browser tools without calling the backend", async () => {
		const { backend, calls } = fakeBackend();
		const bridge = createQaBridge({
			config: { activa: true, modo: "passive" },
			backend,
		});

		for (const forbidden of [
			"reserve_bug",
			"release_bug",
			"browser_action",
			"draft_bug_report",
			"qa_publicar",
		]) {
			await expect(bridge.ejecutar(forbidden, {})).rejects.toMatchObject({
				code: "DENIED",
			});
		}
		expect(calls).toEqual([]);
	});

	it("rejects guided and full in this phase", async () => {
		const { backend, calls } = fakeBackend();
		const bridge = createQaBridge({
			config: { activa: true, modo: "full" },
			backend,
		});

		await expect(bridge.ejecutar("qa_scan", {})).rejects.toMatchObject({
			code: "DENIED",
		});
		expect(calls).toEqual([]);
	});

	it("returns UNAVAILABLE when the backend method is missing", async () => {
		const bridge = createQaBridge({
			config: { activa: true, modo: "passive" },
		});
		await expect(bridge.ejecutar("qa_disponibles", {})).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});
	});

	it("validates arguments and backend results", async () => {
		const bridge = createQaBridge({
			config: { activa: true, modo: "passive" },
			backend: {
				qa_scan: async () => [] as unknown as QaBridgeResult,
			},
		});

		await expect(
			bridge.ejecutar("qa_scan", "not-an-object" as unknown as QaBridgeArgs),
		).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
		await expect(bridge.ejecutar("qa_scan", {})).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
	});

	it("uses a stable error type and code", () => {
		const error = new QaBridgeError("DENIED", "no");
		expect(error.name).toBe("QaBridgeError");
		expect(error.code).toBe("DENIED");
	});
});
