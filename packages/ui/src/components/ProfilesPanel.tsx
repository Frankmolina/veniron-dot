import {
	type AuthProvider,
	isValidProfileName,
	type ModelOption,
	type Profile,
	type ProfileRole,
	type ProfileRoles,
	type RoleRoute,
	THINKING_LEVELS,
	type ThinkingLevel,
} from "@gentle-dot/protocol";
import { type FormEvent, useState } from "react";
import type { DotAction, ProfilesState } from "../store.ts";
import type { Send } from "./types.ts";
import "../profiles.css";

interface ProfilesPanelProps {
	profiles: ProfilesState;
	/** Account names, used to label model groups. */
	providers?: AuthProvider[];
	send: Send;
	dispatch: (action: DotAction) => void;
}

type Mode =
	| { kind: "list" }
	| { kind: "edit"; profile?: Profile }
	| { kind: "name"; action: "rename" | "duplicate" | "save_current"; from?: string }
	| { kind: "delete"; name: string };

const THINKING_LABELS: Record<ThinkingLevel, string> = {
	off: "Desactivado",
	minimal: "Mínimo",
	low: "Bajo",
	medium: "Medio",
	high: "Alto",
	xhigh: "Muy alto",
	max: "Máximo",
};

const NAME_HINT =
	"Usa letras, números, puntos, guiones o guiones bajos (hasta 64) y que empiece por una letra o un número.";

/** Names a profile, or explains why the name cannot be used. */
function nameProblem(name: string, taken: string[]): string | undefined {
	if (!name) return undefined;
	if (!isValidProfileName(name)) return NAME_HINT;
	if (taken.includes(name)) return "Ya existe un perfil con ese nombre.";
	return undefined;
}

/** Profiles pick the model each part of the assistant uses; managed here without a terminal. */
export function ProfilesPanel({ profiles, providers = [], send, dispatch }: ProfilesPanelProps) {
	const [mode, setMode] = useState<Mode>({ kind: "list" });
	const list = profiles.list ?? [];
	const names = list.map((p) => p.name);
	const back = () => setMode({ kind: "list" });

	return (
		<section className="profiles" aria-label="Perfiles">
			<header className="profiles-header">
				<h2>Perfiles</h2>
				<button
					type="button"
					className="icon"
					aria-label="Cerrar perfiles"
					onClick={() => dispatch({ type: "profiles", open: false })}
				>
					×
				</button>
			</header>

			{mode.kind === "edit" ? (
				<ProfileEditor
					profile={mode.profile}
					roles={profiles.roles}
					models={profiles.models}
					providers={providers}
					taken={names}
					onCancel={back}
					onSave={(name, roles) => {
						send({ type: "profile_save", name, roles });
						back();
					}}
				/>
			) : mode.kind === "name" ? (
				<NameForm
					mode={mode}
					taken={names}
					onCancel={back}
					onSubmit={(name) => {
						const from = mode.from ?? "";
						if (mode.action === "save_current") send({ type: "profile_save_current", name });
						else if (mode.action === "rename") send({ type: "profile_rename", from, to: name });
						else send({ type: "profile_duplicate", from, to: name });
						back();
					}}
				/>
			) : (
				<>
					<p className="muted">
						Un perfil elige el modelo de IA que usa cada parte del asistente. Cambia de perfil cuando quieras.
					</p>
					{profiles.lastImport ? (
						<ImportResult
							result={profiles.lastImport}
							openAccounts={() => {
								send({ type: "auth_list" });
								dispatch({ type: "accounts", open: true });
							}}
						/>
					) : null}
					{profiles.list === undefined ? <p className="muted">Cargando…</p> : null}
					{profiles.list?.length === 0 ? <p className="muted">Aún no hay perfiles.</p> : null}
					<ul className="profile-list">
						{list.map((profile) => {
							const inUse = profile.name === profiles.active;
							const deleting = mode.kind === "delete" && mode.name === profile.name;
							return (
								<li key={profile.name} className={inUse ? "in-use" : undefined}>
									<div className="profile-name">
										<b>{profile.name}</b>
										{inUse ? <span className="chip ok">En uso</span> : null}
									</div>
									<p className="profile-summary">{summary(profile, profiles.roles, profiles.models)}</p>
									{deleting ? (
										<div className="profile-confirm" role="alertdialog" aria-label="Eliminar perfil">
											<p>{`¿Eliminar «${profile.name}»? Esto no se puede deshacer.`}</p>
											<button
												type="button"
												className="primary danger"
												onClick={() => {
													send({ type: "profile_delete", name: profile.name });
													back();
												}}
											>
												Eliminar
											</button>
											<button type="button" onClick={back}>
												Conservarlo
											</button>
										</div>
									) : (
										<div className="profile-actions">
											{inUse ? null : (
												<button
													type="button"
													className="primary"
													onClick={() => send({ type: "profile_apply", name: profile.name })}
												>
													Usar
												</button>
											)}
											<button type="button" onClick={() => setMode({ kind: "edit", profile })}>
												Editar
											</button>
											<button
												type="button"
												onClick={() => setMode({ kind: "name", action: "duplicate", from: profile.name })}
											>
												Duplicar
											</button>
											<button
												type="button"
												onClick={() => setMode({ kind: "name", action: "rename", from: profile.name })}
											>
												Renombrar
											</button>
											<button
												type="button"
												className="link"
												disabled={inUse}
												title={inUse ? "Cambia a otro perfil antes de eliminar este." : undefined}
												onClick={() => setMode({ kind: "delete", name: profile.name })}
											>
												Eliminar
											</button>
										</div>
									)}
								</li>
							);
						})}
					</ul>
					<div className="profiles-footer">
						<button type="button" className="primary" onClick={() => setMode({ kind: "edit" })}>
							Nuevo perfil
						</button>
						<button type="button" onClick={() => setMode({ kind: "name", action: "save_current" })}>
							Guardar mi configuración actual
						</button>
						{profiles.importable ? (
							<button type="button" onClick={() => send({ type: "profile_import" })}>
								Importar mis perfiles de Gentle Shell
							</button>
						) : null}
					</div>
				</>
			)}
		</section>
	);
}

function modelLabel(model: string | undefined, models: ModelOption[]): string {
	if (!model) return "Predeterminado";
	return models.find((m) => `${m.provider}/${m.id}` === model)?.name ?? model;
}

/** One line per routed role the screen knows, for example "Main assistant: Fake Model · High". */
function summary(profile: Profile, roles: ProfileRole[], models: ModelOption[]): string {
	const lines = roles.flatMap((role) => {
		const route = profile.roles[role.id];
		if (!route) return [];
		const thinking = route.thinking ? ` · ${THINKING_LABELS[route.thinking]}` : "";
		return [`${role.label}: ${modelLabel(route.model, models)}${thinking}`];
	});
	return lines.length > 0 ? lines.join(", ") : "Usa el modelo predeterminado en todas partes.";
}

function ProfileEditor({
	profile,
	roles,
	models,
	providers,
	taken,
	onSave,
	onCancel,
}: {
	profile?: Profile;
	roles: ProfileRole[];
	models: ModelOption[];
	providers: AuthProvider[];
	taken: string[];
	onSave: (name: string, roles: ProfileRoles) => void;
	onCancel: () => void;
}) {
	const [name, setName] = useState("");
	// Starts from every saved route, so roles this screen does not show are kept.
	const [routes, setRoutes] = useState<ProfileRoles>(() => structuredClone(profile?.roles ?? {}));
	const problem = profile ? undefined : nameProblem(name, taken);
	const valid = profile !== undefined || (name !== "" && problem === undefined);
	const groups = new Map<string, ModelOption[]>();
	for (const model of models) groups.set(model.provider, [...(groups.get(model.provider) ?? []), model]);
	const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? id;

	const update = (role: string, change: Partial<RoleRoute>) =>
		setRoutes((current) => {
			const next: RoleRoute = { ...current[role], ...change };
			if (!next.model) delete next.model;
			if (!next.thinking) delete next.thinking;
			const { [role]: _removed, ...others } = current;
			return next.model || next.thinking ? { ...current, [role]: next } : others;
		});

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (valid) onSave(profile?.name ?? name, routes);
	};

	return (
		<form
			className="profile-editor"
			aria-label={profile ? `Editar ${profile.name}` : "Nuevo perfil"}
			onSubmit={submit}
		>
			{profile ? (
				<h3>{profile.name}</h3>
			) : (
				<label className="profile-field">
					<span>Nombre</span>
					<input
						type="text"
						aria-label="Nombre del perfil"
						autoComplete="off"
						placeholder="por ejemplo trabajo-profundo"
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
					{problem ? <small className="profile-problem">{problem}</small> : null}
				</label>
			)}
			<div className="role-routes">
				{roles.map((role) => {
					const route = routes[role.id] ?? {};
					const known = !route.model || models.some((m) => `${m.provider}/${m.id}` === route.model);
					return (
						<div className="role-route" key={role.id}>
							<span className="role-label">{role.label}</span>
							<select
								aria-label={`${role.label} modelo`}
								value={route.model ?? ""}
								onChange={(event) => update(role.id, { model: event.target.value })}
							>
								<option value="">Predeterminado</option>
								{[...groups].map(([provider, options]) => (
									<optgroup key={provider} label={providerName(provider)}>
										{options.map((m) => (
											<option key={m.id} value={`${m.provider}/${m.id}`}>
												{m.name}
											</option>
										))}
									</optgroup>
								))}
								{known ? null : <option value={route.model}>{`${route.model} (no disponible)`}</option>}
							</select>
							<select
								aria-label={`${role.label} razonamiento`}
								value={route.thinking ?? ""}
								onChange={(event) =>
									update(role.id, {
										thinking: (event.target.value || undefined) as ThinkingLevel | undefined,
									})
								}
							>
								<option value="">Predeterminado</option>
								{THINKING_LEVELS.map((level) => (
									<option key={level} value={level}>
										{THINKING_LABELS[level]}
									</option>
								))}
							</select>
						</div>
					);
				})}
			</div>
			<div className="profile-form-actions">
				<button type="submit" className="primary" disabled={!valid}>
					Guardar
				</button>
				<button type="button" onClick={onCancel}>
					Cancelar
				</button>
			</div>
		</form>
	);
}

const NAME_FORMS = {
	rename: { label: "Nuevo nombre", submit: "Renombrar" },
	duplicate: { label: "Nombre de la copia", submit: "Duplicar" },
	save_current: { label: "Nombre para tu configuración actual", submit: "Guardar" },
} as const;

function NameForm({
	mode,
	taken,
	onSubmit,
	onCancel,
}: {
	mode: Extract<Mode, { kind: "name" }>;
	taken: string[];
	onSubmit: (name: string) => void;
	onCancel: () => void;
}) {
	const initial = mode.action === "duplicate" ? `${mode.from}-copia` : (mode.from ?? "");
	const [name, setName] = useState(initial);
	const text = NAME_FORMS[mode.action];
	const problem = name === mode.from ? undefined : nameProblem(name, taken);
	const valid = name !== "" && name !== mode.from && problem === undefined;
	return (
		<form
			className="profile-editor"
			aria-label={text.label}
			onSubmit={(event) => {
				event.preventDefault();
				if (valid) onSubmit(name);
			}}
		>
			<label className="profile-field">
				<span>{text.label}</span>
				<input
					type="text"
					aria-label={text.label}
					autoComplete="off"
					value={name}
					onChange={(event) => setName(event.target.value)}
				/>
				{problem ? <small className="profile-problem">{problem}</small> : null}
			</label>
			<div className="profile-form-actions">
				<button type="submit" className="primary" disabled={!valid}>
					{text.submit}
				</button>
				<button type="button" onClick={onCancel}>
					Cancelar
				</button>
			</div>
		</form>
	);
}

function ImportResult({
	result,
	openAccounts,
}: {
	result: NonNullable<ProfilesState["lastImport"]>;
	openAccounts: () => void;
}) {
	const renamed = result.imported.filter((i) => i.from !== i.to);
	const count = result.imported.length;
	return (
		<div className="profiles-import" role="status">
			<p>
				{count === 0
					? "Nada nuevo que importar."
					: `Se ha${count === 1 ? "" : "n"} importado ${count} perfil${count === 1 ? "" : "es"}.`}
			</p>
			{renamed.length > 0 ? (
				<p>{`Se ha cambiado el nombre porque ya existía: ${renamed.map((r) => `${r.from} → ${r.to}`).join(", ")}.`}</p>
			) : null}
			{result.missingProviders.length > 0 ? (
				<p>
					{`Conecta estas cuentas para usarlas: ${result.missingProviders.join(", ")}. `}
					<button type="button" className="link" onClick={openAccounts}>
						Abrir cuentas
					</button>
				</p>
			) : null}
		</div>
	);
}
