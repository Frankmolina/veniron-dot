import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeMaskSvg } from "../vite-plugin-utf8-mask.ts";

describe("the V mask file", () => {
	it("decodes the Latin-1 source as UTF-8 text without changing the file", () => {
		const buf = readFileSync(join(process.cwd(), "veniron/mascara.svg"));
		expect(() => new TextDecoder("utf-8", { fatal: true }).decode(buf)).toThrow();
		const text = decodeMaskSvg(buf);
		expect(text).toContain('viewBox="0 0 320 404"');
		expect(text).toContain("Máscara de VENIRON");
	});
});
