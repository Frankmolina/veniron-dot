import type { ClientMessage, ServerMessage, ServerPayload } from "@gentle-dot/protocol";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useReducer } from "react";
import { describe, expect, it, vi } from "vitest";
import { ChatSurface } from "../src/components/ChatSurface.tsx";
import { type DotState, initialState, reduce } from "../src/store.ts";

function apply(state: DotState, ...payloads: ServerPayload[]): DotState {
	return payloads.reduce(
		(s, p) => reduce(s, { type: "server", message: { ...p, seq: 1 } as ServerMessage }),
		state,
	);
}

const providers = [{ id: "openai", name: "OpenAI", methods: ["api_key" as const], configured: true }];

const ready = apply(
	// The conversations list is on here; single-chat.test.tsx covers the default header.
	{ ...initialState, connection: "open", agentState: "idle", features: { conversations: true } },
	{ type: "auth_providers", providers },
	{ type: "profiles", profiles: [{ name: "daily", roles: {} }], roles: [], models: [], importable: false },
);

/** ChatSurface wired to the real reducer, so opening and closing actually happen. */
function Harness({ initial, send }: { initial: DotState; send: (m: ClientMessage) => void }) {
	const [state, dispatch] = useReducer(reduce, initial);
	return (
		<ChatSurface
			variant="panel"
			state={state}
			send={send}
			dismiss={vi.fn()}
			dispatch={dispatch}
			onHide={vi.fn()}
		/>
	);
}

const box = () => screen.getByRole("textbox", { name: "Mensaje" });

describe("header icons", () => {
	it("uses one set of 18 px stroke SVG icons with names and tooltips instead of text glyphs", () => {
		const { container } = render(<Harness initial={ready} send={vi.fn()} />);
		const names = ["Conversaciones", "Cuentas", "Perfiles", "Nueva conversación", "Ocultar"];
		for (const name of names) {
			const button = screen.getByRole("button", { name });
			expect(button).toHaveAttribute("title", name);
			const icons = button.querySelectorAll("svg");
			expect(icons).toHaveLength(1);
			const icon = icons[0];
			expect(icon).toHaveAttribute("width", "18");
			expect(icon).toHaveAttribute("height", "18");
			expect(icon).toHaveAttribute("fill", "none");
			expect(icon).toHaveAttribute("stroke", "currentColor");
			expect(icon).toHaveAttribute("aria-hidden", "true");
			expect(button.textContent).toBe("");
		}
		const header = container.querySelector(".chat-header");
		for (const glyph of ["☰", "⚿", "◐", "＋", "–"]) expect(header?.textContent).not.toContain(glyph);
		// Each action has its own drawing.
		const drawings = names.map((name) => screen.getByRole("button", { name }).innerHTML);
		expect(new Set(drawings).size).toBe(names.length);
	});

	it("shows no Hide button in the browser", () => {
		render(<ChatSurface variant="web" state={ready} send={vi.fn()} dismiss={vi.fn()} />);
		expect(screen.queryByRole("button", { name: "Hide" })).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Perfiles" })).toHaveAttribute("title", "Perfiles");
	});
});

describe("typing closes open options", () => {
	it("closes the conversations list, accounts, and profiles when the first character is typed", async () => {
		const send = vi.fn();
		render(<Harness initial={ready} send={send} />);

		await userEvent.click(screen.getByRole("button", { name: "Conversaciones" }));
		expect(screen.getByRole("navigation", { name: "Conversaciones anteriores" })).toBeInTheDocument();
		await userEvent.type(box(), "h");
		expect(screen.queryByRole("navigation", { name: "Conversaciones anteriores" })).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Conversaciones" })).toHaveAttribute("aria-expanded", "false");
		expect(box()).toHaveValue("h");

		await userEvent.clear(box());
		await userEvent.click(screen.getByRole("button", { name: "Cuentas" }));
		expect(screen.getByRole("region", { name: "Cuentas" })).toBeInTheDocument();
		await userEvent.type(box(), "hi");
		expect(screen.queryByRole("region", { name: "Cuentas" })).not.toBeInTheDocument();

		await userEvent.clear(box());
		await userEvent.click(screen.getByRole("button", { name: "Perfiles" }));
		expect(screen.getByRole("region", { name: "Perfiles" })).toBeInTheDocument();
		await userEvent.type(box(), "x");
		expect(screen.queryByRole("region", { name: "Perfiles" })).not.toBeInTheDocument();
		expect(box()).toHaveValue("x");
		expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "send" }));
	});

	it("leaves an option opened while text is already typed until the box is emptied and typing starts again", async () => {
		render(<Harness initial={ready} send={vi.fn()} />);
		await userEvent.type(box(), "draft");
		await userEvent.click(screen.getByRole("button", { name: "Perfiles" }));
		await userEvent.type(box(), " more");
		expect(screen.getByRole("region", { name: "Perfiles" })).toBeInTheDocument();
		await userEvent.clear(box());
		await userEvent.type(box(), "n");
		expect(screen.queryByRole("region", { name: "Perfiles" })).not.toBeInTheDocument();
	});

	it("keeps accounts open while a sign-in waits for the user's answer, but still closes the list", async () => {
		let s = reduce(ready, { type: "accounts", open: true });
		s = reduce(s, { type: "auth_started", providerId: "openai" });
		s = apply(s, {
			type: "auth_prompt",
			prompt: { flowId: "f1", kind: "secret", message: "Paste your API key" },
		});
		render(<Harness initial={s} send={vi.fn()} />);
		await userEvent.click(screen.getByRole("button", { name: "Conversaciones" }));
		await userEvent.type(box(), "o");
		expect(screen.getByRole("region", { name: "Cuentas" })).toBeInTheDocument();
		expect(screen.getByText("Paste your API key")).toBeInTheDocument();
		expect(screen.queryByRole("navigation", { name: "Conversaciones anteriores" })).not.toBeInTheDocument();
	});

	it("closes accounts when a sign-in has no question showing", async () => {
		let s = reduce(ready, { type: "accounts", open: true });
		s = reduce(s, { type: "auth_started", providerId: "openai" });
		render(<Harness initial={s} send={vi.fn()} />);
		expect(screen.getByRole("region", { name: "Cuentas" })).toBeInTheDocument();
		await userEvent.type(box(), "o");
		expect(screen.queryByRole("region", { name: "Cuentas" })).not.toBeInTheDocument();
	});
});
