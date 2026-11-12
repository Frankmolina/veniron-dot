import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { APP_REQUIRED, type ConnectorInfo } from "@gentle-dot/protocol";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComputerPermissions } from "../src/computer.ts";
import { type DotState, initialState } from "../src/store.ts";

const HELPER = "http://127.0.0.1:51234/mcp";
const KEY = "s3cr3t-Computer-Key-0123456789abcdef";
const WINDOWS_2004_NOTE =
	"El control del ordenador necesita Windows 10 versión 2004 (compilación 19041) o posterior para las capturas de pantalla.";
const YOLO_NOTE_WITHOUT_PANIC =
	"El modo yolo permite al asistente enviar, pagar, borrar y confirmar sin preguntarte antes. Se desactiva solo al cabo de 1 hora o al salir de la aplicación; Detener sigue funcionando.";
const UNKNOWN_WINDOWS_NOTE =
	"VENIRON no puede saber qué versión de Windows es esta, así que el control del ordenador no está disponible: las capturas de pantalla necesitan Windows 10 versión 2004 (compilación 19041) o posterior.";

const h = vi.hoisted(() => ({
	tauri: true,
	endpoint: null as unknown,
	permissions: {
		accessibility: false,
		screenRecording: true,
		screenshotsSupported: true,
		panicShortcut: true,
	} as ComputerPermissions,
	status: { active: false } as unknown,
	invoke: vi.fn(),
	send: vi.fn(),
	listeners: new Map<string, (event: { payload: unknown }) => void>(),
	state: undefined as unknown as DotState,
}));

vi.mock("@tauri-apps/api/core", () => ({
	isTauri: () => h.tauri,
	invoke: (command: string, args?: unknown) => h.invoke(command, args),
}));

vi.mock("@tauri-apps/api/event", () => ({
	listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
		h.listeners.set(name, handler);
		return () => h.listeners.delete(name);
	},
}));

// The panel's other desktop events are not under test; concurrent first imports of the mocked
// event module can reach the real one, so only computer.ts imports it here.
vi.mock("../src/desktop.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/desktop.ts")>()),
	onDesktopEvent: async () => () => {},
}));

vi.mock("../src/useDot.ts", () => ({
	useDot: () => ({ state: h.state, send: h.send, dismiss: () => {}, dispatch: () => {} }),
}));

const computerEntry = (overrides: Partial<ConnectorInfo> = {}): ConnectorInfo => ({
	id: "computer",
	name: "Computer",
	reads: "See your screen during a session you allow in the app.",
	sends: "Click, type, and open apps on this Mac during that session.",
	added: true,
	enabled: true,
	mode: "read_write",
	status: "connected",
	noSignIn: true,
	builtin: true,
	...overrides,
});

const notion: ConnectorInfo = {
	id: "notion",
	name: "Notion",
	reads: "Search and read your pages.",
	sends: "Create and edit pages, after you approve each one.",
	added: true,
	enabled: true,
	mode: "read_only",
	status: "connected",
};

const DEBUG_NOTE =
	"Las compilaciones de depuración pierden estos permisos en cada recompilación porque macOS los asocia a la firma de la aplicación; concédelos de nuevo después de actualizar.";

function connectorsOpen(list: ConnectorInfo[]): DotState {
	return { ...h.state, connectors: { open: true, list } };
}

async function renderApp(search: string) {
	window.history.replaceState(null, "", `/${search}`);
	const { App } = await import("../src/App.tsx");
	return render(<App />);
}

const registrations = () => h.send.mock.calls.filter(([m]) => m.type === "computer_register");
const invoked = (command: string) => h.invoke.mock.calls.filter(([c]) => c === command);

async function emitState(payload: unknown) {
	await waitFor(() => expect(h.listeners.has("computer://state")).toBe(true));
	await act(async () => h.listeners.get("computer://state")?.({ payload }));
}

beforeEach(() => {
	h.tauri = true;
	h.endpoint = { url: HELPER, token: KEY };
	h.permissions = {
		accessibility: false,
		screenRecording: true,
		screenshotsSupported: true,
		panicShortcut: true,
	};
	h.status = { active: false };
	h.listeners.clear();
	h.send = vi.fn();
	h.state = { ...initialState, connection: "open", agentState: "idle" };
	h.invoke = vi.fn(async (command: string) => {
		switch (command) {
			case "connection_info":
				return new Promise(() => {});
			case "computer_endpoint":
				return h.endpoint;
			case "computer_permissions":
				return h.permissions;
			case "computer_status":
				return h.status;
			default:
				return null;
		}
	});
});

afterEach(() => {
	vi.useRealTimers();
	window.history.replaceState(null, "", "/");
	window.sessionStorage.clear();
});

describe("registering the helper (S24.7, L61)", () => {
	it("the desktop panel only asks the app whether it has a helper; the app registers it over its channel", async () => {
		h.state = { ...h.state, connection: "connecting" };
		const view = await renderApp("?surface=panel");
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(invoked("computer_endpoint")).toHaveLength(0);

		h.state = { ...connectorsOpen([notion, computerEntry()]), connection: "open" };
		const { App } = await import("../src/App.tsx");
		view.rerender(<App />);
		await waitFor(() => expect(invoked("computer_endpoint")).toHaveLength(1));
		await screen.findByRole("listitem", { name: "Ordenador" });
		expect(registrations()).toHaveLength(0);
		expect(JSON.stringify(h.send.mock.calls)).not.toContain(KEY);
	});

	it("registers nothing when the app has no helper", async () => {
		h.endpoint = null;
		h.state = connectorsOpen([notion]);
		await renderApp("?surface=panel");
		await waitFor(() => expect(invoked("computer_endpoint")).toHaveLength(1));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(registrations()).toHaveLength(0);
		expect(screen.queryByRole("listitem", { name: "Ordenador" })).toBeNull();
	});

	it("the Dot window does not register it; only the panel does", async () => {
		await renderApp("?surface=dot");
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(invoked("computer_endpoint")).toHaveLength(0);
		expect(registrations()).toHaveLength(0);
	});

	it("the web page never offers computer control, even when the daemon lists it", async () => {
		h.tauri = false;
		h.state = connectorsOpen([notion, computerEntry()]);
		await renderApp("?#token=web-key");
		await screen.findByRole("region", { name: "Conectores" });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(screen.queryByText("Ordenador")).toBeNull();
		expect(screen.getByText("Notion")).toBeInTheDocument();
		expect(h.invoke).not.toHaveBeenCalled();
		expect(registrations()).toHaveLength(0);
	});
});

describe("the Computer entry in Conectores (S24.5)", () => {
	it("shows both permissions with grant buttons, a re-check, the debug-build note, and nothing to remove", async () => {
		h.state = connectorsOpen([notion, computerEntry()]);
		await renderApp("?surface=panel");
		const entry = await screen.findByRole("listitem", { name: "Ordenador" });
		const accessibility = within(entry).getByRole("listitem", { name: "Accesibilidad" });
		const recording = within(entry).getByRole("listitem", { name: "Grabación de pantalla" });
		await waitFor(() => expect(accessibility).toHaveTextContent("No permitido"));
		expect(recording).toHaveTextContent("Permitido");
		expect(within(recording).queryByRole("button")).toBeNull();
		expect(within(entry).getByText(DEBUG_NOTE)).toBeInTheDocument();
		expect(within(entry).queryByText(/does not accept images/)).toBeNull();
		for (const name of [/^Conectar/, /^Desconectar/, /^Quitar/, /^Iniciar sesión/]) {
			expect(within(entry).queryByRole("button", { name })).toBeNull();
		}
		expect(within(entry).queryByRole("radio")).toBeNull();
		// The other connectors keep their usual controls.
		expect(screen.getByRole("button", { name: "Quitar Notion" })).toBeInTheDocument();

		const checks = invoked("computer_permissions").length;
		await userEvent.click(within(accessibility).getByRole("button", { name: "Conceder Accesibilidad" }));
		expect(h.invoke).toHaveBeenCalledWith("computer_request_permission", { kind: "accessibility" });
		await waitFor(() => expect(invoked("computer_permissions").length).toBe(checks + 1));

		h.permissions = {
			accessibility: true,
			screenRecording: true,
			screenshotsSupported: true,
			panicShortcut: true,
		};
		await userEvent.click(within(entry).getByRole("button", { name: "Comprobar de nuevo" }));
		await waitFor(() => expect(accessibility).toHaveTextContent("Permitido"));
		expect(accessibility).not.toHaveTextContent("No permitido");
		expect(within(accessibility).queryByRole("button")).toBeNull();
	});

	it("asks for Screen Recording with its own kind", async () => {
		h.permissions = {
			accessibility: true,
			screenRecording: false,
			screenshotsSupported: true,
			panicShortcut: true,
		};
		h.state = connectorsOpen([computerEntry()]);
		await renderApp("?surface=panel");
		const recording = await screen.findByRole("listitem", { name: "Grabación de pantalla" });
		await userEvent.click(
			await within(recording).findByRole("button", { name: "Conceder Grabación de pantalla" }),
		);
		expect(h.invoke).toHaveBeenCalledWith("computer_request_permission", { kind: "screenRecording" });
	});

	it("says when the modelo actual no acepta imágenes", async () => {
		h.state = connectorsOpen([computerEntry({ noImages: true })]);
		await renderApp("?surface=panel");
		const entry = await screen.findByRole("listitem", { name: "Ordenador" });
		expect(within(entry).getByText(/modelo actual no acepta imágenes/)).toBeInTheDocument();
	});
});

describe("while the assistant controls the Mac (S24.6)", () => {
	it("shows a banner with the time restantes and a Detener button, until the session ends", async () => {
		await renderApp("?surface=panel");
		await waitFor(() => expect(h.listeners.has("computer://state")).toBe(true));
		expect(screen.queryByRole("region", { name: "Control del ordenador" })).toBeNull();

		vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
		vi.setSystemTime(1_800_000_000_000);
		await emitState({ active: true, endsAt: Date.now() + 90_000, reason: "granted" });
		const banner = screen.getByRole("region", { name: "Control del ordenador" });
		expect(banner).toHaveTextContent("Controlando tu Mac · 01:30 restantes");
		await act(async () => vi.advanceTimersByTime(1000));
		expect(banner).toHaveTextContent("Controlando tu Mac · 01:29 restantes");

		within(banner).getByRole("button", { name: "Detener" }).click();
		expect(invoked("computer_stop")).toHaveLength(1);
		await emitState({ active: false, reason: "stopped" });
		expect(screen.queryByRole("region", { name: "Control del ordenador" })).toBeNull();
	});

	it("shows a session that was already running when the panel opened, with endsAt in seconds too", async () => {
		vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
		vi.setSystemTime(1_800_000_000_000);
		h.status = { active: true, endsAt: 1_800_000_000 + 25 * 60 };
		await renderApp("?surface=panel");
		const banner = await screen.findByRole("region", { name: "Control del ordenador" });
		expect(banner).toHaveTextContent("Controlando tu Mac · 25:00 restantes");
	});

	it("the rose shows the in-control state and goes back when the session ends", async () => {
		await renderApp("?surface=dot");
		const dot = screen.getByRole("button");
		expect(dot.querySelector(".rose")).toHaveClass("rose-idle");

		await emitState({ active: true, endsAt: Date.now() + 60_000, reason: "granted" });
		expect(dot).toHaveAccessibleName("VENIRON: controlando tu Mac");
		expect(dot).toHaveClass("dot-in_control");
		expect(dot.querySelector(".rose")).toHaveClass("rose-control");

		await emitState({ active: false, reason: "panic" });
		expect(dot).toHaveAccessibleName("VENIRON: parado");
		expect(dot).toHaveClass("dot-halted");
		expect(dot.querySelector(".rose")).toHaveClass("rose-panic");
	});

	it("styles the in-control rose and the banner with the site's tokens", () => {
		const stylesheet = "../src/styles.css";
		const css = readFileSync(fileURLToPath(new URL(stylesheet, import.meta.url)), "utf8");
		const rule = (selector: string) =>
			css.match(new RegExp(`\\n${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";
		expect(rule(".dot-in_control .dot-disc")).toMatch(/--rim: /);
		expect(rule(".rose-control .rose-mask")).toMatch(/animation: rose-breathe/);
		expect(rule(".computer-banner")).toMatch(/var\(--accent/);
		expect(rule(".computer-banner")).toMatch(/border-radius: var\(--radius-md\)/);
	});
});

describe("on Windows", () => {
	beforeEach(() => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
	});
	afterEach(() => vi.restoreAllMocks());

	it("shows Windows guidance without macOS permissions", async () => {
		h.state = connectorsOpen([computerEntry()]);
		await renderApp("?surface=panel");
		const entry = await screen.findByRole("listitem", { name: "Ordenador" });
		expect(
			within(entry).getByText("Windows no pide permiso para el control del ordenador."),
		).toBeInTheDocument();
		expect(within(entry).queryByText("Accesibilidad")).toBeNull();
		expect(within(entry).queryByText("Grabación de pantalla")).toBeNull();
		expect(within(entry).queryByRole("button", { name: "Comprobar de nuevo" })).toBeNull();
		expect(within(entry).queryByText(DEBUG_NOTE)).toBeNull();
		expect(
			await within(entry).findByText(/Detener y Alt\+Shift\+Esc siguen funcionando/),
		).toBeInTheDocument();
	});

	it("names Alt+Shift+Esc in the yolo note only when the app registered it", async () => {
		h.permissions.panicShortcut = false;
		h.state = connectorsOpen([computerEntry()]);
		await renderApp("?surface=panel");
		const entry = await screen.findByRole("listitem", { name: "Ordenador" });
		expect(await within(entry).findByText(YOLO_NOTE_WITHOUT_PANIC)).toBeInTheDocument();
		expect(within(entry).queryByText(/Alt\+Shift\+Esc/)).toBeNull();
	});

	it("promises no shortcut in the yolo note while the app has not answered", async () => {
		const answer = h.invoke.getMockImplementation();
		h.invoke.mockImplementation((command: string, args?: unknown) =>
			command === "computer_permissions" ? new Promise(() => {}) : answer?.(command, args),
		);
		h.state = connectorsOpen([computerEntry()]);
		await renderApp("?surface=panel");
		const entry = await screen.findByRole("listitem", { name: "Ordenador" });
		expect(within(entry).getByText(YOLO_NOTE_WITHOUT_PANIC)).toBeInTheDocument();
		expect(within(entry).queryByText(/Alt\+Shift\+Esc/)).toBeNull();
	});

	it("explains unsupported screenshots require Windows 10 version 2004 or newer", async () => {
		h.permissions.screenshotsSupported = false;
		h.state = connectorsOpen([computerEntry()]);
		await renderApp("?surface=panel");
		expect(await screen.findByText(WINDOWS_2004_NOTE)).toBeInTheDocument();
		expect(screen.queryByText(UNKNOWN_WINDOWS_NOTE)).toBeNull();
	});

	it("says this Windows is too old when the app says so", async () => {
		h.permissions.screenshotsSupported = false;
		h.permissions.screenshotsUnsupported = "tooOld";
		h.state = connectorsOpen([computerEntry()]);
		await renderApp("?surface=panel");
		expect(await screen.findByText(WINDOWS_2004_NOTE)).toBeInTheDocument();
		expect(screen.queryByText(UNKNOWN_WINDOWS_NOTE)).toBeNull();
	});

	it("says the Windows version is unknown, not too old, when the app cannot tell it", async () => {
		h.permissions.screenshotsSupported = false;
		h.permissions.screenshotsUnsupported = "unknownVersion";
		h.state = connectorsOpen([computerEntry()]);
		await renderApp("?surface=panel");
		expect(await screen.findByText(UNKNOWN_WINDOWS_NOTE)).toBeInTheDocument();
		expect(screen.queryByText(WINDOWS_2004_NOTE)).toBeNull();
	});

	it("says nothing about Windows 10 version 2004 when screenshots are supported", async () => {
		h.state = connectorsOpen([computerEntry()]);
		await renderApp("?surface=panel");
		const entry = await screen.findByRole("listitem", { name: "Ordenador" });
		await within(entry).findByText("Windows no pide permiso para el control del ordenador.");
		expect(within(entry).queryByText(WINDOWS_2004_NOTE)).toBeNull();
		expect(within(entry).queryByText(UNKNOWN_WINDOWS_NOTE)).toBeNull();
	});

	it("names the PC in the session banner", async () => {
		h.status = { active: true };
		await renderApp("?surface=panel");
		expect(await screen.findByText("Controlando tu PC")).toBeInTheDocument();
	});
});

describe("on macOS", () => {
	beforeEach(() => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
		);
	});
	afterEach(() => vi.restoreAllMocks());

	it("shows none of the Windows texts, even when screenshots are reported unsupported", async () => {
		h.permissions.screenshotsSupported = false;
		h.permissions.screenshotsUnsupported = "unknownVersion";
		h.state = connectorsOpen([computerEntry()]);
		await renderApp("?surface=panel");
		const entry = await screen.findByRole("listitem", { name: "Ordenador" });
		await within(entry).findByText("Accesibilidad");
		expect(within(entry).queryByText("Windows no pide permiso para el control del ordenador.")).toBeNull();
		expect(within(entry).queryByText(WINDOWS_2004_NOTE)).toBeNull();
		expect(within(entry).queryByText(UNKNOWN_WINDOWS_NOTE)).toBeNull();
		expect(within(entry).queryByText(/Alt\+Shift\+Esc/)).toBeNull();
		expect(await within(entry).findByText(/Detener y ⌥⇧Esc siguen funcionando/)).toBeInTheDocument();
	});

	it("names ⌥⇧Esc in the yolo note only when the app registered it", async () => {
		h.permissions.panicShortcut = false;
		h.state = connectorsOpen([computerEntry()]);
		await renderApp("?surface=panel");
		const entry = await screen.findByRole("listitem", { name: "Ordenador" });
		await within(entry).findByText("Permitido");
		expect(within(entry).getByText(YOLO_NOTE_WITHOUT_PANIC)).toBeInTheDocument();
		expect(within(entry).queryByText(/⌥⇧Esc/)).toBeNull();
	});

	it("promises no shortcut in the yolo note when the permissions check fails", async () => {
		const answer = h.invoke.getMockImplementation();
		h.invoke.mockImplementation((command: string, args?: unknown) =>
			command === "computer_permissions" ? Promise.reject(new Error("no answer")) : answer?.(command, args),
		);
		h.state = connectorsOpen([computerEntry()]);
		await renderApp("?surface=panel");
		const entry = await screen.findByRole("listitem", { name: "Ordenador" });
		expect(within(entry).getByText(YOLO_NOTE_WITHOUT_PANIC)).toBeInTheDocument();
		expect(within(entry).queryByText(/⌥⇧Esc/)).toBeNull();
	});

	it("names the Mac in the session banner", async () => {
		h.status = { active: true };
		await renderApp("?surface=panel");
		expect(await screen.findByText("Controlando tu Mac")).toBeInTheDocument();
		expect(screen.queryByText("Controlando tu PC")).toBeNull();
	});
});

describe("yolo mode (S24.9)", () => {
	const yoloSwitch = async () => {
		const entry = await screen.findByRole("listitem", { name: "Ordenador" });
		return within(entry).getByRole("switch", { name: "Modo yolo" });
	};

	it("the switch in Conectores asks the app, and only the app's state moves it", async () => {
		h.state = connectorsOpen([computerEntry()]);
		await renderApp("?surface=panel");
		const toggle = await yoloSwitch();
		expect(toggle).toHaveAttribute("aria-checked", "false");

		await userEvent.click(toggle);
		expect(h.invoke).toHaveBeenCalledWith("computer_set_yolo", { enabled: true });
		// The native confirmation decides; nothing changes until the app reports it.
		expect(toggle).toHaveAttribute("aria-checked", "false");

		await emitState({ active: false, yolo: true, yoloEndsAt: Date.now() + 3_600_000 });
		expect(toggle).toHaveAttribute("aria-checked", "true");
		await userEvent.click(toggle);
		expect(h.invoke).toHaveBeenCalledWith("computer_set_yolo", { enabled: false });

		await emitState({ active: false, yolo: false });
		expect(toggle).toHaveAttribute("aria-checked", "false");
	});

	it("reflects yolo mode that was already on when the panel opened", async () => {
		h.status = { active: false, yolo: true, yoloEndsAt: Date.now() + 60_000 };
		h.state = connectorsOpen([computerEntry()]);
		await renderApp("?surface=panel");
		const toggle = await yoloSwitch();
		await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
	});

	it("the session banner says Yolo while it is on", async () => {
		await renderApp("?surface=panel");
		await emitState({ active: true, endsAt: Date.now() + 60_000, reason: "granted", yolo: true });
		const banner = screen.getByRole("region", { name: "Control del ordenador" });
		expect(within(banner).getByText("Yolo")).toBeInTheDocument();
		await emitState({ active: true, endsAt: Date.now() + 60_000, yolo: false });
		expect(within(banner).queryByText("Yolo")).toBeNull();
	});

	it("the rose's rim turns amber while yolo mode is on, with no separate mark", async () => {
		await renderApp("?surface=dot");
		const dot = screen.getByRole("button");
		await emitState({ active: true, endsAt: Date.now() + 60_000, yolo: true });
		expect(dot).toHaveClass("dot-in_control", "dot-yolo");
		expect(dot).toHaveAccessibleName("VENIRON: controlando tu Mac, modo yolo activo");
		expect(dot.querySelector(".dot-yolo-mark")).toBeNull();

		await emitState({ active: true, endsAt: Date.now() + 60_000, yolo: false });
		expect(dot).not.toHaveClass("dot-yolo");
	});

	it("styles the yolo marker and switch with the site's tokens", () => {
		const stylesheet = "../src/styles.css";
		const css = readFileSync(fileURLToPath(new URL(stylesheet, import.meta.url)), "utf8");
		const rule = (selector: string) =>
			css.match(new RegExp(`\\n${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";
		expect(rule(".dot-yolo-mark")).toBe("");
		expect(rule(".dot-yolo .dot-disc")).toMatch(/--rim: var\(--yellow\)/);
		// It follows the in-control rim, so it wins while both are on.
		expect(css.indexOf("\n.dot-yolo .dot-disc {")).toBeGreaterThan(
			css.indexOf("\n.dot-in_control .dot-disc {"),
		);
		expect(rule(".computer-yolo-chip")).toMatch(/var\(--yellow/);
		expect(rule('.switch[aria-checked="true"]')).toMatch(/var\(--accent/);
	});
});

describe("connector changes go through the app (S25.2)", () => {
	it("the panel sends them with its window's id to the app, never over the WebSocket", async () => {
		h.state = { ...connectorsOpen([notion]), clientId: "window-1" };
		await renderApp("?surface=panel");
		const entry = within(await screen.findByRole("listitem", { name: "Notion" }));
		await userEvent.setup().click(entry.getByRole("button", { name: "Desconectar Notion" }));
		await waitFor(() => expect(invoked("connector_command")).toHaveLength(1));
		expect(invoked("connector_command")[0]?.[1]).toEqual({
			clientId: "window-1",
			message: { type: "connector_disconnect", connectorId: "notion" },
		});
		expect(h.send.mock.calls.some(([m]) => m.type === "connector_disconnect")).toBe(false);
	});

	it("the web page shows them disabled with the reason", async () => {
		h.tauri = false;
		h.state = { ...connectorsOpen([notion]), clientId: "window-1" };
		await renderApp("?#token=web-key");
		const entry = within(await screen.findByRole("listitem", { name: "Notion" }));
		expect(entry.getByRole("button", { name: "Desconectar Notion" })).toBeDisabled();
		expect(screen.getByText(APP_REQUIRED)).toBeInTheDocument();
		expect(h.invoke).not.toHaveBeenCalled();
	});
});
