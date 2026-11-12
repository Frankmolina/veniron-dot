import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorsPanel } from "../src/components/ConnectorsPanel.tsx";
import { VoiceModelEntry } from "../src/components/VoiceModel.tsx";

const TOTAL = 487_170_055;

const h = vi.hoisted(() => ({
	status: {} as Record<string, unknown>,
	invoke: vi.fn(),
	listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
	isTauri: () => true,
	invoke: (command: string, args?: unknown) => h.invoke(command, args),
}));

vi.mock("@tauri-apps/api/event", () => ({
	listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
		h.listeners.set(name, handler);
		return () => h.listeners.delete(name);
	},
}));

const emit = (payload: unknown) =>
	act(async () => {
		h.listeners.get("voice://model")?.({ payload });
	});

beforeEach(() => {
	h.status = { installed: false, downloading: false, engine: "apple" };
	h.listeners.clear();
	h.invoke.mockReset();
	h.invoke.mockImplementation(async (command: string) => {
		if (command === "voice_model_status") return h.status;
		return undefined;
	});
});

afterEach(() => vi.clearAllMocks());

describe("local voice model (S30.5)", () => {
	it("downloads only when asked, showing the size and the progress", async () => {
		render(<VoiceModelEntry />);
		expect(await screen.findByText("En uso: voz de macOS")).toBeInTheDocument();
		expect(screen.getByText("macOS")).toHaveClass("chip");
		expect(h.invoke).not.toHaveBeenCalledWith("voice_model_download", undefined);

		await userEvent.click(screen.getByRole("button", { name: "Descargar el modelo de voz local (487 MB)" }));
		expect(h.invoke).toHaveBeenCalledWith("voice_model_download", undefined);

		await emit({ state: "downloading", received: TOTAL / 4, total: TOTAL });
		expect(screen.getByRole("progressbar", { name: "Descargando el modelo de voz local" })).toHaveAttribute(
			"value",
			"25",
		);
		expect(screen.getByText("Descargando… 25%")).toBeInTheDocument();

		await emit({ state: "verifying" });
		expect(screen.getByText("Comprobando y descomprimiendo…")).toBeInTheDocument();
	});

	it("cancels a download", async () => {
		h.status = { installed: false, downloading: true, received: 10, total: TOTAL, engine: "apple" };
		render(<VoiceModelEntry />);
		await userEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
		expect(h.invoke).toHaveBeenCalledWith("voice_model_cancel", undefined);
		h.status = { installed: false, downloading: false, engine: "apple" };
		await emit({ state: "failed", message: "The download was cancelled." });
		expect(screen.getByText("The download was cancelled.")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Descargar el modelo de voz local (487 MB)" }),
		).toBeInTheDocument();
	});

	it("uses the installed model and can remove it", async () => {
		h.status = { installed: true, bytes: 670_478_772, downloading: false, engine: "parakeet" };
		render(<VoiceModelEntry />);
		expect(
			await screen.findByText("En uso: modelo local (Parakeet), funciona sin conexión"),
		).toBeInTheDocument();
		expect(screen.getByText("Sin conexión")).toHaveClass("chip");
		expect(screen.queryByText("Built in")).toBeNull();

		h.status = { installed: false, downloading: false, engine: "apple" };
		await userEvent.click(screen.getByRole("button", { name: "Quitar el modelo local (670 MB)" }));
		expect(h.invoke).toHaveBeenCalledWith("voice_model_remove", undefined);
		await emit({ state: "removed" });
		await waitFor(() => expect(screen.getByText("En uso: voz de macOS")).toBeInTheDocument());
	});

	it("shows a failed download's reason and offers the download again", async () => {
		render(<VoiceModelEntry />);
		await screen.findByText("En uso: voz de macOS");
		await emit({ state: "failed", message: "The download did not match its checksum." });
		expect(screen.getByRole("alert")).toHaveTextContent("The download did not match its checksum.");
		expect(
			screen.getByRole("button", { name: "Descargar el modelo de voz local (487 MB)" }),
		).toBeInTheDocument();
	});

	it("shows nothing to act on, and does not fail, when the app reports no status", async () => {
		h.status = null as unknown as Record<string, unknown>;
		render(<VoiceModelEntry />);
		await waitFor(() => expect(h.invoke).toHaveBeenCalledWith("voice_model_status", undefined));
		expect(screen.queryByRole("button")).toBeNull();
		expect(screen.getByText("Voz")).toBeInTheDocument();
	});

	it("appears in Conectores only when the desktop app offers it", () => {
		const props = {
			connectors: { open: true, list: [] },
			send: () => {},
			dispatch: () => {},
			openUrl: () => {},
		};
		const { unmount } = render(<ConnectorsPanel {...props} />);
		expect(screen.queryByText("Voz")).toBeNull();
		unmount();
		render(<ConnectorsPanel {...props} voiceModel />);
		expect(screen.getByText("Voz")).toBeInTheDocument();
	});
});
