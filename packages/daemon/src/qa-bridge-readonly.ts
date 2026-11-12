/**
 * Read-only QA bridge adapter: a local JSON snapshot, never the QA assistant.
 *
 * This is the phase-2 backend for `qa-bridge.ts`. It only reads one file that
 * the user/config points to. It does not open SQLite, CDP, Test IO/uTest, the
 * network, the QA plugin or any profile, and it never writes.
 */
import { readFileSync } from "node:fs";
import { type QaBridgeArgs, type QaBridgeBackend, QaBridgeError, type QaBridgeResult } from "./qa-bridge.ts";

export interface QaSnapshotBug {
	number: string;
	title?: string;
	status?: string;
	feature?: string;
	steps?: string[];
	actual?: string;
	expected?: string;
}

export interface QaSnapshotCandidate {
	number: string;
	title?: string;
	status?: string;
	device?: string;
}

export interface QaSnapshot {
	version: 1;
	generatedAt?: string;
	cycle?: Record<string, unknown>;
	bugs: QaSnapshotBug[];
	available: QaSnapshotCandidate[];
	duplicates: QaSnapshotCandidate[];
}

export interface ReadOnlyQaBackendOptions {
	/** JSON snapshot produced outside this process. No default: the caller must choose it. */
	snapshotPath: string;
	maxCandidates?: number;
}

function esObjetoPlano(valor: unknown): valor is Record<string, unknown> {
	return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function esCandidato(valor: unknown): valor is QaSnapshotCandidate {
	return esObjetoPlano(valor) && typeof valor.number === "string" && valor.number.length > 0;
}

function esBug(valor: unknown): valor is QaSnapshotBug {
	if (!esCandidato(valor)) return false;
	const bug = valor as QaSnapshotBug;
	return (
		bug.steps === undefined ||
		(Array.isArray(bug.steps) && bug.steps.every((step) => typeof step === "string"))
	);
}

function validarSnapshot(valor: unknown): QaSnapshot {
	if (!esObjetoPlano(valor) || valor.version !== 1) {
		throw new QaBridgeError("INVALID_INPUT", "El snapshot QA debe ser un objeto con version: 1.");
	}
	if (!Array.isArray(valor.bugs) || !valor.bugs.every(esBug)) {
		throw new QaBridgeError("INVALID_INPUT", "El snapshot QA tiene bugs invalidos.");
	}
	if (!Array.isArray(valor.available) || !valor.available.every(esCandidato)) {
		throw new QaBridgeError("INVALID_INPUT", "El snapshot QA tiene available invalido.");
	}
	if (!Array.isArray(valor.duplicates) || !valor.duplicates.every(esCandidato)) {
		throw new QaBridgeError("INVALID_INPUT", "El snapshot QA tiene duplicates invalido.");
	}
	if (valor.cycle !== undefined && !esObjetoPlano(valor.cycle)) {
		throw new QaBridgeError("INVALID_INPUT", "El cycle del snapshot QA debe ser un objeto.");
	}
	if (valor.generatedAt !== undefined && typeof valor.generatedAt !== "string") {
		throw new QaBridgeError("INVALID_INPUT", "generatedAt del snapshot QA debe ser texto.");
	}
	return {
		version: 1,
		...(valor.generatedAt === undefined ? {} : { generatedAt: valor.generatedAt }),
		...(valor.cycle === undefined ? {} : { cycle: valor.cycle }),
		bugs: valor.bugs,
		available: valor.available,
		duplicates: valor.duplicates,
	};
}

function normalizar(texto: string): string {
	return texto
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase();
}

function tokens(texto: string): Set<string> {
	return new Set(
		normalizar(texto)
			.split(/[^a-z0-9]+/)
			.filter((token) => token.length > 1),
	);
}

/** Jaccard token overlap. Deterministic, local and cheap for an evaluation snapshot. */
export function similitudTitulo(a: string, b: string): number {
	const left = tokens(a);
	const right = tokens(b);
	if (left.size === 0 || right.size === 0) return 0;
	let intersection = 0;
	for (const token of left) if (right.has(token)) intersection += 1;
	return intersection / (left.size + right.size - intersection);
}

export function createReadOnlyQaBackend({
	snapshotPath,
	maxCandidates = 10,
}: ReadOnlyQaBackendOptions): QaBridgeBackend {
	if (typeof snapshotPath !== "string" || snapshotPath.trim() === "") {
		throw new QaBridgeError("INVALID_INPUT", "Falta snapshotPath para el adaptador QA.");
	}
	const limite = Number.isInteger(maxCandidates) && maxCandidates > 0 ? maxCandidates : 10;

	function cargar(): QaSnapshot {
		let crudo: string;
		try {
			crudo = readFileSync(snapshotPath, "utf8");
		} catch {
			throw new QaBridgeError("UNAVAILABLE", "No se pudo leer el snapshot QA configurado.");
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(crudo);
		} catch {
			throw new QaBridgeError("INVALID_INPUT", "El snapshot QA no es JSON valido.");
		}
		return validarSnapshot(parsed);
	}

	async function scan(): Promise<QaBridgeResult> {
		const snapshot = await cargar();
		return {
			texto: `Snapshot QA: ${snapshot.bugs.length} bugs, ${snapshot.available.length} disponibles.`,
			generadoEn: snapshot.generatedAt ?? null,
			cycle: snapshot.cycle ?? null,
			bugs: snapshot.bugs,
		};
	}

	async function disponibles(): Promise<QaBridgeResult> {
		const snapshot = await cargar();
		return {
			texto: `${snapshot.available.length} candidatos disponibles en el snapshot.`,
			cycle: snapshot.cycle ?? null,
			candidatos: snapshot.available,
		};
	}

	async function duplicados(argumentos: QaBridgeArgs): Promise<QaBridgeResult> {
		const consulta = String(argumentos.title ?? argumentos.texto ?? argumentos.query ?? "").trim();
		if (!consulta) {
			throw new QaBridgeError("INVALID_INPUT", "qa_duplicados necesita title, texto o query.");
		}
		const snapshot = await cargar();
		const vistos = new Set<string>();
		const candidatos: Array<QaSnapshotCandidate & { score: number }> = [];
		for (const candidato of [...snapshot.duplicates, ...snapshot.bugs]) {
			if (vistos.has(candidato.number)) continue;
			vistos.add(candidato.number);
			if (!candidato.title) continue;
			const score = similitudTitulo(consulta, candidato.title);
			if (score <= 0) continue;
			candidatos.push({ ...candidato, score: Math.round(score * 1000) / 1000 });
		}
		candidatos.sort((a, b) => b.score - a.score || a.number.localeCompare(b.number));
		return {
			texto: `${candidatos.length} candidatos similares en el snapshot.`,
			consulta,
			candidatos: candidatos.slice(0, limite),
		};
	}

	async function pasos(argumentos: QaBridgeArgs): Promise<QaBridgeResult> {
		const numero = String(argumentos.bugNumber ?? argumentos.bug ?? "").trim();
		if (!numero) {
			throw new QaBridgeError("INVALID_INPUT", "qa_pasos necesita bugNumber.");
		}
		const snapshot = await cargar();
		const bug = snapshot.bugs.find((item) => item.number === numero);
		if (!bug) {
			return {
				texto: `No hay pasos para el bug ${numero} en el snapshot.`,
				bugNumber: numero,
				pasos: [],
			};
		}
		return {
			texto: `Pasos del bug ${numero}.`,
			bugNumber: numero,
			title: bug.title ?? null,
			steps: bug.steps ?? [],
			actual: bug.actual ?? null,
			expected: bug.expected ?? null,
		};
	}

	return {
		qa_scan: scan,
		qa_disponibles: disponibles,
		qa_duplicados: duplicados,
		qa_pasos: pasos,
	};
}
