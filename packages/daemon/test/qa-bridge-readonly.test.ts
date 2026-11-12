import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createQaBridge } from "../src/qa-bridge.ts";
import { createReadOnlyQaBackend, similitudTitulo } from "../src/qa-bridge-readonly.ts";

const fixture = fileURLToPath(new URL("./fixtures/qa-bridge-sample.json", import.meta.url));

function bridgeActivo(snapshotPath: string) {
	return createQaBridge({
		config: { activa: true, modo: "passive", backend: "json-snapshot" },
		backend: createReadOnlyQaBackend({ snapshotPath }),
	});
}

describe("read-only QA JSON adapter", () => {
	it("is never touched while the bridge is off", async () => {
		const bridge = createQaBridge({
			backend: createReadOnlyQaBackend({ snapshotPath: "/does/not/exist.json" }),
		});
		await expect(bridge.ejecutar("qa_scan", {})).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});
	});

	it("reads the snapshot for scan and available", async () => {
		const bridge = bridgeActivo(fixture);
		const scan = await bridge.ejecutar("qa_scan", {});
		expect(scan.datos.bugs).toHaveLength(2);
		expect(scan.datos.cycle).toMatchObject({ platform: "testio" });

		const available = await bridge.ejecutar("qa_disponibles", {});
		expect(available.datos.candidatos).toEqual([
			expect.objectContaining({ number: "1001", title: "El carrito se vacía al recargar" }),
		]);
	});

	it("ranks sample duplicates without deciding for the user", async () => {
		const bridge = bridgeActivo(fixture);
		const result = await bridge.ejecutar("qa_duplicados", {
			title: "carrito se vacía al recargar",
		});
		const candidates = result.datos.candidatos as Array<{ number: string; score: number }>;
		expect(candidates.some((candidate) => candidate.number === "900")).toBe(true);
		expect(candidates[0]?.score).toBeGreaterThanOrEqual(candidates.at(-1)?.score ?? 0);
	});

	it("returns the reporter steps in their stored order", async () => {
		const bridge = bridgeActivo(fixture);
		const result = await bridge.ejecutar("qa_pasos", { bugNumber: "1001" });
		expect(result.datos.steps).toEqual([
			"Abrir la tienda",
			"Añadir una camiseta al carrito",
			"Recargar la página",
		]);
	});

	it("returns an explicit empty result for an unknown bug", async () => {
		const bridge = bridgeActivo(fixture);
		const result = await bridge.ejecutar("qa_pasos", { bugNumber: "9999" });
		expect(result.datos.pasos).toEqual([]);
		expect(result.texto).toMatch(/No hay pasos/);
	});

	it("reports a missing file and malformed JSON as errors, not as data", async () => {
		const missing = bridgeActivo("/does/not/exist.json");
		await expect(missing.ejecutar("qa_scan", {})).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});

		const dir = await mkdtemp(join(tmpdir(), "qa-bridge-readonly-"));
		try {
			const invalid = join(dir, "invalid.json");
			await writeFile(invalid, "{", "utf8");
			const bridge = bridgeActivo(invalid);
			await expect(bridge.ejecutar("qa_scan", {})).rejects.toMatchObject({
				code: "INVALID_INPUT",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("needs a query for duplicate checks", async () => {
		const bridge = bridgeActivo(fixture);
		await expect(bridge.ejecutar("qa_duplicados", {})).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
	});

	it("scores titles deterministically", () => {
		expect(similitudTitulo("carrito vacío", "Carrito vacio")).toBe(1);
		expect(similitudTitulo("carrito", "pago")).toBe(0);
	});
});

describe("read-only QA snapshot status", () => {
	it("returns path, date and count without exposing content", () => {
		const backend = createReadOnlyQaBackend({
			snapshotPath: fixture,
			now: () => Date.parse("2026-11-12T18:30:00.000Z"),
		});
		const bridge = createQaBridge({
			config: { activa: true, modo: "passive", backend: "json-snapshot" },
			backend,
		});
		expect(bridge.estado().snapshot).toEqual({
			path: fixture,
			generatedAt: "2026-11-12T18:00:00.000Z",
			bugs: 2,
			stale: false,
		});
	});

	it("marks an old snapshot as stale and a missing one as stale with zero bugs", () => {
		const old = createReadOnlyQaBackend({
			snapshotPath: fixture,
			staleAfterMs: 1,
			now: () => Date.parse("2026-11-12T19:00:00.000Z"),
		});
		const bridge = createQaBridge({
			config: { activa: true, modo: "passive", backend: "json-snapshot" },
			backend: old,
		});
		expect(bridge.estado().snapshot).toMatchObject({ path: fixture, bugs: 2, stale: true });

		const missing = createReadOnlyQaBackend({ snapshotPath: "/does/not/exist.json" });
		const missingBridge = createQaBridge({
			config: { activa: true, modo: "passive", backend: "json-snapshot" },
			backend: missing,
		});
		expect(missingBridge.estado().snapshot).toEqual({
			path: "/does/not/exist.json",
			generatedAt: null,
			bugs: 0,
			stale: true,
		});
	});
});
