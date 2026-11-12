import type { ServerMessage, ServerPayload } from "@gentle-dot/protocol";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatSurface } from "../src/components/ChatSurface.tsx";
import { type DotState, initialState, reduce } from "../src/store.ts";

function apply(state: DotState, ...payloads: ServerPayload[]): DotState {
	return payloads.reduce(
		(s, p) => reduce(s, { type: "server", message: { ...p, seq: 1 } as ServerMessage }),
		state,
	);
}

// Switching only exists with the conversations list on.
const open: DotState = {
	...initialState,
	connection: "open",
	agentState: "idle",
	features: { conversations: true },
};

describe("answer outcome", () => {
	it("keeps an error and a stop on the answer they belong to", () => {
		const s = apply(
			open,
			{ type: "message_delta", messageId: "m1", delta: "Half an ans" },
			{ type: "message_done", messageId: "m1", text: "Half an answer", stopped: true },
			{ type: "message_done", messageId: "m2", text: "", error: "Something went wrong while answering." },
		);
		expect(s.messages.map((m) => [m.id, m.text, m.streaming, m.note])).toEqual([
			["m1", "Half an answer", false, { kind: "stopped", text: "Stopped." }],
			["m2", "", false, { kind: "error", text: "Something went wrong while answering." }],
		]);
		expect(s.notices).toEqual([]);
	});

	it("shows the error inline and a neutral note for a stop", () => {
		const s = apply(
			open,
			{ type: "message_done", messageId: "m1", text: "Partial", stopped: true },
			{ type: "message_done", messageId: "m2", text: "", error: "Something went wrong while answering." },
		);
		const { container } = render(<ChatSurface variant="web" state={s} send={vi.fn()} dismiss={vi.fn()} />);
		const answers = [...container.querySelectorAll(".message-assistant")];
		expect(answers).toHaveLength(2);
		expect(answers[0]?.querySelector(".message-note")).toHaveTextContent("Stopped.");
		expect(answers[0]?.querySelector(".message-note")).toHaveClass("message-note-stopped");
		expect(answers[0]).toHaveTextContent("Partial");
		const error = answers[1]?.querySelector(".message-note");
		expect(error).toHaveTextContent("Something went wrong while answering.");
		expect(error).toHaveClass("message-note-error");
		expect(error).toHaveAttribute("role", "alert");
		expect(container.querySelector(".notice")).toBeNull();
	});
});

const conversations = [
	{ id: "b.jsonl", title: "Current", updatedAt: "2026-10-08T10:00:00.000Z" },
	{ id: "a.jsonl", title: "Trip plan", updatedAt: "2026-10-07T10:00:00.000Z" },
];
const QUESTION = "El asistente sigue respondiendo. ¿Lo detienes y abres la otra conversación?";

describe("switching while the assistant answers", () => {
	it("asks first, and Cancelar keeps the running answer", async () => {
		const send = vi.fn();
		const busy = { ...open, agentState: "thinking" as const, conversationId: "b.jsonl", conversations };
		render(<ChatSurface variant="web" state={busy} send={send} dismiss={vi.fn()} />);
		await userEvent.click(screen.getByRole("button", { name: "Nueva conversación" }));
		const dialog = screen.getByRole("alertdialog", { name: "¿Detener y cambiar?" });
		expect(dialog).toHaveTextContent(QUESTION);
		expect(send).not.toHaveBeenCalled();
		await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
		expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
		expect(send).not.toHaveBeenCalled();
	});

	it("starts a new conversation after Detener y cambiar", async () => {
		const send = vi.fn();
		const busy = { ...open, agentState: "working" as const, conversationId: "b.jsonl", conversations };
		render(<ChatSurface variant="web" state={busy} send={send} dismiss={vi.fn()} />);
		await userEvent.click(screen.getByRole("button", { name: "Nueva conversación" }));
		await userEvent.click(screen.getByRole("button", { name: "Detener y cambiar" }));
		expect(send.mock.calls).toEqual([[{ type: "new_conversation" }]]);
		expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
	});

	it("opens the chosen conversation after Detener y cambiar", async () => {
		const send = vi.fn();
		const busy = { ...open, agentState: "needs_you" as const, conversationId: "b.jsonl", conversations };
		render(<ChatSurface variant="web" state={busy} send={send} dismiss={vi.fn()} />);
		await userEvent.click(screen.getByRole("button", { name: "Conversaciones" }));
		send.mockClear();
		await userEvent.click(screen.getByRole("button", { name: /Trip plan/ }));
		expect(screen.queryByRole("navigation", { name: "Conversaciones anteriores" })).not.toBeInTheDocument();
		expect(screen.getByRole("alertdialog", { name: "¿Detener y cambiar?" })).toHaveTextContent(QUESTION);
		expect(send).not.toHaveBeenCalled();
		await userEvent.click(screen.getByRole("button", { name: "Detener y cambiar" }));
		expect(send.mock.calls).toEqual([[{ type: "open_conversation", conversationId: "a.jsonl" }]]);
	});

	it("switches right away when the assistant is idle", async () => {
		const send = vi.fn();
		render(<ChatSurface variant="web" state={{ ...open, conversations }} send={send} dismiss={vi.fn()} />);
		await userEvent.click(screen.getByRole("button", { name: "Nueva conversación" }));
		expect(send).toHaveBeenCalledWith({ type: "new_conversation" });
		expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
	});
});
