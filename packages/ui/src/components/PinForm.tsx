import { type ClientMessage, type ConnectorInfo, PIN_PATTERN, type PinStatus } from "@gentle-dot/protocol";
import { type ReactNode, useState } from "react";

interface PinFormProps {
	pin: PinStatus;
	/** The submit button's label. */
	action: string;
	/** A valid PIN; `created` when the user just chose it (send `pin_set` first). */
	onPin: (pin: string, created: boolean) => void;
	/** Buttons shown next to the submit button. */
	children?: ReactNode;
}

/**
 * The web PIN on a server (S25.8): a new one is chosen and repeated on first use, then typed before
 * each connector change or allowed action. It goes to the daemon only; the assistant never sees it.
 */
export function PinForm({ pin, action, onPin, children }: PinFormProps) {
	const [value, setValue] = useState("");
	const [repeat, setRepeat] = useState("");
	const [problem, setProblem] = useState<string>();
	const field = (label: string, text: string, set: (v: string) => void) => (
		<input
			aria-label={label}
			type="password"
			inputMode="numeric"
			autoComplete="off"
			placeholder={label}
			value={text}
			onChange={(event) => {
				setProblem(undefined);
				set(event.target.value);
			}}
		/>
	);
	return (
		<form
			className="ask-form pin-form"
			onSubmit={(event) => {
				event.preventDefault();
				if (!PIN_PATTERN.test(value)) return setProblem("Usa de 6 a 12 dígitos.");
				if (!pin.set && repeat !== value) return setProblem("Los dos PIN no coinciden.");
				onPin(value, !pin.set);
				setValue("");
				setRepeat("");
			}}
		>
			{pin.set ? null : (
				<p className="connector-note">
					Elige un PIN de 6 a 12 dígitos. Lo necesitarás para cambiar conectores y para permitir acciones. El
					asistente nunca lo ve.
				</p>
			)}
			{pin.locked ? <p className="connector-note">Demasiados PIN incorrectos. Inténtalo más tarde.</p> : null}
			{pin.set ? field("PIN", value, setValue) : field("Nuevo PIN", value, setValue)}
			{pin.set ? null : field("Repite el PIN", repeat, setRepeat)}
			{problem ? <p role="alert">{problem}</p> : null}
			<button type="submit" className="primary">
				{action}
			</button>
			{children}
		</form>
	);
}

/** What a connector change confirmed with the PIN will do, in the user's words. */
export function describePinCommand(message: ClientMessage, connectors: ConnectorInfo[] = []): string {
	const name = (id: string) => connectors.find((c) => c.id === id)?.name ?? id;
	switch (message.type) {
		case "connector_mode":
			return `¿Cambiar ${name(message.connectorId)} a ${message.mode === "read_write" ? "leer y enviar" : "solo lectura"}?`;
		case "connector_connect":
		case "connector_signin":
		case "connector_setup":
			return `¿Conectar ${name(message.connectorId)}?`;
		case "connector_disconnect":
			return `¿Desconectar ${name(message.connectorId)}?`;
		case "connector_remove":
			return `¿Quitar ${name(message.connectorId)}?`;
		case "connector_draft_reply":
			return "¿Añadir el conector que ha preparado el asistente?";
		case "connector_import":
			return `¿Importar ${message.ids.length} ${message.ids.length === 1 ? "servidor" : "servidores"}?`;
		default:
			return "¿Cambiar tus conectores?";
	}
}
