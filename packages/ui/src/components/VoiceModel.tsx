import { useCallback, useEffect, useState } from "react";
import {
	cancelVoiceModel,
	downloadVoiceModel,
	onVoiceModel,
	removeVoiceModel,
	type VoiceModelEvent,
	type VoiceModelStatus,
	voiceModelStatus,
} from "../voice-native.ts";

/** The archive's size (pinned in the desktop app), shown before anything downloads. */
const DOWNLOAD_BYTES = 487_170_055;

const ENGINES: Record<VoiceModelStatus["engine"], string> = {
	parakeet: "En uso: modelo local (Parakeet), funciona sin conexión",
	apple: "En uso: voz de macOS",
	none: "La entrada de voz necesita el modelo local en este ordenador",
};

/** The chip names the engine that listens now. */
const CHIPS: Record<VoiceModelStatus["engine"], string> = {
	parakeet: "Sin conexión",
	apple: "macOS",
	none: "Apagado",
};

const megabytes = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

type Progress = { kind: "downloading"; percent: number } | { kind: "verifying" };

/** The Voice entry in Connectors (desktop only): which engine listens, and the optional local model. */
export function VoiceModelEntry() {
	const [status, setStatus] = useState<VoiceModelStatus>();
	const [progress, setProgress] = useState<Progress>();
	const [error, setError] = useState<string>();

	const refresh = useCallback(() => {
		voiceModelStatus().then(
			(next) => {
				// An app without the local model support answers nothing usable.
				if (!next || typeof next !== "object" || typeof next.engine !== "string") {
					setStatus(undefined);
					return;
				}
				setStatus(next);
				if (next.downloading) {
					const percent = next.total ? Math.floor(((next.received ?? 0) / next.total) * 100) : 0;
					setProgress({ kind: "downloading", percent });
				}
			},
			() => setStatus(undefined),
		);
	}, []);

	useEffect(() => {
		refresh();
		let stop: (() => void) | undefined;
		let closed = false;
		const handle = (event: VoiceModelEvent) => {
			if (event.state === "downloading") {
				const percent = event.total ? Math.floor(((event.received ?? 0) / event.total) * 100) : 0;
				setError(undefined);
				setProgress({ kind: "downloading", percent });
			} else if (event.state === "verifying") {
				setProgress({ kind: "verifying" });
			} else {
				setProgress(undefined);
				if (event.state === "failed") setError(event.message ?? "La descarga no ha terminado.");
				refresh();
			}
		};
		onVoiceModel(handle).then(
			(unlisten) => {
				if (closed) unlisten();
				else stop = unlisten;
			},
			() => {},
		);
		return () => {
			closed = true;
			stop?.();
		};
	}, [refresh]);

	const act = (action: () => Promise<void>) => {
		setError(undefined);
		action().catch((reason: unknown) => setError(typeof reason === "string" ? reason : String(reason)));
	};

	return (
		<li className="computer-entry" aria-labelledby="connector-voice">
			<div className="provider-name">
				<b id="connector-voice">Voz</b>
				{status ? <span className="chip connector-connected">{CHIPS[status.engine]}</span> : null}
			</div>
			{status ? <p className="connector-note">{ENGINES[status.engine]}</p> : null}
			<p className="connector-note">
				El modelo local (NVIDIA Parakeet) entiende 25 idiomas, incluido el español, y nunca envía tu voz a
				ninguna parte. Es opcional: no se descarga nada hasta que lo pidas.
			</p>
			{progress?.kind === "downloading" ? (
				<div className="voice-model-progress">
					<progress aria-label="Descargando el modelo de voz local" max={100} value={progress.percent} />
					<span>Descargando… {progress.percent}%</span>
					<button type="button" onClick={() => act(cancelVoiceModel)}>
						Cancelar
					</button>
				</div>
			) : progress?.kind === "verifying" ? (
				<p className="connector-note">Comprobando y descomprimiendo…</p>
			) : status?.installed ? (
				<button type="button" onClick={() => act(removeVoiceModel)}>
					Quitar el modelo local ({megabytes(status.bytes ?? 0)})
				</button>
			) : status ? (
				<button type="button" className="primary" onClick={() => act(downloadVoiceModel)}>
					Descargar el modelo de voz local ({megabytes(DOWNLOAD_BYTES)})
				</button>
			) : null}
			{error ? (
				<p className="connector-note voice-model-error" role="alert">
					{error}
				</p>
			) : null}
		</li>
	);
}
