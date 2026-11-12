import type { AuthEvent, AuthPrompt, AuthProvider } from "@gentle-dot/protocol";
import { type ReactNode, useState } from "react";
import type { AuthState, DotAction } from "../store.ts";
import "../accounts.css";
import type { Send } from "./types.ts";

interface AccountsPanelProps {
	auth: AuthState;
	send: Send;
	dispatch: (action: DotAction) => void;
	openUrl: (url: string) => void;
}

/** Sign-in for subscriptions and API keys, without a terminal. */
export function AccountsPanel({ auth, send, dispatch, openUrl }: AccountsPanelProps) {
	const [filter, setFilter] = useState("");
	const [method, setMethod] = useState<"oauth" | "api_key" | undefined>(undefined);
	const flow = auth.flow;
	const busy = flow !== undefined && flow.done === undefined;
	const login = (provider: AuthProvider, method: "oauth" | "api_key") => {
		dispatch({ type: "auth_started", providerId: provider.id });
		send({ type: "auth_login", providerId: provider.id, method });
	};
	const providers = (auth.providers ?? []).filter((p) =>
		p.name.toLowerCase().includes(filter.trim().toLowerCase()),
	);
	const connected = (auth.providers ?? []).filter((p) => p.configured);
	const providerName = (id: string) => auth.providers?.find((p) => p.id === id)?.name ?? id;

	return (
		<section className="accounts" aria-label="Cuentas">
			<header className="accounts-header">
				<h2>Cuentas</h2>
				<button
					type="button"
					className="icon"
					aria-label="Cerrar cuentas"
					onClick={() => dispatch({ type: "accounts", open: false })}
				>
					×
				</button>
			</header>
			<p className="muted">
				Conecta el servicio de IA que ya pagas, o pega una clave de API. Tu inicio de sesión se queda en este
				ordenador.
			</p>

			{flow ? (
				<div className="auth-flow">
					<p className="auth-flow-title">Iniciando sesión en {providerName(flow.providerId)}</p>
					{flow.events.map((event, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: events are append-only and never reordered
						<FlowEvent key={`${event.kind}-${i}`} event={event} openUrl={openUrl} />
					))}
					{flow.prompt ? <FlowPrompt key={flow.prompt.message} prompt={flow.prompt} send={send} /> : null}
					{busy && !flow.prompt && flow.events.length === 0 ? <p className="muted">Iniciando…</p> : null}
					{flow.done ? (
						<p className={`auth-result ${flow.done.ok ? "ok" : "failed"}`} role="status">
							{flow.done.ok
								? `Conectado a ${providerName(flow.providerId)}.`
								: (flow.done.message ?? "El inicio de sesión no ha terminado.")}
						</p>
					) : null}
					<div className="auth-actions">
						{busy && flow.flowId ? (
							<button
								type="button"
								onClick={() => send({ type: "auth_reply", flowId: flow.flowId ?? "", cancelled: true })}
							>
								Cancelar
							</button>
						) : null}
						{flow.done ? (
							<button
								type="button"
								onClick={() => {
									setMethod(undefined);
									setFilter("");
									dispatch({ type: "accounts", open: true });
								}}
							>
								Volver a las cuentas
							</button>
						) : null}
					</div>
				</div>
			) : method === undefined ? (
				<>
					{connected.length > 0 ? (
						<section className="provider-section" aria-labelledby="accounts-connected">
							<h3 id="accounts-connected">Conectadas</h3>
							<ul className="providers">
								{connected.map((provider) => (
									<li key={provider.id} className="connected-row">
										<b>{provider.name}</b>
										{provider.source === "stored" ? (
											<button
												type="button"
												className="link"
												aria-label={`Cerrar sesión de ${provider.name}`}
												onClick={() => send({ type: "auth_logout", providerId: provider.id })}
											>
												Cerrar sesión
											</button>
										) : (
											<span className="muted">desde los ajustes de tu ordenador</span>
										)}
									</li>
								))}
							</ul>
						</section>
					) : null}
					<div className="method-choices">
						<button type="button" className="method-choice" onClick={() => setMethod("oauth")}>
							<b>Usar una suscripción</b>
							<span>Inicia sesión con un plan que ya pagas, como ChatGPT, GitHub Copilot o Grok.</span>
						</button>
						<button type="button" className="method-choice" onClick={() => setMethod("api_key")}>
							<b>Usar una clave de API</b>
							<span>Pega una clave de la web del proveedor. Funciona con todos los servicios.</span>
						</button>
					</div>
				</>
			) : (
				<>
					<button
						type="button"
						className="link back"
						onClick={() => {
							setMethod(undefined);
							setFilter("");
						}}
					>
						Atrás
					</button>
					<input
						type="search"
						className="accounts-search"
						aria-label="Buscar proveedores"
						placeholder="Buscar proveedores"
						value={filter}
						onChange={(event) => setFilter(event.target.value)}
					/>
					{method === "oauth" ? (
						<ProviderSection
							title="Usar una suscripción"
							hint="Inicia sesión con un plan que ya pagas."
							providers={providers.filter((p) => p.methods.includes("oauth"))}
							label={(p) => p.name}
							plan={(p) => (p.oauthName && p.oauthName !== p.name ? p.oauthName : undefined)}
							action={(p) => (
								<button
									type="button"
									className="primary"
									aria-label={`Iniciar sesión con ${p.oauthName ?? p.name}`}
									onClick={() => login(p, "oauth")}
								>
									Iniciar sesión
								</button>
							)}
							send={send}
						/>
					) : (
						<ProviderSection
							title="Usar una clave de API"
							hint="Pega la clave de la web del proveedor."
							providers={providers.filter((p) => p.methods.includes("api_key"))}
							label={(p) => p.name}
							action={(p) => (
								<button
									type="button"
									aria-label={`Usar una clave de API para ${p.name}`}
									onClick={() => login(p, "api_key")}
								>
									Usar una clave de API
								</button>
							)}
							send={send}
						/>
					)}
				</>
			)}
		</section>
	);
}

interface ProviderSectionProps {
	title: string;
	hint: string;
	providers: AuthProvider[];
	label: (provider: AuthProvider) => string;
	/** A second line under the name, for example the subscription plan. */
	plan?: (provider: AuthProvider) => string | undefined;
	action: (provider: AuthProvider) => ReactNode;
	send: Send;
}

function ProviderSection({ title, hint, providers, label, plan, action, send }: ProviderSectionProps) {
	if (providers.length === 0) return null;
	const id = `providers-${title.toLowerCase().replace(/\W+/g, "-")}`;
	return (
		<section className="provider-section" aria-labelledby={id}>
			<h3 id={id}>{title}</h3>
			<p className="muted">{hint}</p>
			<ul className="providers">
				{providers.map((provider) => (
					<li key={provider.id}>
						<div className="provider-name">
							<b>{label(provider)}</b>
							{provider.configured ? <span className="chip ok">Conectado</span> : null}
						</div>
						{plan?.(provider) ? <p className="provider-plan">{plan(provider)}</p> : null}
						<div className="provider-actions">
							{action(provider)}
							{provider.configured && provider.source === "stored" ? (
								<button
									type="button"
									className="link"
									onClick={() => send({ type: "auth_logout", providerId: provider.id })}
								>
									Cerrar sesión
								</button>
							) : null}
						</div>
					</li>
				))}
			</ul>
		</section>
	);
}

export function FlowEvent({ event, openUrl }: { event: AuthEvent; openUrl: (url: string) => void }) {
	switch (event.kind) {
		case "auth_url":
			return (
				<div className="auth-step">
					<p>{event.instructions ?? "Termina el inicio de sesión en la página del proveedor."}</p>
					<button type="button" className="primary" onClick={() => openUrl(event.url)}>
						Abrir la página de inicio de sesión
					</button>
				</div>
			);
		case "device_code":
			return (
				<div className="auth-step">
					<p>Abre la página de abajo e introduce este código:</p>
					<code className="device-code">{event.userCode}</code>
					<button type="button" className="primary" onClick={() => openUrl(event.verificationUri)}>
						Abrir la página
					</button>
				</div>
			);
		case "info":
		case "progress":
			return <p className="muted">{event.message}</p>;
	}
}

export function FlowPrompt({ prompt, send }: { prompt: AuthPrompt; send: Send }) {
	const [value, setValue] = useState("");
	const answer = (text: string) => send({ type: "auth_reply", flowId: prompt.flowId, value: text });
	if (prompt.kind === "select") {
		return (
			<div className="auth-step">
				<p>{prompt.message}</p>
				<div className="ask-options">
					{(prompt.options ?? []).map((option) => (
						<button
							key={option.id}
							type="button"
							title={option.description}
							onClick={() => answer(option.id)}
						>
							{option.label}
						</button>
					))}
				</div>
			</div>
		);
	}
	return (
		<form
			className="auth-step ask-form"
			onSubmit={(event) => {
				event.preventDefault();
				if (value.trim()) answer(value.trim());
			}}
		>
			<label>
				<span>{prompt.message}</span>
				<input
					type={prompt.kind === "secret" ? "password" : "text"}
					autoComplete="off"
					placeholder={
						prompt.placeholder ??
						(prompt.kind === "manual_code" ? "Pega aquí el código o la dirección completa" : "")
					}
					value={value}
					onChange={(event) => setValue(event.target.value)}
				/>
			</label>
			<button type="submit" className="primary" disabled={!value.trim()}>
				Continuar
			</button>
			{prompt.optional ? (
				<button type="button" onClick={() => answer("")}>
					Omitir
				</button>
			) : null}
		</form>
	);
}
