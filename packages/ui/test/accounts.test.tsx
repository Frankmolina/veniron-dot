import type { ServerMessage, ServerPayload } from "@gentle-dot/protocol";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountsPanel } from "../src/components/AccountsPanel.tsx";
import { ChatSurface } from "../src/components/ChatSurface.tsx";
import { type DotState, initialState, reduce } from "../src/store.ts";

const providers = [
	{
		id: "anthropic",
		name: "Anthropic",
		methods: ["oauth", "api_key"] as const,
		oauthName: "Claude Pro/Max",
		configured: false,
	},
	{ id: "openai", name: "OpenAI", methods: ["api_key"] as const, configured: true, source: "stored" },
].map((p) => ({ ...p, methods: [...p.methods] }));

function apply(state: DotState, ...payloads: ServerPayload[]): DotState {
	return payloads.reduce(
		(s, p) => reduce(s, { type: "server", message: { ...p, seq: 1 } as ServerMessage }),
		state,
	);
}

function base(): DotState {
	return apply(
		{ ...initialState, connection: "open", agentState: "idle" },
		{ type: "auth_providers", providers },
	);
}

describe("auth state", () => {
	it("opens the accounts screen when the server asks (/login)", () => {
		const s = apply(base(), { type: "auth_providers", providers, open: true });
		expect(s.auth.open).toBe(true);
	});

	it("tracks one flow: started, link, prompt, and result", () => {
		let s = reduce(base(), { type: "auth_started", providerId: "anthropic" });
		expect(s.auth.flow).toMatchObject({ providerId: "anthropic", events: [] });
		s = apply(
			s,
			{ type: "auth_event", flowId: "f1", event: { kind: "auth_url", url: "https://example.com/a" } },
			{ type: "auth_prompt", prompt: { flowId: "f1", kind: "manual_code", message: "Paste the code" } },
		);
		expect(s.auth.flow).toMatchObject({ flowId: "f1", prompt: { kind: "manual_code" } });
		s = apply(s, { type: "auth_done", flowId: "f1", providerId: "anthropic", ok: true });
		expect(s.auth.flow).toMatchObject({ done: { ok: true } });
		expect(s.auth.flow?.prompt).toBeUndefined();
	});

	it("goes back to the provider list after a finished sign-in", () => {
		let s = reduce(base(), { type: "auth_started", providerId: "anthropic" });
		s = apply(s, { type: "auth_done", flowId: "f1", providerId: "anthropic", ok: true });
		s = reduce(s, { type: "accounts", open: true });
		expect(s.auth).toMatchObject({ open: true, flow: undefined });
	});

	it("keeps a running sign-in when the accounts screen is reopened", () => {
		let s = reduce(base(), { type: "auth_started", providerId: "anthropic" });
		s = reduce(s, { type: "accounts", open: true });
		expect(s.auth.flow?.providerId).toBe("anthropic");
	});
});

describe("AccountsPanel", () => {
	const mixed = () =>
		apply(base(), {
			type: "auth_providers",
			providers: [
				{ id: "anthropic", name: "Anthropic", methods: ["api_key"], configured: false },
				{
					id: "github-copilot",
					name: "GitHub Copilot",
					methods: ["oauth"],
					oauthName: "GitHub Copilot",
					configured: false,
				},
				{
					id: "openai-codex",
					name: "OpenAI Codex",
					methods: ["oauth"],
					oauthName: "OpenAI (ChatGPT Plus/Pro)",
					configured: false,
				},
				{ id: "openai", name: "OpenAI", methods: ["api_key"], configured: true, source: "stored" },
			],
		}).auth;

	it("returns to the method choice after a finished sign-in", async () => {
		const dispatch = vi.fn();
		const { rerender } = render(
			<AccountsPanel auth={mixed()} send={vi.fn()} dispatch={dispatch} openUrl={vi.fn()} />,
		);
		await userEvent.click(screen.getByRole("button", { name: /Usar una clave de API/ }));
		let s = reduce({ ...base(), auth: mixed() }, { type: "auth_started", providerId: "openai" });
		s = apply(s, { type: "auth_done", flowId: "f1", providerId: "openai", ok: true });
		rerender(<AccountsPanel auth={s.auth} send={vi.fn()} dispatch={dispatch} openUrl={vi.fn()} />);
		await userEvent.click(screen.getByRole("button", { name: "Volver a las cuentas" }));
		expect(dispatch).toHaveBeenCalledWith({ type: "accounts", open: true });
		rerender(
			<AccountsPanel
				auth={reduce(s, { type: "accounts", open: true }).auth}
				send={vi.fn()}
				dispatch={dispatch}
				openUrl={vi.fn()}
			/>,
		);
		expect(screen.getByRole("button", { name: /Usar una suscripción/ })).toBeInTheDocument();
	});

	it("asks for the method first, like Pi's /login", () => {
		render(<AccountsPanel auth={mixed()} send={vi.fn()} dispatch={vi.fn()} openUrl={vi.fn()} />);
		expect(screen.getByRole("button", { name: /Usar una suscripción/ })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Usar una clave de API/ })).toBeInTheDocument();
		expect(screen.queryByRole("searchbox")).toBeNull();
		expect(screen.queryByText("GitHub Copilot")).toBeNull();
	});

	it("shows connected accounts on the first step and signs out", async () => {
		const send = vi.fn();
		render(<AccountsPanel auth={mixed()} send={send} dispatch={vi.fn()} openUrl={vi.fn()} />);
		const connected = screen.getByRole("region", { name: "Conectadas" });
		expect(within(connected).getByText("OpenAI")).toBeInTheDocument();
		await userEvent.click(within(connected).getByRole("button", { name: "Cerrar sesión de OpenAI" }));
		expect(send).toHaveBeenCalledWith({ type: "auth_logout", providerId: "openai" });
	});

	it("lists only subscriptions after choosing a subscription, named like Pi's account list", async () => {
		const send = vi.fn();
		const dispatch = vi.fn();
		render(<AccountsPanel auth={mixed()} send={send} dispatch={dispatch} openUrl={vi.fn()} />);
		await userEvent.click(screen.getByRole("button", { name: /Usar una suscripción/ }));
		const list = screen.getByRole("region", { name: "Usar una suscripción" });
		expect(
			within(list)
				.getAllByRole("button", { name: /^Iniciar sesión con/ })
				.map((b) => b.getAttribute("aria-label")),
		).toEqual(["Iniciar sesión con GitHub Copilot", "Iniciar sesión con OpenAI (ChatGPT Plus/Pro)"]);
		expect(within(list).getByText("OpenAI Codex")).toBeInTheDocument();
		expect(within(list).getByText("OpenAI (ChatGPT Plus/Pro)")).toHaveClass("provider-plan");
		expect(within(list).queryByText("Anthropic")).toBeNull();
		await userEvent.click(within(list).getByRole("button", { name: "Iniciar sesión con GitHub Copilot" }));
		expect(dispatch).toHaveBeenCalledWith({ type: "auth_started", providerId: "github-copilot" });
		expect(send).toHaveBeenCalledWith({ type: "auth_login", providerId: "github-copilot", method: "oauth" });
	});

	it("lists API keys after choosing an API key, with search and a way back", async () => {
		const send = vi.fn();
		render(<AccountsPanel auth={mixed()} send={send} dispatch={vi.fn()} openUrl={vi.fn()} />);
		await userEvent.click(screen.getByRole("button", { name: /Usar una clave de API/ }));
		const list = screen.getByRole("region", { name: "Usar una clave de API" });
		expect(within(list).getByText("Anthropic")).toBeInTheDocument();
		expect(within(list).queryByText("GitHub Copilot")).toBeNull();
		await userEvent.type(screen.getByRole("searchbox", { name: "Buscar proveedores" }), "open");
		expect(within(list).queryByText("Anthropic")).toBeNull();
		await userEvent.click(within(list).getByRole("button", { name: "Usar una clave de API para OpenAI" }));
		expect(send).toHaveBeenCalledWith({ type: "auth_login", providerId: "openai", method: "api_key" });
		await userEvent.click(screen.getByRole("button", { name: "Atrás" }));
		expect(screen.getByRole("button", { name: /Usar una suscripción/ })).toBeInTheDocument();
	});

	it("opens the sign-in page, takes the pasted code, and can cancel", async () => {
		const send = vi.fn();
		const openUrl = vi.fn();
		let s = reduce(base(), { type: "auth_started", providerId: "anthropic" });
		s = apply(
			s,
			{
				type: "auth_event",
				flowId: "f1",
				event: { kind: "auth_url", url: "https://example.com/a", instructions: "Sign in" },
			},
			{
				type: "auth_prompt",
				prompt: { flowId: "f1", kind: "manual_code", message: "Paste the code", placeholder: "code" },
			},
		);
		render(<AccountsPanel auth={s.auth} send={send} dispatch={vi.fn()} openUrl={openUrl} />);
		await userEvent.click(screen.getByRole("button", { name: "Abrir la página de inicio de sesión" }));
		expect(openUrl).toHaveBeenCalledWith("https://example.com/a");
		await userEvent.type(screen.getByPlaceholderText("code"), "abc123");
		await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
		expect(send).toHaveBeenCalledWith({ type: "auth_reply", flowId: "f1", value: "abc123" });
		await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
		expect(send).toHaveBeenLastCalledWith({ type: "auth_reply", flowId: "f1", cancelled: true });
	});

	it("hides a secret while typing and shows a device code to copy", () => {
		let s = reduce(base(), { type: "auth_started", providerId: "openai" });
		s = apply(
			s,
			{
				type: "auth_event",
				flowId: "f2",
				event: { kind: "device_code", userCode: "ABCD-1234", verificationUri: "https://example.com/device" },
			},
			{ type: "auth_prompt", prompt: { flowId: "f2", kind: "secret", message: "Enter your API key" } },
		);
		render(<AccountsPanel auth={s.auth} send={vi.fn()} dispatch={vi.fn()} openUrl={vi.fn()} />);
		expect(screen.getByText("ABCD-1234")).toBeInTheDocument();
		expect(screen.getByLabelText("Enter your API key")).toHaveAttribute("type", "password");
	});

	it("answers a choice prompt with the option id", async () => {
		const send = vi.fn();
		let s = reduce(base(), { type: "auth_started", providerId: "anthropic" });
		s = apply(s, {
			type: "auth_prompt",
			prompt: {
				flowId: "f3",
				kind: "select",
				message: "Choose a plan",
				options: [{ id: "max", label: "Max" }],
			},
		});
		render(<AccountsPanel auth={s.auth} send={send} dispatch={vi.fn()} openUrl={vi.fn()} />);
		await userEvent.click(screen.getByRole("button", { name: "Max" }));
		expect(send).toHaveBeenCalledWith({ type: "auth_reply", flowId: "f3", value: "max" });
	});

	it("reports the result in plain words", () => {
		let s = reduce(base(), { type: "auth_started", providerId: "anthropic" });
		s = apply(s, { type: "auth_done", flowId: "f1", providerId: "anthropic", ok: true });
		const { rerender } = render(
			<AccountsPanel auth={s.auth} send={vi.fn()} dispatch={vi.fn()} openUrl={vi.fn()} />,
		);
		expect(screen.getByRole("status")).toHaveTextContent("Conectado a Anthropic.");
		s = apply(reduce(base(), { type: "auth_started", providerId: "anthropic" }), {
			type: "auth_done",
			flowId: "f9",
			providerId: "anthropic",
			ok: false,
			message: "Sign-in cancelled.",
		});
		rerender(<AccountsPanel auth={s.auth} send={vi.fn()} dispatch={vi.fn()} openUrl={vi.fn()} />);
		expect(screen.getByRole("status")).toHaveTextContent("Sign-in cancelled.");
	});
});

describe("ChatSurface onboarding", () => {
	it("asks to connect an account when none is configured", async () => {
		const dispatch = vi.fn();
		const s = apply(
			{ ...initialState, connection: "open", agentState: "idle" },
			{ type: "auth_providers", providers: providers.map((p) => ({ ...p, configured: false })) },
		);
		render(<ChatSurface variant="web" state={s} send={vi.fn()} dismiss={vi.fn()} dispatch={dispatch} />);
		await userEvent.click(screen.getByRole("button", { name: "Conectar una cuenta de IA" }));
		expect(dispatch).toHaveBeenCalledWith({ type: "accounts", open: true });
	});

	it("puts the banner in the chat, above the first message, not over it", () => {
		const s = apply(
			{ ...initialState, connection: "open", agentState: "idle" },
			{ type: "auth_providers", providers: providers.map((p) => ({ ...p, configured: false })) },
			{ type: "user_message", messageId: "u1", text: "hello" },
		);
		const { container } = render(
			<ChatSurface variant="web" state={s} send={vi.fn()} dismiss={vi.fn()} dispatch={vi.fn()} />,
		);
		const banner = container.querySelector(".onboarding");
		const first = screen.getByText("hello");
		const chat = banner?.closest("main.chat-body");
		expect(chat).not.toBeNull();
		expect(chat?.contains(first)).toBe(true);
		expect(banner && banner.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it("opens accounts from the header", async () => {
		const dispatch = vi.fn();
		const send = vi.fn();
		render(<ChatSurface variant="web" state={base()} send={send} dismiss={vi.fn()} dispatch={dispatch} />);
		await userEvent.click(screen.getByRole("button", { name: "Cuentas" }));
		expect(dispatch).toHaveBeenCalledWith({ type: "accounts", open: true });
		expect(send).toHaveBeenCalledWith({ type: "auth_list" });
	});
});
