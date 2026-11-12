/**
 * Phase 3 factory: build the read-only QA bridge from the app config.
 *
 * The daemon imports it at startup; the engine extension registers the five
 * tools only when the switch is exactly true. The daemon never calls the bridge
 * on its own. It reads the snapshot in place; it never copies it, calls the QA
 * plugin, opens SQLite/CDP or touches profiles.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { createQaBridge, type QaBridge } from "./qa-bridge.ts";
import { createReadOnlyQaBackend, DEFAULT_STALE_AFTER_MS } from "./qa-bridge-readonly.ts";

export const QA_BRIDGE_CONFIG_ENV = "GENTLE_DOT_QA_BRIDGE_CONFIG";

export interface QaBridgeSection {
	activa?: boolean;
	modo?: string;
	/** Fixed local snapshot written by the QA plugin; read in place. */
	snapshotPath?: string;
	maxCandidates?: number;
	staleAfterMs?: number;
}

export interface QaBridgeAppConfig {
	qaBridge?: QaBridgeSection;
}

function expandirHome(ruta: string): string {
	return ruta.startsWith("~/") ? join(homedir(), ruta.slice(2)) : ruta;
}

export function createQaBridgeFromConfig(config: QaBridgeAppConfig = {}): QaBridge {
	const section = config.qaBridge ?? {};
	const ruta = typeof section.snapshotPath === "string" ? section.snapshotPath.trim() : "";
	const backend = ruta
		? createReadOnlyQaBackend({
				snapshotPath: expandirHome(ruta),
				maxCandidates: section.maxCandidates,
				staleAfterMs:
					Number.isFinite(section.staleAfterMs) && Number(section.staleAfterMs) > 0
						? Number(section.staleAfterMs)
						: DEFAULT_STALE_AFTER_MS,
			})
		: null;
	return createQaBridge({
		config: {
			activa: section.activa === true,
			modo: typeof section.modo === "string" && section.modo ? section.modo : "passive",
			backend: "json-snapshot",
		},
		backend,
	});
}
