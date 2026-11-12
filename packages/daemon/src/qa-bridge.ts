/**
 * QA bridge contract (proposal). Nothing is registered or injected here.
 *
 * Five read-only tools mirror the VENIRON QA bridge contract. The bridge is
 * disabled unless `config.activa === true`; it never chooses a backend from
 * model text and never opens the network, a database, CDP or the QA plugin.
 */
export const QA_BRIDGE_READ_TOOLS = [
	"qa_estado",
	"qa_scan",
	"qa_disponibles",
	"qa_duplicados",
	"qa_pasos",
] as const;

export type QaBridgeTool = (typeof QA_BRIDGE_READ_TOOLS)[number];
export type QaBridgeArgs = Record<string, unknown>;
export type QaBridgeResult = Record<string, unknown>;
export type QaBridgeErrorCode = "UNAVAILABLE" | "DENIED" | "INVALID_INPUT";

export interface QaBridgeConfig {
	activa?: boolean;
	modo?: string;
	backend?: string;
}

export type QaBridgeBackendMethod = (args: QaBridgeArgs) => Promise<QaBridgeResult>;

export interface QaBridgeBackend {
	qa_scan?: QaBridgeBackendMethod;
	qa_disponibles?: QaBridgeBackendMethod;
	qa_duplicados?: QaBridgeBackendMethod;
	qa_pasos?: QaBridgeBackendMethod;
}

export interface QaBridgeState extends Record<string, unknown> {
	activa: boolean;
	modo: string;
	backend: string | null;
	herramientas: QaBridgeTool[];
	soloLectura: true;
}

export interface QaBridge {
	estado(): QaBridgeState;
	ejecutar(
		nombre: string,
		argumentos?: QaBridgeArgs,
	): Promise<{ ok: true; texto: string; datos: QaBridgeResult }>;
}

export class QaBridgeError extends Error {
	readonly code: QaBridgeErrorCode;
	readonly details: Record<string, unknown> | undefined;

	constructor(code: QaBridgeErrorCode, message: string, details?: Record<string, unknown>) {
		super(message);
		this.name = "QaBridgeError";
		this.code = code;
		this.details = details;
	}
}

const MODOS = ["passive"] as const;

function esObjetoPlano(valor: unknown): valor is Record<string, unknown> {
	return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

export function createQaBridge({
	config = {},
	backend = null,
}: {
	config?: QaBridgeConfig;
	backend?: QaBridgeBackend | null;
} = {}): QaBridge {
	const activa = config.activa === true;
	const modo = typeof config.modo === "string" && config.modo ? config.modo : "passive";
	const nombreBackend = typeof config.backend === "string" && config.backend ? config.backend : null;

	function estado(): QaBridgeState {
		return {
			activa,
			modo,
			backend: nombreBackend,
			herramientas: [...QA_BRIDGE_READ_TOOLS],
			soloLectura: true,
		};
	}

	async function ejecutar(
		nombre: string,
		argumentos: QaBridgeArgs = {},
	): Promise<{ ok: true; texto: string; datos: QaBridgeResult }> {
		const herramienta = String(nombre ?? "");

		if (!activa) {
			throw new QaBridgeError("UNAVAILABLE", "El puente QA esta desactivado en qaBridge.activa.");
		}
		if (!(MODOS as readonly string[]).includes(modo)) {
			throw new QaBridgeError(
				"DENIED",
				"El puente QA solo se evalua en modo passive; guided y full no estan expuestos.",
			);
		}
		if (!(QA_BRIDGE_READ_TOOLS as readonly string[]).includes(herramienta)) {
			throw new QaBridgeError("DENIED", "El puente QA solo expone herramientas de lectura en esta fase.", {
				herramienta,
				permitidas: [...QA_BRIDGE_READ_TOOLS],
			});
		}
		if (!esObjetoPlano(argumentos)) {
			throw new QaBridgeError("INVALID_INPUT", "Los argumentos del puente QA deben ser un objeto.");
		}
		if (herramienta === "qa_estado") {
			return { ok: true, texto: "Estado del puente QA.", datos: estado() };
		}

		const metodo = backend?.[herramienta as keyof QaBridgeBackend];
		if (typeof metodo !== "function") {
			throw new QaBridgeError("UNAVAILABLE", "No hay backend QA para esta herramienta.", {
				backend: nombreBackend,
				herramienta,
			});
		}

		const datos: unknown = await metodo(argumentos);
		if (!esObjetoPlano(datos)) {
			throw new QaBridgeError("INVALID_INPUT", "El backend QA devolvio un resultado que no es un objeto.", {
				herramienta,
			});
		}
		return {
			ok: true,
			texto: typeof datos.texto === "string" ? datos.texto : "",
			datos,
		};
	}

	return { estado, ejecutar };
}
