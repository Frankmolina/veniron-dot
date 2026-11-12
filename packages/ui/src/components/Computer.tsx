import type { ConnectorInfo } from "@gentle-dot/protocol";
import { useCallback, useEffect, useState } from "react";
import {
	type ComputerPermission,
	type ComputerPermissions,
	type ComputerSession,
	type ComputerYolo,
	timeLeft,
} from "../computer.ts";
import { isWindows } from "../shortcut.ts";

/** Computer control in the desktop panel (S24.5, S24.6); the web page never gets it. */
export interface ComputerControls {
	/** The app has a helper (macOS), so the Connectors screen offers it. */
	available: boolean;
	/** The session the user allowed, while it lasts. */
	session?: ComputerSession;
	/** Yolo mode, while it is on (S24.9). */
	yolo?: ComputerYolo;
	stop: () => void;
	/** Asks the app; its native confirmation decides, and the state follows. */
	setYolo: (enabled: boolean) => Promise<unknown>;
	permissions: () => Promise<ComputerPermissions>;
	requestPermission: (kind: ComputerPermission) => Promise<unknown>;
}

const PERMISSIONS: [ComputerPermission, string][] = [
	["accessibility", "Accesibilidad"],
	["screenRecording", "Grabación de pantalla"],
];

export const DEBUG_BUILD_NOTE =
	"Las compilaciones de depuración pierden estos permisos en cada recompilación porque macOS los asocia a la firma de la aplicación; concédelos de nuevo después de actualizar.";
/** Names the panic shortcut only when the app registered it; until it says so, only Stop is promised. */
const yoloNote = (windows: boolean, panicShortcut: boolean) =>
	`El modo yolo permite al asistente enviar, pagar, borrar y confirmar sin preguntarte antes. Se desactiva solo al cabo de 1 hora o al salir de la aplicación; ${panicShortcut ? `Detener y ${windows ? "Alt+Shift+Esc" : "⌥⇧Esc"} siguen funcionando` : "Detener sigue funcionando"}.`;
const WINDOWS_TOO_OLD_NOTE =
	"El control del ordenador necesita Windows 10 versión 2004 (compilación 19041) o posterior para las capturas de pantalla.";
const WINDOWS_UNKNOWN_VERSION_NOTE =
	"VENIRON no puede saber qué versión de Windows es esta, así que el control del ordenador no está disponible: las capturas de pantalla necesitan Windows 10 versión 2004 (compilación 19041) o posterior.";
const NO_IMAGES_NOTE =
	"El modelo actual no acepta imágenes, así que el asistente no puede ver tu pantalla. Elige en Perfiles un modelo que sí las acepte.";

interface ComputerBannerProps {
	session: ComputerSession;
	yolo: boolean;
	stop: () => void;
}

/** "Controlling your Mac · mm:ss left" with a Stop button, while a session is active. */
export function ComputerBanner({ session, yolo, stop }: ComputerBannerProps) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	const left = session.endsAt === undefined ? "" : ` · ${timeLeft(session.endsAt, now)} restantes`;
	return (
		<section className="computer-banner" aria-label="Control del ordenador">
			<span className="computer-banner-light" aria-hidden="true" />
			<span>
				Controlando tu {isWindows() ? "PC" : "Mac"}
				{left}
			</span>
			{yolo ? (
				<span
					className="chip computer-yolo-chip"
					title="Las acciones arriesgadas se ejecutan sin preguntarte antes"
				>
					Yolo
				</span>
			) : null}
			<button type="button" className="primary" onClick={stop}>
				Detener
			</button>
		</section>
	);
}

interface ComputerEntryProps {
	/** The daemon's built-in entry, once the helper is registered. */
	info?: ConnectorInfo;
	controls: ComputerControls;
}

/** The built-in Computer connector: the macOS permissions it needs and how to grant them (Windows asks for none). */
export function ComputerEntry({ info, controls }: ComputerEntryProps) {
	const { permissions, requestPermission, yolo, setYolo } = controls;
	const windows = isWindows();
	const [granted, setGranted] = useState<ComputerPermissions>();
	const check = useCallback(() => {
		permissions().then(setGranted, () => setGranted(undefined));
	}, [permissions]);
	useEffect(check, [check]);

	return (
		<li className="computer-entry" aria-labelledby="connector-computer">
			<div className="provider-name">
				<b id="connector-computer">Ordenador</b>
				<span className="chip connector-connected">Integrado</span>
			</div>
			{info ? (
				<>
					<p className="connector-note">{info.reads}</p>
					<p className="connector-note">{info.sends}</p>
				</>
			) : null}
			{windows ? (
				<p className="connector-note">Windows no pide permiso para el control del ordenador.</p>
			) : null}
			{windows ? null : (
				<ul className="computer-permissions">
					{PERMISSIONS.map(([kind, label]) => {
						const allowed = granted?.[kind] === true;
						const id = `computer-permission-${kind}`;
						return (
							<li key={kind} aria-labelledby={id}>
								<span id={id}>{label}</span>
								<span className={`chip ${allowed ? "connector-connected" : "connector-needs_setup"}`}>
									{granted === undefined ? "Comprobando…" : allowed ? "Permitido" : "No permitido"}
								</span>
								{granted !== undefined && !allowed ? (
									<button
										type="button"
										className="primary"
										aria-label={`Conceder ${label}`}
										onClick={() => {
											requestPermission(kind).then(check, check);
										}}
									>
										Conceder
									</button>
								) : null}
							</li>
						);
					})}
				</ul>
			)}
			{windows ? null : (
				<div className="provider-actions">
					<button type="button" onClick={check}>
						Comprobar de nuevo
					</button>
				</div>
			)}
			{windows && granted?.screenshotsSupported === false ? (
				<p className="connector-note computer-warning">
					{granted.screenshotsUnsupported === "unknownVersion"
						? WINDOWS_UNKNOWN_VERSION_NOTE
						: WINDOWS_TOO_OLD_NOTE}
				</p>
			) : null}
			<div className="computer-yolo">
				<span id="computer-yolo-label">Modo yolo</span>
				<button
					type="button"
					role="switch"
					className="switch"
					aria-checked={yolo !== undefined}
					aria-labelledby="computer-yolo-label"
					onClick={() => {
						setYolo(yolo === undefined).catch(() => {});
					}}
				>
					<span className="switch-knob" aria-hidden="true" />
				</button>
			</div>
			<p className="connector-note">{yoloNote(windows, granted?.panicShortcut === true)}</p>
			{windows ? null : <p className="connector-note">{DEBUG_BUILD_NOTE}</p>}
			{info?.noImages ? <p className="connector-note computer-warning">{NO_IMAGES_NOTE}</p> : null}
		</li>
	);
}
