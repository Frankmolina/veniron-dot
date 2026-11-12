import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

const MASK_SUFFIX = "/veniron/mascara.svg";

/**
 * Decode `veniron/mascara.svg` for the UI without changing the file.
 * The source is Latin-1 (`Máscara` in the aria-label) and has no XML
 * encoding declaration. WKWebView parses SVG as UTF-8, so an `<img>` of
 * the raw file shows a broken-image question mark.
 */
export function decodeMaskSvg(buf: Uint8Array): string {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(buf);
	} catch {
		return new TextDecoder("latin1").decode(buf);
	}
}

export function venironUtf8Mask(): Plugin {
	return {
		name: "veniron-utf8-mask",
		enforce: "pre",
		load(id) {
			const file = id.replaceAll("\\", "/").split("?")[0];
			if (!file.endsWith(MASK_SUFFIX)) return null;
			const text = decodeMaskSvg(readFileSync(file));
			const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
			return `export default ${JSON.stringify(url)};`;
		},
	};
}
