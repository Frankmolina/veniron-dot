import { useCallback, useEffect, useRef, useState } from "react";
import { loadMemory, type MemoryMode, saveMemory } from "../memory.ts";
import {
	formatShortcut,
	isMac,
	isWindows,
	loadShortcut,
	recordKey,
	type ShortcutInfo,
	saveShortcut,
} from "../shortcut.ts";
import { setVoiceLanguage, VOICE_LANGUAGES, voiceLanguage } from "../voice-language.ts";
import "../settings.css";

type Status =
	| { kind: "idle" }
	| { kind: "recording" }
	| { kind: "applying"; shortcut: string }
	| { kind: "applied" }
	| { kind: "failed"; reason: string };

function reasonOf(error: unknown, fallback = "VENIRON no ha podido cambiar el atajo."): string {
	if (typeof error === "string" && error) return error;
	if (error instanceof Error && error.message) return error.message;
	return fallback;
}

/** The desktop panel's settings (S33.1): the panel shortcut, the memory mode, and the voice language. */
export function SettingsPanel({ close }: { close: () => void }) {
	const [language, setLanguage] = useState(() => voiceLanguage() ?? "");
	const mac = isMac();
	const show = (accelerator: string) => formatShortcut(accelerator, mac);
	const [info, setInfo] = useState<ShortcutInfo | undefined>(undefined);
	const [loadFailed, setLoadFailed] = useState(false);
	const [status, setStatus] = useState<Status>({ kind: "idle" });
	const [memory, setMemory] = useState<MemoryMode | undefined>(undefined);
	const [memoryInvalid, setMemoryInvalid] = useState<string | undefined>(undefined);
	const [memoryFailed, setMemoryFailed] = useState(false);
	const [memoryApplying, setMemoryApplying] = useState(false);
	const [memoryReason, setMemoryReason] = useState<string | undefined>(undefined);
	const live = useRef(true);
	const prompt = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		live.current = true;
		loadShortcut().then(
			(found) => {
				if (live.current) setInfo(found);
			},
			() => {
				if (live.current) setLoadFailed(true);
			},
		);
		loadMemory().then(
			(found) => {
				if (!live.current) return;
				setMemory(found.memory ?? undefined);
				setMemoryInvalid(found.error);
			},
			() => {
				if (live.current) setMemoryFailed(true);
			},
		);
		return () => {
			live.current = false;
		};
	}, []);

	const apply = useCallback((accelerator: string) => {
		setStatus({ kind: "applying", shortcut: accelerator });
		saveShortcut(accelerator).then(
			(saved) => {
				if (!live.current) return;
				setInfo((current) => current && { ...current, shortcut: saved });
				setStatus({ kind: "applied" });
			},
			(error: unknown) => {
				if (live.current) setStatus({ kind: "failed", reason: reasonOf(error) });
			},
		);
	}, []);

	const applyMemory = useCallback((next: MemoryMode) => {
		setMemoryApplying(true);
		setMemoryReason(undefined);
		saveMemory(next).then(
			(saved) => {
				if (!live.current) return;
				setMemory(saved);
				setMemoryInvalid(undefined);
				setMemoryApplying(false);
			},
			(error: unknown) => {
				if (!live.current) return;
				setMemoryReason(reasonOf(error, "VENIRON no ha podido cambiar el ajuste de memoria."));
				setMemoryApplying(false);
			},
		);
	}, []);

	const recording = status.kind === "recording";
	useEffect(() => {
		if (!recording) return;
		prompt.current?.focus();
		// Captured before the panel's own keys: Esc here cancels recording instead of hiding the
		// panel, and ⌘⇧F is recorded instead of filling the screen (they skip handled keys).
		const onKey = (event: KeyboardEvent) => {
			event.preventDefault();
			const recorded = recordKey(event);
			if (recorded.kind === "cancel") setStatus({ kind: "idle" });
			else if (recorded.kind === "shortcut") apply(recorded.accelerator);
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [recording, apply]);

	const applying = status.kind === "applying";
	return (
		<section className="accounts settings" aria-label="Ajustes">
			<header className="accounts-header">
				<h2>Ajustes</h2>
				<button type="button" className="icon" aria-label="Cerrar ajustes" onClick={close}>
					×
				</button>
			</header>

			<section className="provider-section" aria-labelledby="settings-shortcut">
				<h3 id="settings-shortcut">Atajo de teclado</h3>
				<p className="muted">Abre y oculta el panel desde cualquier aplicación.</p>
				{loadFailed ? (
					<p className="settings-error" role="alert">
						VENIRON no ha podido leer el atajo actual.
					</p>
				) : null}
				<div className="shortcut-row">
					{recording ? (
						<span ref={prompt} className="shortcut-recording" tabIndex={-1}>
							Pulsa el nuevo atajo… Esc cancela.
						</span>
					) : (
						<kbd className="shortcut-keys">{info ? show(info.shortcut) : "…"}</kbd>
					)}
					{recording ? (
						<button type="button" onClick={() => setStatus({ kind: "idle" })}>
							Cancelar
						</button>
					) : (
						<button
							type="button"
							className="primary"
							disabled={!info || applying}
							onClick={() => setStatus({ kind: "recording" })}
						>
							Cambiar
						</button>
					)}
				</div>
				{status.kind === "applying" ? (
					<p className="muted" role="status">
						Aplicando {show(status.shortcut)}…
					</p>
				) : null}
				{status.kind === "applied" ? (
					<p className="settings-ok" role="status">
						Guardado. Ya funciona.
					</p>
				) : null}
				{status.kind === "failed" ? (
					<p className="settings-error" role="alert">
						{status.reason}
					</p>
				) : null}
				<p className="settings-hint muted">
					Usa al menos una tecla modificadora ({mac ? "⌘ ⌥ ⌃ ⇧" : "Super, Alt, Ctrl, Shift"}) o una tecla de
					función.
				</p>
				<button
					type="button"
					className="link"
					title={info ? `Predeterminado: ${show(info.default)}` : undefined}
					disabled={!info || info.shortcut === info.default || applying || recording}
					onClick={() => info && apply(info.default)}
				>
					Restablecer el predeterminado
				</button>
			</section>

			<section className="provider-section" aria-labelledby="settings-memory">
				<h3 id="settings-memory">Memoria</h3>
				<p className="muted">
					Actívalo para darle al asistente una memoria propia en lugar de la tuya: empieza vacía y nunca lee
					ni escribe tu memoria.
				</p>
				{memoryFailed ? (
					<p className="settings-error" role="alert">
						VENIRON no ha podido leer el ajuste de memoria.
					</p>
				) : null}
				{memoryInvalid ? (
					<>
						<p className="settings-error" role="alert">
							{memoryInvalid}. El asistente no está en marcha hasta que esto se corrija: pon la memoria en
							"shared" o "private" en config.json, o elige una aquí.
						</p>
						<div className="shortcut-row">
							<button type="button" disabled={memoryApplying} onClick={() => applyMemory("shared")}>
								Usar memoria compartida
							</button>
							<button type="button" disabled={memoryApplying} onClick={() => applyMemory("private")}>
								Usar memoria privada
							</button>
						</div>
					</>
				) : (
					<label className="shortcut-row">
						<input
							type="checkbox"
							role="switch"
							aria-checked={memory === "private"}
							checked={memory === "private"}
							disabled={memory === undefined || memoryApplying}
							onChange={(event) => applyMemory(event.target.checked ? "private" : "shared")}
						/>
						<span>Memoria privada</span>
					</label>
				)}
				{memoryReason ? (
					<p className="settings-error" role="alert">
						{memoryReason}
					</p>
				) : null}
			</section>

			<section className="provider-section" aria-labelledby="settings-voice-language" hidden={isWindows()}>
				<h3 id="settings-voice-language">Idioma de la voz</h3>
				<p className="muted">
					El idioma en el que escucha el reconocimiento de voz de macOS. El modelo de voz local lo detecta por
					sí solo.
				</p>
				<select
					aria-label="Idioma de la voz"
					value={language}
					onChange={(event) => {
						setLanguage(event.target.value);
						setVoiceLanguage(event.target.value);
					}}
				>
					{VOICE_LANGUAGES.map(([locale, label]) => (
						<option key={locale || "auto"} value={locale}>
							{label}
						</option>
					))}
				</select>
			</section>
		</section>
	);
}
