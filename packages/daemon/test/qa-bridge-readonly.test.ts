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
